import fs from "fs";

function mb(n: number) {
  return Number((n / 1024 / 1024).toFixed(2));
}

export class MemProfiler {
  private timeline: any[] = [];
  private timer: NodeJS.Timer | null = null;

  start(intervalMs = 100) {
    this.timer = setInterval(() => {
      this.sample("interval");
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  sample(label: string) {
    const m = process.memoryUsage();

    this.timeline.push({
      ts: Date.now(),
      label,
      pid: process.pid,

      // raw bytes (for exact thresholds)
      rss: m.rss,
      heapTotal: m.heapTotal,
      heapUsed: m.heapUsed,
      external: m.external,
      arrayBuffers: (m as any).arrayBuffers,

      // human readable (for debugging / graphs)
      rssMB: mb(m.rss),
      heapTotalMB: mb(m.heapTotal),
      heapUsedMB: mb(m.heapUsed),
      externalMB: mb(m.external),
      arrayBuffersMB: mb((m as any).arrayBuffers),
    });
  }

  dump(file = "memory-timeline.json") {
    fs.writeFileSync(file, JSON.stringify(this.timeline, null, 2));
  }
}
