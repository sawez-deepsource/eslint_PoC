// src/tools/test-scenarios.ts - Test utilities for simulating failures

export type TestScenario =
  | "none" // Normal operation
  | "oom-single" // OOM on one file (recoverable)
  | "oom-persistent" // OOM that keeps failing (tests max retries)
  | "parse-error" // Syntax error in file
  | "rule-crash" // ESLint rule throws
  | "random-oom" // Random OOM (50% chance)
  | "slow-worker" // Worker takes very long (timeout test)
  | "all"; // Run multiple scenarios

export interface TestConfig {
  scenario: TestScenario;
  targetFile?: string; // File pattern to trigger on
  oomRetryCount?: number; // How many times to fail before succeeding (for oom-single)
}

// Track OOM attempts per file (for recoverable OOM testing)
const oomAttempts = new Map<string, number>();

/**
 * Check if we should simulate a failure for this file
 */
export function shouldSimulateFailure(
  file: string,
  config: TestConfig,
): { shouldFail: boolean; failureType?: string } {
  const targetPattern = config.targetFile ?? "orderService";
  const isTargetFile = file.includes(targetPattern);

  switch (config.scenario) {
    case "none":
      return { shouldFail: false };

    case "oom-single": {
      // Fail first N times, then succeed (tests retry logic)
      if (!isTargetFile) return { shouldFail: false };

      const attempts = oomAttempts.get(file) ?? 0;
      const maxFails = config.oomRetryCount ?? 1;

      if (attempts < maxFails) {
        oomAttempts.set(file, attempts + 1);
        return { shouldFail: true, failureType: "oom" };
      }
      return { shouldFail: false };
    }

    case "oom-persistent": {
      // Always fail on target file (tests permanent failure)
      if (isTargetFile) {
        return { shouldFail: true, failureType: "oom" };
      }
      return { shouldFail: false };
    }

    case "parse-error": {
      if (isTargetFile) {
        return { shouldFail: true, failureType: "parse-error" };
      }
      return { shouldFail: false };
    }

    case "rule-crash": {
      if (isTargetFile) {
        return { shouldFail: true, failureType: "rule-crash" };
      }
      return { shouldFail: false };
    }

    case "random-oom": {
      // 30% chance of OOM on any file
      if (Math.random() < 0.3) {
        return { shouldFail: true, failureType: "oom" };
      }
      return { shouldFail: false };
    }

    case "slow-worker": {
      if (isTargetFile) {
        return { shouldFail: true, failureType: "slow" };
      }
      return { shouldFail: false };
    }

    case "all": {
      // Cycle through different failures based on file
      if (file.includes("orderService")) {
        return { shouldFail: true, failureType: "oom" };
      }
      if (file.includes("userService")) {
        return { shouldFail: true, failureType: "parse-error" };
      }
      if (file.includes("db")) {
        return { shouldFail: true, failureType: "rule-crash" };
      }
      return { shouldFail: false };
    }

    default:
      return { shouldFail: false };
  }
}

/**
 * Execute the simulated failure
 */
export function executeFailure(
  failureType: string,
  file: string,
): never | void {
  switch (failureType) {
    case "oom":
      console.log(`[TEST] 💥 Simulating OOM on ${file}`);
      process.exit(137);

    case "parse-error":
      console.log(`[TEST] 💥 Simulating parse error on ${file}`);
      throw new Error(
        `Parsing error: Unexpected token in ${file}. Expected ';' but found 'const'.`,
      );

    case "rule-crash":
      console.log(`[TEST] 💥 Simulating rule crash on ${file}`);
      throw new Error(
        `Rule '@typescript-eslint/no-unsafe-assignment' threw: Cannot read property 'type' of undefined`,
      );

    case "slow":
      console.log(`[TEST] 🐢 Simulating slow processing on ${file}`);
      // Block for 30 seconds
      const start = Date.now();
      while (Date.now() - start < 30000) {
        // Busy wait
      }
      break;

    default:
      console.log(`[TEST] Unknown failure type: ${failureType}`);
  }
}

/**
 * Parse test scenario from command line or env
 */
export function getTestConfig(): TestConfig {
  // Check command line args
  const args = process.argv.slice(2);

  for (const arg of args) {
    if (arg.startsWith("--test=")) {
      const scenario = arg.replace("--test=", "") as TestScenario;
      return { scenario };
    }
    if (arg.startsWith("--test-file=")) {
      const targetFile = arg.replace("--test-file=", "");
      return { scenario: "oom-single", targetFile };
    }
  }

  // Check environment variable
  const envScenario = process.env.TEST_SCENARIO as TestScenario;
  if (envScenario) {
    return {
      scenario: envScenario,
      targetFile: process.env.TEST_TARGET_FILE,
      oomRetryCount: process.env.TEST_OOM_RETRIES
        ? parseInt(process.env.TEST_OOM_RETRIES)
        : undefined,
    };
  }

  return { scenario: "none" };
}

/**
 * Print available test scenarios
 */
export function printTestHelp(): void {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    TEST SCENARIOS AVAILABLE                       ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Usage: npm run master -- --test=<scenario>                       ║
║                                                                   ║
║  Scenarios:                                                       ║
║  ──────────────────────────────────────────────────────────────── ║
║  none           Normal operation (default)                        ║
║  oom-single     OOM on one file, succeeds after retry             ║
║  oom-persistent OOM that keeps failing (tests max retries)        ║
║  parse-error    Simulates TypeScript parse error                  ║
║  rule-crash     Simulates ESLint rule throwing error              ║
║  random-oom     30% chance of OOM on any file                     ║
║  slow-worker    Worker hangs for 30s (timeout test)               ║
║  all            Multiple failure types on different files         ║
║                                                                   ║
║  Options:                                                         ║
║  ──────────────────────────────────────────────────────────────── ║
║  --test-file=<pattern>   Target specific file (default: orderService) ║
║                                                                   ║
║  Environment Variables:                                           ║
║  ──────────────────────────────────────────────────────────────── ║
║  TEST_SCENARIO=oom-single                                         ║
║  TEST_TARGET_FILE=userService                                     ║
║  TEST_OOM_RETRIES=2                                               ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
`);
}
