/**
 * Token bucket for one socket's events: allows `burst` at once, refilling at
 * `perSecond`. Returns a function that says whether the next event may proceed.
 */
export function tokenBucket(perSecond: number, burst: number, now: () => number = Date.now) {
  let tokens = burst;
  let last = now();
  return () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
