// src/tools/worker.ts - Isolated ESLint worker process

import { ESLint } from "eslint";
import { LintTask, LintResult, WorkerError, MemorySample } from "./types.ts";
import {
  getTestConfig,
  shouldSimulateFailure,
  executeFailure,
} from "./test-scenarios.ts";

let workerId = -1;
let peakRSS = 0;

// Load test config once
const testConfig = getTestConfig();

function sendMessage(msg: LintResult | WorkerError | MemorySample) {
  if (process.send) {
    process.send(msg);
  }
}

function sampleMemory(): number {
  const mem = process.memoryUsage();
  if (mem.rss > peakRSS) {
    peakRSS = mem.rss;
  }

  sendMessage({
    type: "memory",
    workerId,
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    timestamp: Date.now(),
  });

  return mem.rss;
}

async function runLint(task: LintTask): Promise<void> {
  workerId = task.workerId;
  const startTime = Date.now();

  console.log(
    `[Worker ${workerId}] Starting lint of ${task.files.length} files`,
  );

  if (testConfig.scenario !== "none") {
    console.log(`[Worker ${workerId}] 🧪 Test mode: ${testConfig.scenario}`);
  }

  // Start memory sampling
  const memInterval = setInterval(() => sampleMemory(), 200);

  try {
    // ============ TEST HOOK: Pre-lint failures ============
    // Check each file for simulated failures BEFORE linting
    for (const file of task.files) {
      const { shouldFail, failureType } = shouldSimulateFailure(
        file,
        testConfig,
      );
      if (shouldFail && failureType) {
        clearInterval(memInterval);
        executeFailure(failureType, file);
        // If executeFailure didn't exit/throw (e.g., slow), continue
      }
    }
    // ======================================================

    // Initialize ESLint with the pre-generated flat config
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: task.configPath,
      cache: false,
    });

    sampleMemory();

    // Lint the assigned files
    const results = await eslint.lintFiles(task.files);

    sampleMemory();
    clearInterval(memInterval);

    const duration = Date.now() - startTime;

    console.log(
      `[Worker ${workerId}] Completed in ${duration}ms, peak RSS: ${(peakRSS / 1024 / 1024).toFixed(1)}MB`,
    );

    // Send results back to master
    sendMessage({
      type: "result",
      workerId,
      results,
      peakRSS,
      duration,
    });
  } catch (error: unknown) {
    clearInterval(memInterval);

    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Worker ${workerId}] Error:`, errMsg);

    // Classify the error
    let errorType: "parse_error" | "rule_crash" | "unknown" = "unknown";
    let file: string | undefined;

    if (errMsg.includes("Parsing error") || errMsg.includes("parserServices")) {
      errorType = "parse_error";
      // Try to extract file from error
      const match = errMsg.match(/in\s+([^\s:]+)/);
      if (match) file = match[1];
    } else if (errMsg.includes("Rule ") || errMsg.includes("rule '")) {
      errorType = "rule_crash";
    }

    sendMessage({
      type: "error",
      workerId,
      errorType,
      message: errMsg,
      file,
    });
  }

  // Exit cleanly
  process.exit(0);
}

// Listen for task from master
process.on("message", (msg: LintTask) => {
  if (msg.type === "lint") {
    runLint(msg).catch((err) => {
      console.error(`[Worker ${workerId}] Fatal:`, err);
      process.exit(1);
    });
  }
});

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  console.error(`[Worker ${workerId}] Uncaught:`, err.message);
  sendMessage({
    type: "error",
    workerId,
    errorType: "unknown",
    message: err.message,
  });
  process.exit(1);
});

console.log(`[Worker] Process started, PID: ${process.pid}`);
