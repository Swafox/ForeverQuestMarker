/**
 * Sliding-window rate limiting over fixed-window counters: the previous
 * window's count is weighted by how much of it still overlaps the sliding
 * window. Every attempt is counted, including rejected ones.
 */

export interface RateLimitInput {
  /** Attempts in the current window, including this one. */
  current: number;
  /** Attempts in the previous window. */
  previous: number;
  now: number;
  windowSeconds: number;
  limit: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until another attempt would be allowed (0 when allowed). */
  retryAfter: number;
}

export function windowStart(now: number, windowSeconds: number): number {
  return now - (now % windowSeconds);
}

function estimate(
  current: number,
  previous: number,
  elapsed: number,
  windowSeconds: number,
): number {
  return (previous * (windowSeconds - elapsed)) / windowSeconds + current;
}

export function decideRateLimit(input: RateLimitInput): RateLimitDecision {
  const { current, previous, now, windowSeconds, limit } = input;
  const elapsed = now - windowStart(now, windowSeconds);
  if (estimate(current, previous, elapsed, windowSeconds) <= limit) {
    return { allowed: true, retryAfter: 0 };
  }
  // Earliest second at which one more attempt fits: first in the rest of this
  // window, then in the next one (where the current count becomes "previous").
  for (let wait = 1; wait < windowSeconds * 2; wait++) {
    const at = elapsed + wait;
    const fits =
      at < windowSeconds
        ? estimate(current + 1, previous, at, windowSeconds) <= limit
        : estimate(1, current, at - windowSeconds, windowSeconds) <= limit;
    if (fits) return { allowed: false, retryAfter: wait };
  }
  return { allowed: false, retryAfter: windowSeconds * 2 };
}
