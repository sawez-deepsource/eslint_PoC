// src/tools/baseline.ts

import fs from "fs";
import path from "path";
import { ESLint } from "eslint";
import { MemProfiler } from "./mem-profiler.ts";
import { ConfigConverter } from "./config-converter.ts";

const projectRoot = process.cwd();

async function main() {
  console.log("🚀 Starting ESLint Baseline\n");

  // 1. Load legacy config
  const legacyConfigPath = path.join(projectRoot, ".eslintrc.json");

  if (!fs.existsSync(legacyConfigPath)) {
    console.error("❌ No .eslintrc.json found");
    process.exit(1);
  }

  const legacyConfig = ConfigConverter.loadLegacyConfig(legacyConfigPath);
  console.log("✓ Legacy config loaded");
  console.log(`  - Parser: ${legacyConfig.parser}`);
  console.log(`  - Rules: ${Object.keys(legacyConfig.rules || {}).length}\n`);

  // 2. Convert to flat config
  const { source } = ConfigConverter.convert(legacyConfig);
  const flatConfigPath = path.join(projectRoot, "eslint.config.mjs");
  ConfigConverter.writeFlatConfig(source, flatConfigPath);
  console.log("✓ Flat config written\n");

  // 3. Start profiling
  const profiler = new MemProfiler();
  profiler.start(100);
  profiler.sample("before-eslint");

  // 4. Initialize ESLint
  const eslint = new ESLint({
    cwd: projectRoot,
    overrideConfigFile: flatConfigPath,
    cache: false,
  });

  profiler.sample("after-init");
  console.log("✓ ESLint initialized\n");

  // 5. Run ESLint
  console.log("🔍 Linting src/**/*.ts...\n");

  let results;
  try {
    results = await eslint.lintFiles(["src/**/*.ts"]);
    profiler.sample("after-lint");
  } catch (error: any) {
    profiler.sample("error");
    profiler.stop();
    profiler.dump("memory-timeline-error.json");

    console.error("❌ ESLint failed:");
    console.error(error.message);

    if (error.message.includes("parserServices")) {
      console.error("\n💡 Parser issue detected. Check:");
      console.error("   - TypeScript ESLint version (need v8+ for ESLint v9)");
      console.error("   - tsconfig.json exists and includes src files");
    }

    process.exit(1);
  }

  // 6. Save results
  fs.writeFileSync("eslint-results.json", JSON.stringify(results, null, 2));
  profiler.stop();
  profiler.dump("memory-timeline.json");

  // 7. Summary
  const totalIssues = results.reduce(
    (s, r) => s + r.errorCount + r.warningCount,
    0,
  );
  const totalErrors = results.reduce((s, r) => s + r.errorCount, 0);
  const totalWarnings = results.reduce((s, r) => s + r.warningCount, 0);

  console.log("✅ Complete!\n");
  console.log("📊 Results:");
  console.log(`  - Files: ${results.length}`);
  console.log(`  - Issues: ${totalIssues}`);
  console.log(`    • Errors: ${totalErrors}`);
  console.log(`    • Warnings: ${totalWarnings}\n`);

  console.log("📁 Output:");
  console.log("  - eslint-results.json");
  console.log("  - memory-timeline.json");
  console.log("  - eslint.config.mjs");

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

    console.log("\n🔝 Top 5 Issues:");
    top5.forEach(([rule, count], i) => {
      console.log(`  ${i + 1}. ${rule}: ${count}x`);
    });
  }
}

main().catch((err) => {
  console.error("\n💥 Error:", err.message);
  process.exit(1);
});
