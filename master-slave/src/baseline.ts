// src/baseline.ts - Single-process baseline for comparison

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ESLint } from "eslint";
import { MemProfiler } from "./mem-profiler.ts";
import { ConfigConverter } from "./config-converter.ts";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ CLI Arguments ============
function parseArgs(): { targetPath: string; globPattern: string; showHelp: boolean } {
  const args = process.argv.slice(2);
  let targetPath = "";
  let globPattern = "src/**/*.ts"; // Default pattern
  let showHelp = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg.startsWith("--target=")) {
      targetPath = arg.replace("--target=", "");
    } else if (arg.startsWith("--glob=")) {
      globPattern = arg.replace("--glob=", "");
    }
  }

  return { targetPath, globPattern, showHelp };
}

const { targetPath: cliTargetPath, globPattern, showHelp } = parseArgs();

// Check for --help flag
if (showHelp) {
  console.log(`
BASELINE ESLint Analyzer (Single Process)
=========================================

Usage: npm run baseline -- --target=/path/to/codebase

Required:
  --target=<path>    Path to the codebase to analyze (must have .eslintrc.json)

Options:
  --glob=<pattern>   Glob pattern for TypeScript files (default: "src/**/*.ts")
                     Examples: --glob="packages/**/*.ts" (monorepos)
  --help, -h         Show this help message

This runs ESLint in a single process for comparison with the master-slave approach.
Use this to compare memory usage and performance.
`);
  process.exit(0);
}

if (!cliTargetPath) {
  console.error("Error: --target argument is required");
  console.error("Usage: npm run baseline -- --target=/path/to/codebase");
  process.exit(1);
}

// Resolve target path
const targetPath = path.resolve(cliTargetPath);

if (!fs.existsSync(targetPath)) {
  console.error(`Error: Target path does not exist: ${targetPath}`);
  process.exit(1);
}

const toolRoot = path.resolve(__dirname, "..");
const outputDir = path.join(toolRoot, "baseline-output");

async function main() {
  console.log("ESLint Baseline (Single Process)\n");
  console.log(`Target: ${targetPath}\n`);

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Load ESLint config
  const existingFlatConfig = path.join(targetPath, "eslint.config.mjs");
  const legacyConfigPath = path.join(targetPath, ".eslintrc.json");
  let flatConfigPath: string;

  if (fs.existsSync(existingFlatConfig)) {
    console.log("Using existing eslint.config.mjs\n");
    flatConfigPath = existingFlatConfig;
  } else if (fs.existsSync(legacyConfigPath)) {
    const legacyConfig = ConfigConverter.loadLegacyConfig(legacyConfigPath);
    console.log("Legacy config loaded");
    console.log(`  - Parser: ${legacyConfig.parser}`);
    console.log(`  - Rules: ${Object.keys(legacyConfig.rules || {}).length}\n`);

    const { source } = ConfigConverter.convert(legacyConfig);
    flatConfigPath = path.join(targetPath, "eslint.config.generated.mjs");
    ConfigConverter.writeFlatConfig(source, flatConfigPath);
  } else {
    console.error(`Error: No ESLint config found at ${targetPath}`);
    console.error("Expected: eslint.config.mjs or .eslintrc.json");
    process.exit(1);
  }

  // 3. Start profiling
  const profiler = new MemProfiler();
  profiler.start(100);
  profiler.sample("before-eslint");

  // 4. Initialize ESLint
  const eslint = new ESLint({
    cwd: targetPath,
    overrideConfigFile: flatConfigPath,
    cache: false,
  });

  profiler.sample("after-init");
  console.log("ESLint initialized\n");

  // 5. Run ESLint
  console.log(`Linting ${globPattern}...\n`);

  let results;
  try {
    results = await eslint.lintFiles([globPattern]);
    profiler.sample("after-lint");
  } catch (error: unknown) {
    profiler.sample("error");
    profiler.stop();
    profiler.dump(path.join(outputDir, "memory-timeline-error.json"));

    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("ESLint failed:");
    console.error(errMsg);

    if (errMsg.includes("parserServices")) {
      console.error("\nParser issue detected. Check:");
      console.error("   - TypeScript ESLint version (need v8+ for ESLint v9)");
      console.error("   - tsconfig.json exists and includes src files");
    }

    process.exit(1);
  }

  // 6. Save results
  const resultsFile = path.join(outputDir, "eslint-results.json");
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  profiler.stop();
  profiler.dump(path.join(outputDir, "memory-timeline.json"));

  // 7. Summary
  const totalIssues = results.reduce(
    (s, r) => s + r.errorCount + r.warningCount,
    0,
  );
  const totalErrors = results.reduce((s, r) => s + r.errorCount, 0);
  const totalWarnings = results.reduce((s, r) => s + r.warningCount, 0);

  console.log("Complete!\n");
  console.log("Results:");
  console.log(`  - Target: ${targetPath}`);
  console.log(`  - Files: ${results.length}`);
  console.log(`  - Issues: ${totalIssues}`);
  console.log(`    - Errors: ${totalErrors}`);
  console.log(`    - Warnings: ${totalWarnings}`);
  console.log(`  - Peak RSS: ${(profiler.getPeakRSS() / 1024 / 1024).toFixed(1)}MB\n`);

  console.log("Output:");
  console.log(`  ${outputDir}/`);
  console.log("    - eslint-results.json");
  console.log("    - memory-timeline.json");

  // Top issues
  if (totalIssues > 0) {
    const issuesByRule = new Map<string, number>();
    results.forEach((r) => {
      r.messages.forEach((msg) => {
        const rule = msg.ruleId || "unknown";
        issuesByRule.set(rule, (issuesByRule.get(rule) || 0) + 1);
      });
    });

    const top5 = Array.from(issuesByRule.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    console.log("\nTop 5 Issues:");
    top5.forEach(([rule, count], i) => {
      console.log(`  ${i + 1}. ${rule}: ${count}x`);
    });
  }

  // Write summary
  const summary = {
    targetPath,
    totalFiles: results.length,
    totalErrors,
    totalWarnings,
    peakRSS: profiler.getPeakRSS(),
    peakRSSMB: (profiler.getPeakRSS() / 1024 / 1024).toFixed(1),
  };
  fs.writeFileSync(
    path.join(outputDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
