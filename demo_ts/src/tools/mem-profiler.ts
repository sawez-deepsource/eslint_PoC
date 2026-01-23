import fs from "fs";

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
      rss: m.rss,
      heapTotal: m.heapTotal,
      heapUsed: m.heapUsed,
      external: m.external,
      arrayBuffers: (m as any).arrayBuffers,
    });
  }

  dump(file = "memory-timeline.json") {
    fs.writeFileSync(file, JSON.stringify(this.timeline, null, 2));
  }
}
