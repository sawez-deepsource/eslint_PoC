# ESLint Master-Worker Orchestrator

A memory-aware, fault-tolerant parallel ESLint runner for  codebases.

---

## Problem

Running ESLint with TypeScript type-checking on large repos causes:
- 💥 Memory exhaustion (OOM kills)
- 🔄 No recovery from crashes
- 🐌 Single-threaded bottleneck

---

## Solution

Master-worker architecture that:
- ✅ Distributes linting across isolated processes
- ✅ Monitors memory and gates worker spawning
- ✅ Recovers from OOM by splitting batches
- ✅ Generates config once, shares with all workers

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MASTER PROCESS                          │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Config    │  │    File     │  │      Memory Monitor     │  │
│  │  Converter  │  │  Discovery  │  │                         │  │
│  │             │  │             │  │  • Track RSS per worker │  │
│  │ .eslintrc → │  │ glob src/   │  │  • Gate spawning <75%   │  │
│  │ flat config │  │  **/*.ts    │  │  • Detect OOM kills     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    BATCH SCHEDULER                         │  │
│  │                                                            │  │
│  │  Files ──► Batches ──► Workers ──► Results                 │  │
│  │                                                            │  │
│  │  On OOM: split batch ──► retry                             │  │
│  │  On success: collect ──► aggregate                         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ fork() + IPC
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
   │  WORKER 0   │     │  WORKER 1   │     │  WORKER N   │
   │             │     │             │     │             │
   │ • Load TS   │     │ • Load TS   │     │ • Load TS   │
   │   Program   │     │   Program   │     │   Program   │
   │ • Lint      │     │ • Lint      │     │ • Lint      │
   │   assigned  │     │   assigned  │     │   assigned  │
   │   files     │     │   files     │     │   files     │
   │ • Report    │     │ • Report    │     │ • Report    │
   │   results   │     │   results   │     │   results   │
   └─────────────┘     └─────────────┘     └─────────────┘
```

---

## Data Flow

```
1. STARTUP
   │
   ├──► Load .eslintrc.json
   ├──► Convert to flat config (once)
   ├──► Glob all *.ts files
   └──► Create batches (files ÷ 4)

2. SCHEDULING LOOP
   │
   ├──► Check: pending batches?
   ├──► Check: memory < 75%?
   ├──► Check: workers < max?
   │
   ├──► YES to all ──► Spawn worker with batch
   └──► NO ──► Wait for worker to finish

3. WORKER LIFECYCLE
   │
   ├──► Receive: { configPath, files[] }
   ├──► Load ESLint + TS Program
   ├──► Lint assigned files
   ├──► Send: { results[], peakRSS, duration }
   └──► Exit

4. ERROR HANDLING
   │
   ├──► OOM detected ──► Split batch ──► Retry
   ├──► Parse error ──► Mark file failed ──► Continue
   └──► Max retries ──► Mark failed ──► Continue

5. FINALIZATION
   │
   ├──► Aggregate all results
   ├──► Write per-worker JSON files
   └──► Write summary.json
```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run the orchestrator
npm run master

# 3. Check results
cat lint-output/summary.json
```

---

## Output Structure

```
lint-output/
├── summary.json            # Aggregated results & stats
├── master-memory.json      # Master process memory timeline
├── worker-0-results.json   # ESLint output from worker 0
├── worker-0-memory.json    # Memory timeline from worker 0
├── worker-1-results.json
├── worker-1-memory.json
└── ...
```

### summary.json
```json
{
  "totalFiles": 18,
  "processedFiles": 18,
  "failedFiles": 0,
  "totalErrors": 72,
  "totalWarnings": 3,
  "workers": [
    { "id": 0, "files": 5, "peakRSS": 335278080, "duration": 2212 },
    { "id": 1, "files": 5, "peakRSS": 346599424, "duration": 2395 }
  ],
  "failures": []
}
```

---

## Configuration

Edit `CONFIG` in `src/tools/master.ts`:

```typescript
const CONFIG = {
  maxWorkers: 2,              // Max concurrent workers
  maxRetries: 2,              // OOM retry attempts per batch
  memoryThresholdPercent: 75, // Spawn gate (% of container limit)
  containerLimitMB: 4096,     // Container memory limit (4GB)
  initialBatchDivisor: 4,     // Initial batch size = files ÷ 4
};
```

### Tuning Guide

| Scenario | Adjustment |
|----------|------------|
| Small repo (<50 files) | `initialBatchDivisor: 2` |
| Large repo (500+ files) | `initialBatchDivisor: 8` |
| High memory machine | `maxWorkers: 4`, `containerLimitMB: 8192` |
| Tight memory | `maxWorkers: 1`, `memoryThresholdPercent: 60` |

---

## Error Handling

| Error Type | Detection | Action |
|------------|-----------|--------|
| **OOM** | Exit code 137 / SIGKILL | Split batch in half, retry |
| **Parse Error** | "Parsing error" in message | Mark file as failed, continue |
| **Rule Crash** | "Rule" in error message | Mark file as failed, continue |
| **Unknown** | Other non-zero exit | Mark batch as failed |

### Retry Flow
```
Batch (10 files) ──► OOM
        │
        ▼
Split into 2 batches (5 files each)
        │
        ├──► Batch A: Success ✓
        │
        └──► Batch B: OOM again
                │
                ▼
        Split into 2 batches (2-3 files each)
                │
                ├──► Batch C: Success ✓
                │
                └──► Batch D: OOM (max retries)
                        │
                        ▼
                Mark 2-3 files as FAILED
```

---

## Testing Failure Scenarios

Built-in test modes to verify fault tolerance without breaking real code.

### Available Test Scenarios

| Scenario | What It Does |
|----------|--------------|
| `none` | Normal operation (default) |
| `oom-single` | OOM once, succeeds on retry |
| `oom-persistent` | OOM always, exhausts retries |
| `parse-error` | Simulates TypeScript syntax error |
| `rule-crash` | Simulates ESLint rule throwing |
| `random-oom` | 30% chance OOM on any file |
| `all` | Different failures on different files |

### Run Tests

```bash
# See all options
npm run master:help

# Normal run (no simulation)
npm run master

# Test: OOM that recovers after retry
npm run test:oom-recover

# Test: OOM that fails permanently
npm run test:oom-fail

# Test: Parse error handling
npm run test:parse-error

# Test: ESLint rule crash
npm run test:rule-crash

# Test: Random failures (chaos mode)
npm run test:random

# Test: All failure types
npm run test:all
```

### Custom Test Target

```bash
# Target specific file pattern
npx tsx src/tools/master.ts --test=oom-single --test-file=userService

# Using environment variables
TEST_SCENARIO=oom-persistent TEST_TARGET_FILE=db npm run master
```

### Expected Output by Test

#### `npm run test:oom-recover`
```
[Master] Spawning worker 0 for batch 0 (5 files)
[Worker 0] 🧪 Test mode: oom-single
[TEST] 💥 Simulating OOM on orderService.ts
[Master] Worker 0 killed (OOM suspected)
[Master] Splitting batch 0 and retrying (attempt 1)
[Master] Spawning worker 1 for batch 4 (3 files)
[Master] Spawning worker 2 for batch 5 (2 files)
[Worker 1] Completed successfully
[Worker 2] Completed successfully

📊 Summary:
  Total files: 18
  Processed: 18
  Failed: 0
```

#### `npm run test:oom-fail`
```
[Master] Spawning worker 0 for batch 0 (5 files)
[TEST] 💥 Simulating OOM on orderService.ts
[Master] Worker 0 killed (OOM suspected)
[Master] Splitting batch 0 and retrying (attempt 1)
...
[Master] Splitting batch 6 and retrying (attempt 2)
...
[Master] Max retries exceeded, marking files as failed

📊 Summary:
  Total files: 18
  Processed: 17
  Failed: 1

❌ Failed files:
  - orderService.ts: oom - Process killed - likely OOM
```

#### `npm run test:parse-error`
```
[Master] Spawning worker 0 for batch 0 (5 files)
[TEST] 💥 Simulating parse error on orderService.ts
[Worker 0] Error: Parsing error: Unexpected token...
[Master] Worker 0 error: parse_error

📊 Summary:
  Total files: 18
  Processed: 17
  Failed: 1

❌ Failed files:
  - orderService.ts: parse_error - Parsing error...
```

---

## File Structure

```
src/tools/
├── master.ts           # Orchestrator
│                       # • Spawns workers
│                       # • Monitors memory
│                       # • Handles failures
│                       # • Aggregates results
│
├── worker.ts           # Isolated lint process
│                       # • Receives file batch
│                       # • Loads ESLint + TS
│                       # • Reports results via IPC
│
├── types.ts            # Shared TypeScript types
│                       # • IPC message interfaces
│                       # • Batch, Worker, Summary types
│
├── config-converter.ts # Legacy → Flat config
│                       # • Reads .eslintrc.json
│                       # • Generates eslint.config.mjs
│
├── mem-profiler.ts     # Memory sampling utility
│                       # • Periodic RSS tracking
│                       # • Timeline generation
│
├── test-scenarios.ts   # Test utilities
│                       # • Failure simulation
│                       # • CLI flag parsing
│
└── baseline.ts         # Single-process baseline
                        # • For comparison only
```

---

## IPC Protocol

### Master → Worker
```typescript
{
  type: "lint",
  workerId: number,
  configPath: string,    // Path to eslint.config.mjs
  files: string[]        // Absolute paths to lint
}
```

### Worker → Master
```typescript
// Success
{
  type: "result",
  workerId: number,
  results: ESLint.LintResult[],
  peakRSS: number,
  duration: number
}

// Error
{
  type: "error",
  workerId: number,
  errorType: "oom" | "parse_error" | "rule_crash" | "unknown",
  message: string,
  file?: string
}

// Memory sample (periodic)
{
  type: "memory",
  workerId: number,
  rss: number,
  heapUsed: number,
  timestamp: number
}
```

---

## Performance Comparison

| Metric | Baseline | Master-Worker |
|--------|----------|---------------|
| Main Process RSS | 327 MB | 90 MB |
| Duration | 2.1s | 5.0s |
| Fault Tolerance | ❌ None | ✅ Full |
| OOM Recovery | ❌ Crash | ✅ Retry |
| Parallelism | ❌ Single | ✅ Multi |

### When to Use What

| Scenario | Recommendation |
|----------|----------------|
| Small repo (<50 files) | Baseline |
| CI (speed critical) | Baseline |
| Large repo (500+ files) | Master-Worker |
| Production (reliability) | Master-Worker |
| Memory-constrained | Master-Worker |

---

## Next Steps

### Phase 1: Persistent Workers (Planned)
Keep workers alive to reuse TS Program across batches.
```
Before: Spawn → Load TS → Lint → Die (repeat)
After:  Spawn → Load TS → Lint → Lint → Lint → Die
```
**Expected: ~50% speedup**

### Phase 2: Shared TS Program (Research)
Single TS Program shared across workers via tsserver or cache.
```
Before: 4 workers × 330MB = 1.3GB
After:  1 shared × 330MB = 330MB
```
**Expected: ~75% memory reduction**

---

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run master` | Run orchestrator (normal mode) |
| `npm run master:help` | Show test options |
| `npm run baseline` | Run single-process (comparison) |
| `npm run test:oom-recover` | Test OOM recovery |
| `npm run test:oom-fail` | Test OOM permanent failure |
| `npm run test:parse-error` | Test parse error handling |
| `npm run test:rule-crash` | Test rule crash handling |
| `npm run test:random` | Test random failures |
| `npm run test:all` | Test all failure types |

