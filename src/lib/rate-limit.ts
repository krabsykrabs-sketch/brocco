/**
 * Minimal in-memory sliding-window rate limiter.
 * Adequate for this app's single long-running container (Coolify/Docker) —
 * would need a shared store (Redis) if the app ever runs multiple replicas.
 */

interface Window {
  timestamps: number[];
}

const buckets = new Map<string, Window>();
let lastSweep = 0;

/**
 * Returns true if the action is allowed, false if the limit is exceeded.
 * Sliding window: at most `limit` hits per `windowMs` per key.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Opportunistic cleanup so abandoned keys don't accumulate forever
  if (now - lastSweep > 10 * 60 * 1000) {
    lastSweep = now;
    for (const [k, w] of buckets) {
      if (w.timestamps.length === 0 || w.timestamps[w.timestamps.length - 1] < now - windowMs) {
        buckets.delete(k);
      }
    }
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }

  bucket.timestamps = bucket.timestamps.filter((t) => t > now - windowMs);
  if (bucket.timestamps.length >= limit) return false;

  bucket.timestamps.push(now);
  return true;
}

/**
 * Client IP as seen by OUR proxy. Traefik appends to x-forwarded-for, so
 * the LEFTMOST entry is whatever the client chose to send — keying limits
 * on it let anyone reset every bucket per request. x-real-ip is set by the
 * proxy itself; failing that, the rightmost forwarded hop is the one it saw.
 */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return "unknown";
}
