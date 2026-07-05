interface Window {
  count: number;
  startedAt: number;
}

/** Tiny in-memory fixed-window rate limiter (per key, e.g. per IP). */
export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if the call is allowed, false if the key is over the limit. */
  allow(key: string, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.startedAt >= this.windowMs) {
      this.windows.set(key, { count: 1, startedAt: now });
      if (this.windows.size > 10000) this.prune(now);
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, w] of this.windows) {
      if (now - w.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
