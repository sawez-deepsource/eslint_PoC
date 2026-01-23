// src/tools/mem-profiler.ts - Memory profiling utility

import fs from "fs";

interface MemorySampleData {
  ts: number;
  label: string;
  pid: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  rssMB: number;
  heapTotalMB: number;
  heapUsedMB: number;
  externalMB: number;
  arrayBuffersMB: number;
}

function mb(n: number): number {
  return Number((n / 1024 / 1024).toFixed(2));
}

export class MemProfiler {
  private timeline: MemorySampleData[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = 100): void {
    this.timer = setInterval(() => {
      this.sample("interval");
    }, intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  sample(label: string): MemorySampleData {
    const m = process.memoryUsage();
    const arrayBuffers = m.arrayBuffers ?? 0;

    const data: MemorySampleData = {
      ts: Date.now(),
      label,
      pid: process.pid,

      // raw bytes (for exact thresholds)
      rss: m.rss,
      heapTotal: m.heapTotal,
      heapUsed: m.heapUsed,
      external: m.external,
      arrayBuffers,

      // human readable (for debugging / graphs)
      rssMB: mb(m.rss),
      heapTotalMB: mb(m.heapTotal),
      heapUsedMB: mb(m.heapUsed),
      externalMB: mb(m.external),
      arrayBuffersMB: mb(arrayBuffers),
    };

    this.timeline.push(data);
    return data;
  }

  getPeakRSS(): number {
    if (this.timeline.length === 0) return 0;
    return Math.max(...this.timeline.map((s) => s.rss));
  }

  getTimeline(): MemorySampleData[] {
    return this.timeline;
  }

  dump(file = "memory-timeline.json"): void {
    fs.writeFileSync(file, JSON.stringify(this.timeline, null, 2));
  }
}
