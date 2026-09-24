import { describe, expect, test } from "bun:test";
import {
  hasAgreement,
  leader,
  normalizeTitle,
  titleConsensus,
} from "../src/consensus";
import {
  conflictingLocales,
  giverVoteValue,
  summarize,
  type Vote,
} from "../src/summary";

describe("normalizeTitle", () => {
  test("ignores case and whitespace differences", () => {
    expect(normalizeTitle("  Into   the\u00a0RUINS ")).toBe("into the ruins");
    expect(normalizeTitle("Der Weg nach S\u00fcden")).toBe(
      normalizeTitle("der weg nach su\u0308den"),
    );
  });

  test("keeps meaningful differences", () => {
    expect(normalizeTitle("Into the Ruins")).not.toBe(
      normalizeTitle("Into the Ruin"),
    );
  });
});

describe("hasAgreement", () => {
  test("requires at least two thirds", () => {
    expect(hasAgreement(2, 3)).toBe(true);
    expect(hasAgreement(1, 2)).toBe(false);
    expect(hasAgreement(6, 9)).toBe(true);
    expect(hasAgreement(66, 100)).toBe(false);
    expect(hasAgreement(67, 100)).toBe(true);
    expect(hasAgreement(0, 0)).toBe(false);
  });
});

describe("leader", () => {
  test("picks the highest count and breaks ties deterministically", () => {
    expect(
      leader([
        { value: "b", count: 2 },
        { value: "a", count: 2 },
        { value: "c", count: 1 },
      ]),
    ).toEqual({
      value: "a",
      count: 2,
      total: 5,
    });
    expect(leader([])).toBeNull();
    expect(leader([{ value: "a", count: 0 }])).toBeNull();
  });
});

describe("titleConsensus", () => {
  test("groups spellings that differ only in case or whitespace", () => {
    const consensus = titleConsensus([
      { value: "Into the Ruins", count: 3 },
      { value: "into the ruins", count: 1 },
      { value: "Into  the Ruins", count: 1 },
      { value: "Out of the Ruins", count: 1 },
    ]);
    expect(consensus).toEqual({
      title: "Into the Ruins",
      normalized: "into the ruins",
      reports: 5,
      total: 6,
      variants: 2,
      agreed: true,
    });
  });

  test("reports a conflict below two thirds", () => {
    const consensus = titleConsensus([
      { value: "Into the Ruins", count: 3 },
      { value: "Beyond the Wall", count: 2 },
    ]);
    expect(consensus?.agreed).toBe(false);
    expect(consensus?.title).toBe("Into the Ruins");
  });
});

describe("summarize", () => {
  const giver = (
    type: "npc" | "object",
    id: number | null,
    name: string | null,
  ) => giverVoteValue({ type, id, name })!;

  const votes: Vote[] = [
    { dimension: "title", locale: "enUS", value: "Into the Ruins", count: 3 },
    { dimension: "title", locale: "deDE", value: "In die Ruinen", count: 1 },
    { dimension: "title", locale: "deDE", value: "Ruinen", count: 1 },
    { dimension: "level", locale: "enUS", value: "17", count: 3 },
    { dimension: "level", locale: "deDE", value: "18", count: 2 },
    {
      dimension: "giver",
      locale: "deDE",
      value: giver("npc", 4001, "Späherin Aldren"),
      count: 2,
    },
    {
      dimension: "giver",
      locale: "enUS",
      value: giver("npc", 4001, "Scout Aldren"),
      count: 1,
    },
    {
      dimension: "giver",
      locale: "enUS",
      value: giver("object", 700, "Chest"),
      count: 2,
    },
    { dimension: "map", locale: "", value: "1436", count: 4 },
    { dimension: "map", locale: "", value: "1429", count: 1 },
  ];

  test("summarizes titles and levels per locale, sorted by locale", () => {
    const summary = summarize(votes);
    expect(Object.keys(summary.locales)).toEqual(["deDE", "enUS"]);
    expect(summary.locales["enUS"]).toEqual({
      reports: 3,
      title: "Into the Ruins",
      titleReports: 3,
      titleVariants: 1,
      agreed: true,
      level: 17,
      levelReports: 3,
    });
    expect(summary.locales["deDE"]!.agreed).toBe(false);
    expect(conflictingLocales(summary)).toEqual(["deDE"]);
    expect(summary.level).toEqual({ value: 17, reports: 3, total: 5 });
  });

  test("picks the most reported giver across locales and prefers its enUS name", () => {
    expect(summarize(votes).giver).toEqual({
      type: "npc",
      id: 4001,
      name: "Scout Aldren",
      reports: 3,
    });
  });

  test("picks the most reported map", () => {
    expect(summarize(votes).map).toEqual({ id: 1436, reports: 4, total: 5 });
  });

  test("ignores givers with neither ID nor name", () => {
    expect(
      giverVoteValue({ type: "unknown", id: null, name: null }),
    ).toBeNull();
    expect(giverVoteValue(null)).toBeNull();
  });

  test("handles an empty vote list", () => {
    expect(summarize([])).toEqual({
      locales: {},
      level: null,
      giver: null,
      map: null,
    });
  });
});
