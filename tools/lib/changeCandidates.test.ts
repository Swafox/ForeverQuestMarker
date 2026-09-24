import { describe, expect, test } from "bun:test";
import type { QuestieQuestFacts } from "../data/parse";
import {
  findChangeCandidates,
  normalizeTitle,
  renderChangeReport,
} from "./changeCandidates";
import type { ClassicObservation, LocaleObservation } from "./workerApi";

const facts = new Map<number, QuestieQuestFacts>([
  [176, { name: 'Wanted: "Hogger"', requiredLevel: 5, questLevel: 11 }],
  [2, { name: "Sharptalon's Claw", requiredLevel: 20, questLevel: 24 }],
  [
    9665,
    { name: "Bolstering Our Defenses", requiredLevel: 55, questLevel: 60 },
  ],
  [7, { name: "Kobold Camp Cleanup", requiredLevel: 1, questLevel: -1 }],
]);

function locale(
  title: string,
  overrides: Partial<LocaleObservation> = {},
): LocaleObservation {
  return {
    title,
    titleReports: 3,
    reports: 3,
    agreed: true,
    level: null,
    levelReports: 0,
    ...overrides,
  };
}

function observation(
  id: number,
  locales: Record<string, LocaleObservation>,
  level: ClassicObservation["level"] = null,
): ClassicObservation {
  return { id, reporters: 3, level, locales };
}

const options = { minReports: 2 };

describe("findChangeCandidates", () => {
  test("ignores differences in case and whitespace", () => {
    expect(normalizeTitle('  Wanted:  "HOGGER" ')).toBe(
      normalizeTitle('Wanted: "Hogger"'),
    );
    const result = findChangeCandidates(
      [
        observation(
          176,
          { enUS: locale('wanted:  "hogger"') },
          { value: 11, reports: 3, total: 3 },
        ),
      ],
      facts,
      new Set(),
      options,
    );
    expect(result.candidates).toEqual([]);
  });

  test("reports a changed English title", () => {
    const result = findChangeCandidates(
      [
        observation(2, {
          enUS: locale("Sharptalon's Talon"),
          deDE: locale("Scharfkralles Klaue"),
        }),
      ],
      facts,
      new Set(),
      options,
    );
    expect(result.candidates).toEqual([
      {
        id: 2,
        kinds: ["title"],
        questieName: "Sharptalon's Claw",
        questieLevel: 24,
        observedTitle: "Sharptalon's Talon",
        titleReports: 3,
        titleTotal: 3,
        observedLevel: null,
        levelReports: 0,
        levelTotal: 0,
        alreadyRecorded: false,
      },
    ]);
  });

  test("reports a changed level, observed in any locale", () => {
    const result = findChangeCandidates(
      [
        observation(
          9665,
          { deDE: locale("Die Verteidigung stärken") },
          { value: 58, reports: 4, total: 5 },
        ),
      ],
      facts,
      new Set([9665]),
      options,
    );
    expect(result.candidates).toMatchObject([
      {
        id: 9665,
        kinds: ["level"],
        observedLevel: 58,
        questieLevel: 60,
        observedTitle: null,
        alreadyRecorded: true,
      },
    ]);
  });

  test("requires enough agreeing reports", () => {
    const tooFew = findChangeCandidates(
      [
        observation(
          2,
          { enUS: locale("Other", { titleReports: 1, reports: 1 }) },
          { value: 30, reports: 1, total: 1 },
        ),
      ],
      facts,
      new Set(),
      options,
    );
    expect(tooFew.candidates).toEqual([]);
    const disputed = findChangeCandidates(
      [
        observation(
          2,
          {
            enUS: locale("Other", {
              titleReports: 3,
              reports: 6,
              agreed: false,
            }),
          },
          { value: 30, reports: 3, total: 6 },
        ),
      ],
      facts,
      new Set(),
      options,
    );
    expect(disputed.candidates).toEqual([]);
  });

  test("skips quests without a QuestieDB baseline and levels QuestieDB does not fix", () => {
    const result = findChangeCandidates(
      [
        observation(65593, { enUS: locale("Hearts of the Lovers") }),
        observation(
          7,
          { enUS: locale("Kobold Camp Cleanup") },
          { value: 3, reports: 3, total: 3 },
        ),
      ],
      facts,
      new Set(),
      options,
    );
    expect(result).toEqual({ candidates: [], observed: 2, withoutBaseline: 1 });
  });
});

describe("renderChangeReport", () => {
  const context = {
    generatedAt: "2026-09-23T12:00:00.000Z",
    workerUrl: "https://fqm.example.workers.dev",
    questie: "Questie/QuestieDB@3a1dc8886f85",
    minReports: 2,
  };

  test("renders a table and escapes pipes", () => {
    const comparison = findChangeCandidates(
      [
        observation(2, { enUS: locale("Claw | Talon") }),
        observation(
          9665,
          { enUS: locale("Bolstering Our Defenses") },
          { value: 58, reports: 3, total: 3 },
        ),
      ],
      facts,
      new Set([9665]),
      options,
    );
    const report = renderChangeReport(comparison, context);
    expect(report).toContain("## New candidates (1)");
    expect(report).toContain(
      "| 2 | title | Sharptalon's Claw | Claw \\| Talon (3/3) | 24 | - |",
    );
    expect(report).toContain("## Already in changed.json (1)");
    expect(report).toContain(
      "| 9665 | level | Bolstering Our Defenses | Bolstering Our Defenses (3/3) | 60 | 58 (3/3) |",
    );
    expect(report).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  test("says so when there is nothing to review", () => {
    const report = renderChangeReport(
      { candidates: [], observed: 0, withoutBaseline: 0 },
      context,
    );
    expect(report).toContain("## New candidates (0)\n\nNone.");
    expect(report).not.toContain("Already in changed.json");
  });
});
