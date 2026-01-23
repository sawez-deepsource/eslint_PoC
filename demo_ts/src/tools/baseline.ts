import fs from "fs";
import { ESLint } from "eslint";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import { MemProfiler } from "./mem-profiler.ts";

const profiler = new MemProfiler();

async function main() {
  profiler.start(100);
  profiler.sample("process-start");

  const legacyConfig = JSON.parse(fs.readFileSync(".eslintrc.json", "utf8"));
  profiler.sample("loaded-legacy-config");

  const compat = new FlatCompat({
    baseDirectory: process.cwd(),
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
  });
  profiler.sample("flatcompat-init");

  const flatConfig = compat.config(legacyConfig);
  fs.writeFileSync("flat-config.json", JSON.stringify(flatConfig, null, 2));
  profiler.sample("flatcompat-conversion-done");

  const eslint = new ESLint({
    overrideConfig: flatConfig,
    useEslintrc: false,
  });
  profiler.sample("eslint-sdk-init");

  const results = await eslint.lintFiles(["src/**/*.ts"]);
  profiler.sample("lint-finished");

  fs.writeFileSync("eslint-results.json", JSON.stringify(results, null, 2));

  profiler.stop();
  profiler.dump();

  console.log("Baseline run complete");
  console.log(
    "Peak heap:",
    Math.max(...profiler["timeline"].map((x) => x.heapUsed)) / 1024 / 1024,
    "MB",
  );
}

process.on("uncaughtException", (e) => {
  profiler.sample("crash");
  profiler.dump("memory-crash.json");
  throw e;
});

process.on("SIGTERM", () => {
  profiler.sample("sigterm");
  profiler.dump("memory-sigterm.json");
  process.exit(1);
});

main();
