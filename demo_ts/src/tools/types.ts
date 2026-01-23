// src/tools/types.ts - Shared types for master-worker IPC

import { ESLint } from "eslint";

// Master → Worker
export interface LintTask {
  type: "lint";
  workerId: number;
  configPath: string;
  files: string[];
}

// Worker → Master
export interface LintResult {
  type: "result";
  workerId: number;
  results: ESLint.LintResult[];
  peakRSS: number;
  duration: number;
}

export interface WorkerError {
  type: "error";
  workerId: number;
  errorType: "oom" | "parse_error" | "rule_crash" | "unknown";
  message: string;
  file?: string;
}

export interface MemorySample {
  type: "memory";
  workerId: number;
  rss: number;
  heapUsed: number;
  timestamp: number;
}

export type WorkerMessage = LintResult | WorkerError | MemorySample;

// Job tracking
export interface Batch {
  id: number;
  files: string[];
  retries: number;
}

export interface WorkerState {
  id: number;
  pid: number;
  batch: Batch;
  startTime: number;
  samples: MemorySample[];
}

export interface FailedFile {
  file: string;
  reason: "oom" | "parse_error" | "rule_crash" | "unknown";
  message: string;
}

export interface Summary {
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  totalErrors: number;
  totalWarnings: number;
  workers: {
    id: number;
    files: number;
    peakRSS: number;
    duration: number;
  }[];
  failures: FailedFile[];
}
