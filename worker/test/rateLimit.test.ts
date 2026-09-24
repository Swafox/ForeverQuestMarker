import { describe, expect, test } from "bun:test";
import {
  decideRateLimit,
  windowStart,
  type RateLimitInput,
} from "../src/rateLimit";

const HOUR = 3600;
const START = 1790000000 - (1790000000 % HOUR);

function input(overrides: Partial<RateLimitInput>): RateLimitInput {
  return {
    current: 1,
    previous: 0,
    now: START,
    windowSeconds: HOUR,
    limit: 20,
    ...overrides,
  };
}

/** Simulates one more attempt `wait` seconds later and says whether it is allowed. */
function allowedAfter(base: RateLimitInput, wait: number): boolean {
  const elapsed = base.now - windowStart(base.now, HOUR) + wait;
  const later =
    elapsed < HOUR
      ? { ...base, now: base.now + wait, current: base.current + 1 }
      : { ...base, now: base.now + wait, previous: base.current, current: 1 };
  if (elapsed >= 2 * HOUR) return true;
  return decideRateLimit(later).allowed;
}

describe("windowStart", () => {
  test("aligns to the window", () => {
    expect(windowStart(START + 1234, HOUR)).toBe(START);
    expect(windowStart(START, HOUR)).toBe(START);
  });
});

describe("decideRateLimit", () => {
  test("allows attempts up to the limit", () => {
    expect(decideRateLimit(input({ current: 20 })).allowed).toBe(true);
    expect(decideRateLimit(input({ current: 21 }))).toMatchObject({
      allowed: false,
    });
  });

  test("weights the previous window by its remaining overlap", () => {
    // At the start of a window the previous window counts fully.
    expect(decideRateLimit(input({ previous: 20, current: 1 })).allowed).toBe(
      false,
    );
    // Halfway through, it counts half: 10 + 10 = 20.
    expect(
      decideRateLimit(
        input({ previous: 20, current: 10, now: START + HOUR / 2 }),
      ).allowed,
    ).toBe(true);
    expect(
      decideRateLimit(
        input({ previous: 20, current: 11, now: START + HOUR / 2 }),
      ).allowed,
    ).toBe(false);
  });

  test("returns a retry delay after which one more attempt is allowed", () => {
    const cases = [
      input({ current: 21 }),
      input({ current: 21, now: START + 3000 }),
      input({ previous: 20, current: 1 }),
      input({ previous: 40, current: 5, now: START + 600 }),
      input({ current: 60, now: START + 3599 }),
    ];
    for (const base of cases) {
      const decision = decideRateLimit(base);
      expect(decision.allowed).toBe(false);
      expect(decision.retryAfter).toBeGreaterThan(0);
      expect(allowedAfter(base, decision.retryAfter)).toBe(true);
      if (decision.retryAfter > 1)
        expect(allowedAfter(base, decision.retryAfter - 1)).toBe(false);
    }
  });

  test("keeps a client that hammers the endpoint blocked into the next window", () => {
    const decision = decideRateLimit(
      input({ current: 500, now: START + 3500 }),
    );
    expect(decision.retryAfter).toBeGreaterThan(100);
  });
});
