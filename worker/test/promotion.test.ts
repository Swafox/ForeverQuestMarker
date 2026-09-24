import { describe, expect, test } from "bun:test";
import {
  decideStatus,
  idRangeIssue,
  type CandidateState,
  type PromotionConfig,
} from "../src/promotion";

const config: PromotionConfig = { minClients: 3, minNetworks: 2 };

function state(overrides: Partial<CandidateState> = {}): CandidateState {
  return {
    id: 120001,
    status: "pending",
    source: "auto",
    reporters: 3,
    networks: 2,
    conflictingLocales: [],
    ...overrides,
  };
}

describe("decideStatus for pending candidates", () => {
  test("waits until both thresholds are met", () => {
    expect(decideStatus(state({ reporters: 2 }), config)).toBeNull();
    expect(decideStatus(state({ networks: 1 }), config)).toBeNull();
    expect(
      decideStatus(state({ reporters: 10, networks: 1 }), config),
    ).toBeNull();
  });

  test("confirms at the thresholds when titles agree", () => {
    expect(decideStatus(state(), config)).toEqual({
      status: "confirmed",
      reason: "3 installations on 2 networks agree on the title",
    });
  });

  test("honours configured thresholds", () => {
    const strict = { minClients: 5, minNetworks: 4 };
    expect(
      decideStatus(state({ reporters: 4, networks: 4 }), strict),
    ).toBeNull();
    expect(
      decideStatus(state({ reporters: 5, networks: 4 }), strict)?.status,
    ).toBe("confirmed");
  });

  test("flags conflicting titles instead of confirming", () => {
    expect(
      decideStatus(state({ conflictingLocales: ["enUS", "deDE"] }), config),
    ).toEqual({
      status: "flagged",
      reason: "conflicting titles in enUS, deDE",
    });
  });

  test("does not flag conflicts before the thresholds are met", () => {
    expect(
      decideStatus(
        state({ reporters: 2, conflictingLocales: ["enUS"] }),
        config,
      ),
    ).toBeNull();
  });

  test.each([
    [1, "flagged"],
    [10000, "flagged"],
    [10001, "confirmed"],
    [200000, "confirmed"],
    [200001, "flagged"],
    [999999, "flagged"],
  ])("ID %p is %p", (id, expected) => {
    expect(decideStatus(state({ id }), config)?.status).toBe(
      expected as "flagged" | "confirmed",
    );
  });

  test("lists every reason for a flag", () => {
    expect(
      decideStatus(state({ id: 5000, conflictingLocales: ["enUS"] }), config)
        ?.reason,
    ).toBe(
      "quest ID 5000 is in the cut or unused vanilla range (<= 10000); conflicting titles in enUS",
    );
  });

  test("evaluates admin-reset pending candidates the same way", () => {
    expect(decideStatus(state({ source: "admin" }), config)?.status).toBe(
      "confirmed",
    );
  });
});

describe("decideStatus for decided candidates", () => {
  test("flags an automatically confirmed candidate whose consensus is lost", () => {
    expect(
      decideStatus(
        state({ status: "confirmed", conflictingLocales: ["enUS"] }),
        config,
      ),
    ).toEqual({
      status: "flagged",
      reason: "title consensus lost: conflicting titles in enUS",
    });
    expect(decideStatus(state({ status: "confirmed" }), config)).toBeNull();
  });

  test("never overrides a manual confirmation", () => {
    expect(
      decideStatus(
        state({
          status: "confirmed",
          source: "admin",
          conflictingLocales: ["enUS"],
        }),
        config,
      ),
    ).toBeNull();
  });

  test("leaves flagged and rejected candidates to manual review", () => {
    expect(decideStatus(state({ status: "flagged" }), config)).toBeNull();
    expect(
      decideStatus(
        state({ status: "rejected", reporters: 50, networks: 50 }),
        config,
      ),
    ).toBeNull();
  });
});

describe("idRangeIssue", () => {
  test("describes out-of-range IDs only", () => {
    expect(idRangeIssue(92401)).toBeNull();
    expect(idRangeIssue(9999)).toContain("vanilla range");
    expect(idRangeIssue(250000)).toContain("above 200000");
  });
});
