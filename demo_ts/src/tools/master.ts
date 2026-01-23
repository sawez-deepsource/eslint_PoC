// src/tools/master.ts - Master orchestrator for parallel ESLint

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fork, ChildProcess } from "child_process";
import { glob } from "glob";
import { ConfigConverter } from "./config-converter.ts";
import { MemProfiler } from "./mem-profiler.ts";
import {
  LintTask,
  WorkerMessage,
  Batch,
  WorkerState,
  FailedFile,
  Summary,
} from "./types.ts";
import { getTestConfig, printTestHelp } from "./test-scenarios.ts";
import { ESLint } from "eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check for --help flag
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printTestHelp();
  process.exit(0);
}

// Load test config
const testConfig = getTestConfig();

// ============ Configuration ============
const CONFIG = {
  maxWorkers: 2,
  maxRetries: 2,
  memoryThresholdPercent: 75,
  containerLimitMB: 4096, // 4GB default
  initialBatchDivisor: 4, // Split files into ~4 batches initially
};

const projectRoot = process.cwd();
const outputDir = path.join(projectRoot, "lint-output");

// ============ State ============
let batchIdCounter = 0;
let workerIdCounter = 0;
const pendingBatches: Batch[] = [];
const activeWorkers: Map<number, WorkerState> = new Map();
const completedResults: Map<number, ESLint.LintResult[]> = new Map();
const failedFiles: FailedFile[] = [];
const workerStats: Summary["workers"] = [];

// ============ Helpers ============
function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

function getTotalRSS(): number {
  // Master RSS + all worker RSS
  let total = process.memoryUsage().rss;
  for (const worker of activeWorkers.values()) {
    const lastSample = worker.samples[worker.samples.length - 1];
    if (lastSample) {
      total += lastSample.rss;
    }
  }
  return total;
}

function canSpawnWorker(): boolean {
  if (activeWorkers.size >= CONFIG.maxWorkers) {
    return false;
  }
  const thresholdBytes =
    (CONFIG.containerLimitMB * 1024 * 1024 * CONFIG.memoryThresholdPercent) /
    100;
  return getTotalRSS() < thresholdBytes;
}

function createBatches(files: string[]): Batch[] {
  const batchSize = Math.max(
    1,
    Math.ceil(files.length / CONFIG.initialBatchDivisor),
  );
  const batches: Batch[] = [];

  for (let i = 0; i < files.length; i += batchSize) {
    batches.push({
      id: batchIdCounter++,
      files: files.slice(i, i + batchSize),
      retries: 0,
    });
  }

  return batches;
}

function splitBatch(batch: Batch): Batch[] {
  const mid = Math.ceil(batch.files.length / 2);
  return [
    {
      id: batchIdCounter++,
      files: batch.files.slice(0, mid),
      retries: batch.retries + 1,
    },
    {
      id: batchIdCounter++,
      files: batch.files.slice(mid),
      retries: batch.retries + 1,
    },
  ];
}

// ============ Worker Management ============
function spawnWorker(batch: Batch, configPath: string): void {
  const workerId = workerIdCounter++;

  console.log(
    `\n[Master] Spawning worker ${workerId} for batch ${batch.id} (${batch.files.length} files)`,
  );

  const workerPath = path.join(__dirname, "worker.ts");

  // Pass test args to worker
  const workerArgs: string[] = [];
  if (testConfig.scenario !== "none") {
    workerArgs.push(`--test=${testConfig.scenario}`);
    if (testConfig.targetFile) {
      workerArgs.push(`--test-file=${testConfig.targetFile}`);
    }
  }

  const child: ChildProcess = fork(workerPath, workerArgs, {
    execArgv: ["--import", "tsx"],
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  const workerState: WorkerState = {
    id: workerId,
    pid: child.pid ?? 0,
    batch,
    startTime: Date.now(),
    samples: [],
  };

  activeWorkers.set(workerId, workerState);

  // Send lint task
  const task: LintTask = {
    type: "lint",
    workerId,
    configPath,
    files: batch.files,
  };
  child.send(task);

  // Handle messages from worker
  child.on("message", (msg: WorkerMessage) => {
    if (msg.type === "memory") {
      workerState.samples.push(msg);
    } else if (msg.type === "result") {
      console.log(`[Master] Worker ${workerId} completed successfully`);
      completedResults.set(workerId, msg.results);
      workerStats.push({
        id: workerId,
        files: batch.files.length,
        peakRSS: msg.peakRSS,
        duration: msg.duration,
      });
    } else if (msg.type === "error") {
      console.error(
        `[Master] Worker ${workerId} error: ${msg.errorType} - ${msg.message}`,
      );
      handleWorkerError(batch, msg.errorType, msg.message, msg.file);
    }
  });

  // Handle worker exit
  child.on("exit", (code, signal) => {
    activeWorkers.delete(workerId);

    // Detect OOM (SIGKILL or exit code 137)
    if (signal === "SIGKILL" || code === 137) {
      console.error(`[Master] Worker ${workerId} killed (OOM suspected)`);
      handleWorkerError(batch, "oom", "Process killed - likely OOM");
    } else if (code !== 0 && !completedResults.has(workerId)) {
      console.error(`[Master] Worker ${workerId} exited with code ${code}`);
      handleWorkerError(batch, "unknown", `Exit code ${code}`);
    }

    // Save worker memory timeline
    if (workerState.samples.length > 0) {
      const memFile = path.join(outputDir, `worker-${workerId}-memory.json`);
      fs.writeFileSync(memFile, JSON.stringify(workerState.samples, null, 2));
    }

    // Continue processing
    processNextBatch(configPath);
  });

  child.on("error", (err) => {
    console.error(`[Master] Worker ${workerId} spawn error:`, err.message);
    activeWorkers.delete(workerId);
    handleWorkerError(batch, "unknown", err.message);
    processNextBatch(configPath);
  });
}

function handleWorkerError(
  batch: Batch,
  errorType: "oom" | "parse_error" | "rule_crash" | "unknown",
  message: string,
  file?: string,
): void {
  if (
    errorType === "oom" &&
    batch.retries < CONFIG.maxRetries &&
    batch.files.length > 1
  ) {
    // Split batch and retry
    console.log(
      `[Master] Splitting batch ${batch.id} and retrying (attempt ${batch.retries + 1})`,
    );
    const newBatches = splitBatch(batch);
    pendingBatches.push(...newBatches);
  } else if (errorType === "parse_error" && file) {
    // Mark single file as failed
    failedFiles.push({ file, reason: errorType, message });
  } else {
    // Mark all files in batch as failed
    for (const f of batch.files) {
      failedFiles.push({ file: f, reason: errorType, message });
    }
  }
}

function processNextBatch(configPath: string): void {
  while (pendingBatches.length > 0 && canSpawnWorker()) {
    const batch = pendingBatches.shift()!;
    spawnWorker(batch, configPath);
  }

  // Check if all done
  if (pendingBatches.length === 0 && activeWorkers.size === 0) {
    finalize();
  }
}

// ============ Finalization ============
function finalize(): void {
  console.log("\n" + "=".repeat(50));
  console.log("[Master] All workers completed");
  console.log("=".repeat(50));

  // Aggregate results
  let totalErrors = 0;
  let totalWarnings = 0;
  let processedFiles = 0;

  for (const [workerId, results] of completedResults) {
    // Write per-worker results
    const resultFile = path.join(outputDir, `worker-${workerId}-results.json`);
    fs.writeFileSync(resultFile, JSON.stringify(results, null, 2));
    console.log(`[Master] Wrote ${resultFile}`);

    for (const r of results) {
      processedFiles++;
      totalErrors += r.errorCount;
      totalWarnings += r.warningCount;
    }
  }

  // Build summary
  const allFiles =
    workerStats.reduce((sum, w) => sum + w.files, 0) + failedFiles.length;
  const summary: Summary = {
    totalFiles: allFiles,
    processedFiles,
    failedFiles: failedFiles.length,
    totalErrors,
    totalWarnings,
    workers: workerStats,
    failures: failedFiles,
  };

  const summaryFile = path.join(outputDir, "summary.json");
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  // Print summary
  console.log("\n📊 Summary:");
  console.log(`  Total files: ${summary.totalFiles}`);
  console.log(`  Processed: ${summary.processedFiles}`);
  console.log(`  Failed: ${summary.failedFiles}`);
  console.log(`  Errors: ${summary.totalErrors}`);
  console.log(`  Warnings: ${summary.totalWarnings}`);
  console.log(`  Workers used: ${workerStats.length}`);

  if (failedFiles.length > 0) {
    console.log("\n❌ Failed files:");
    for (const f of failedFiles) {
      console.log(`  - ${f.file}: ${f.reason} - ${f.message}`);
    }
  }

  console.log("\n📁 Output:");
  console.log(`  ${outputDir}/`);
  console.log(`    - summary.json`);
  for (const w of workerStats) {
    console.log(`    - worker-${w.id}-results.json`);
    console.log(`    - worker-${w.id}-memory.json`);
  }

  process.exit(failedFiles.length > 0 ? 1 : 0);
}

// ============ Main ============
async function main(): Promise<void> {
  console.log("🚀 ESLint Master-Worker Orchestrator\n");

  // Show test mode if active
  if (testConfig.scenario !== "none") {
    console.log(`🧪 TEST MODE: ${testConfig.scenario}`);
    if (testConfig.targetFile) {
      console.log(`   Target file pattern: ${testConfig.targetFile}`);
    }
    console.log("");
  }

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Load and convert config (ONCE)
  const legacyConfigPath = path.join(projectRoot, ".eslintrc.json");
  if (!fs.existsSync(legacyConfigPath)) {
    console.error("❌ No .eslintrc.json found");
    process.exit(1);
  }

  const legacyConfig = ConfigConverter.loadLegacyConfig(legacyConfigPath);
  console.log("✓ Legacy config loaded");
  console.log(`  Parser: ${legacyConfig.parser}`);
  console.log(`  Rules: ${Object.keys(legacyConfig.rules ?? {}).length}`);

  const { source } = ConfigConverter.convert(legacyConfig);
  const flatConfigPath = path.join(projectRoot, "eslint.config.mjs");
  ConfigConverter.writeFlatConfig(source, flatConfigPath);
  console.log("✓ Flat config written to eslint.config.mjs\n");

  // 2. Find all TypeScript files
  const files = await glob("src/**/*.ts", { cwd: projectRoot, absolute: true });
  console.log(`✓ Found ${files.length} TypeScript files\n`);

  if (files.length === 0) {
    console.log("No files to lint.");
    process.exit(0);
  }

  // 3. Create initial batches
  const batches = createBatches(files);
  pendingBatches.push(...batches);
  console.log(`✓ Created ${batches.length} batches\n`);

  // 4. Start master memory profiling
  const profiler = new MemProfiler();
  profiler.start(500);

  // 5. Start processing
  console.log("[Master] Starting workers...\n");
  processNextBatch(flatConfigPath);

  // Save master memory on exit
  process.on("exit", () => {
    profiler.stop();
    profiler.dump(path.join(outputDir, "master-memory.json"));
  });
}

main().catch((err) => {
  console.error("💥 Master error:", err);
  process.exit(1);
});
