import { describe, expect, test } from "bun:test";
import {
  EARLIEST_TIMESTAMP,
  MAX_CLOCK_SKEW,
  MAX_ERRORS,
  MAX_QUESTS,
  parseExport,
  validateExport,
  type ValidationError,
} from "../src/validate";
import { exportDocument, NOW, questRecord, type Json } from "./fixtures";

function errorsFor(document: unknown): ValidationError[] {
  const result = validateExport(document, NOW);
  if (result.ok) throw new Error("expected the document to be rejected");
  return result.errors;
}

function questErrors(overrides: Json): ValidationError[] {
  return errorsFor(exportDocument([questRecord(120001, overrides)]));
}

function paths(errors: ValidationError[]): string[] {
  return errors.map((error) => error.path);
}

describe("valid documents", () => {
  test("accepts the documented example and normalizes records", () => {
    const result = validateExport(
      exportDocument([
        questRecord(92401, { title: "  Into the Ruins  " }),
        {
          id: 176,
          title: 'Wanted: "Hogger"',
          state: "classic",
          contexts: ["log"],
          firstSeen: NOW - 100,
          lastSeen: NOW - 100,
          seenCount: 1,
        },
      ]),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second] = result.document.quests;
    expect(first!.title).toBe("Into the Ruins");
    expect(first!.giver).toEqual({
      type: "npc",
      id: 4001,
      name: "Scout Aldren",
    });
    expect(second).toEqual({
      id: 176,
      title: 'Wanted: "Hogger"',
      state: "classic",
      level: null,
      giver: null,
      map: null,
      x: null,
      y: null,
      faction: null,
      contexts: ["log"],
      firstSeen: NOW - 100,
      lastSeen: NOW - 100,
      seenCount: 1,
      accepted: null,
      turnedIn: null,
    });
  });

  test("treats null optional fields as absent and ignores unknown fields", () => {
    const result = validateExport(
      exportDocument(
        [
          questRecord(120001, {
            level: null,
            giver: null,
            x: null,
            y: null,
            extra: 1,
          }),
        ],
        {
          comment: "ignored",
        },
      ),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.quests[0]!.level).toBeNull();
      expect(result.document.quests[0]!.x).toBeNull();
    }
  });

  test("accepts non-Latin titles and a giver without an ID", () => {
    const result = validateExport(
      exportDocument(
        [
          questRecord(120001, {
            title: "В руины",
            giver: { type: "object", name: "Сундук" },
          }),
        ],
        { locale: "ruRU" },
      ),
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  test("accepts a title of exactly 200 characters, counted by code point", () => {
    expect(
      validateExport(
        exportDocument([questRecord(120001, { title: "a".repeat(200) })]),
        NOW,
      ).ok,
    ).toBe(true);
    expect(
      validateExport(
        exportDocument([
          questRecord(120001, { title: "\u{1F5E1}".repeat(200) }),
        ]),
        NOW,
      ).ok,
    ).toBe(true);
  });

  test("parseExport tolerates a byte order mark and surrounding whitespace", () => {
    const text = `\ufeff\n  ${JSON.stringify(exportDocument([questRecord(120001)]))}\n\n`;
    expect(parseExport(text, NOW).ok).toBe(true);
  });
});

describe("document-level errors", () => {
  test("rejects text that is not JSON, and an empty body", () => {
    const truncated = JSON.stringify(
      exportDocument([questRecord(120001)]),
    ).slice(0, 120);
    const result = parseExport(truncated, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]!.message).toContain("not valid JSON");
    expect(parseExport("   ", NOW).ok).toBe(false);
  });

  test("rejects non-objects", () => {
    expect(
      errorsFor([exportDocument([questRecord(120001)])])[0]!.message,
    ).toContain("JSON object");
    expect(errorsFor("export")[0]!.path).toBe("");
  });

  test("stops at an unknown format or version", () => {
    expect(
      paths(
        errorsFor(exportDocument([questRecord(120001)], { format: "Questie" })),
      ),
    ).toEqual(["format"]);
    expect(
      paths(errorsFor(exportDocument([questRecord(120001)], { version: 2 }))),
    ).toEqual(["version"]);
    expect(
      paths(errorsFor(exportDocument([questRecord(120001)], { version: "1" }))),
    ).toEqual(["version"]);
  });

  test.each([
    ["3F9C2A7BE4D1409A"],
    ["3f9c2a7be4d1409"],
    ["3f9c2a7be4d1409ab"],
    ["3f9c2a7be4d1409g"],
    [12345],
  ])("rejects clientId %p", (clientId) => {
    expect(
      paths(errorsFor(exportDocument([questRecord(120001)], { clientId }))),
    ).toEqual(["clientId"]);
  });

  test.each([
    ["1.60.1"],
    ["1.60.1.69977a"],
    ["v1.60.1.69977"],
    [" 1.60.1.69977"],
  ])("rejects build %p", (build) => {
    expect(
      paths(errorsFor(exportDocument([questRecord(120001)], { build }))),
    ).toEqual(["build"]);
  });

  test("rejects an unknown locale, a bad interface and a bad addon version", () => {
    const errors = errorsFor(
      exportDocument([questRecord(120001)], {
        locale: "xxXX",
        interface: 1.5,
        addonVersion: "<b>",
      }),
    );
    expect(paths(errors).sort()).toEqual([
      "addonVersion",
      "interface",
      "locale",
    ]);
  });

  test("rejects a count that does not match the records (truncated copy)", () => {
    const errors = errorsFor(
      exportDocument([questRecord(120001), questRecord(120002)], { count: 3 }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe("count");
    expect(errors[0]!.message).toContain("not copied completely");
  });

  test("rejects an empty quest list and more than the maximum number of quests", () => {
    expect(paths(errorsFor(exportDocument([])))).toEqual(["quests"]);
    const many = Array.from({ length: MAX_QUESTS + 1 }, (_, i) =>
      questRecord(120001 + i),
    );
    expect(paths(errorsFor(exportDocument(many)))).toEqual(["count", "quests"]);
  });

  test("rejects exportedAt before 2026 or in the future", () => {
    expect(
      paths(
        errorsFor(
          exportDocument([questRecord(120001)], {
            exportedAt: EARLIEST_TIMESTAMP - 1,
          }),
        ),
      ),
    ).toEqual(["exportedAt"]);
    expect(
      paths(
        errorsFor(
          exportDocument([questRecord(120001)], {
            exportedAt: NOW + MAX_CLOCK_SKEW + 1,
          }),
        ),
      ),
    ).toEqual(["exportedAt"]);
    expect(
      validateExport(
        exportDocument([questRecord(120001)], {
          exportedAt: NOW + MAX_CLOCK_SKEW,
        }),
        NOW,
      ).ok,
    ).toBe(true);
  });
});

describe("quest record errors", () => {
  test.each([[0], [1_000_001], [1.5], ["92401"], [null]])(
    "rejects id %p",
    (id) => {
      expect(paths(questErrors({ id }))).toEqual(["quests[0].id"]);
    },
  );

  test.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["too long", "a".repeat(201)],
    ["a newline", "Into the\nRuins"],
    ["a tab", "Into\tthe Ruins"],
    ["a NUL character", "Into\u0000the Ruins"],
    ["a color escape", "|cffff0000Into the Ruins|r"],
    [
      "a texture escape",
      "|TInterface\\Icons\\INV_Misc_QuestionMark:0|t Into the Ruins",
    ],
    ["a zero-width space", "Into\u200bthe Ruins"],
    ["a right-to-left override", "Into \u202eseniuR"],
    ["a lone surrogate", "Into the Ruins \ud800"],
    ["a number", 42],
  ])("rejects a title with %s", (_label, title) => {
    expect(paths(questErrors({ title }))).toEqual(["quests[0].title"]);
  });

  test("rejects a missing title", () => {
    const record = questRecord(120001);
    delete record["title"];
    expect(errorsFor(exportDocument([record]))).toEqual([
      { path: "quests[0].title", message: "is required" },
    ]);
  });

  test("rejects an unknown state and out-of-range level", () => {
    expect(paths(questErrors({ state: "new" }))).toEqual(["quests[0].state"]);
    expect(paths(questErrors({ level: 0 }))).toEqual(["quests[0].level"]);
    expect(paths(questErrors({ level: 101 }))).toEqual(["quests[0].level"]);
  });

  test("validates the giver object", () => {
    expect(paths(questErrors({ giver: "Guard" }))).toEqual(["quests[0].giver"]);
    expect(paths(questErrors({ giver: { type: "player", id: 1 } }))).toEqual([
      "quests[0].giver.type",
    ]);
    expect(paths(questErrors({ giver: { type: "npc", id: -4 } }))).toEqual([
      "quests[0].giver.id",
    ]);
    expect(
      paths(questErrors({ giver: { type: "npc", name: "x".repeat(201) } })),
    ).toEqual(["quests[0].giver.name"]);
    expect(
      paths(questErrors({ giver: { type: "npc", name: "Guard|r" } })),
    ).toEqual(["quests[0].giver.name"]);
  });

  test("validates map and coordinates", () => {
    expect(paths(questErrors({ map: 0 }))).toEqual(["quests[0].map"]);
    expect(paths(questErrors({ x: 1.5 }))).toEqual(["quests[0].x"]);
    expect(paths(questErrors({ y: -0.1 }))).toEqual(["quests[0].y"]);
    expect(paths(questErrors({ y: undefined }))).toEqual(["quests[0].x"]);
  });

  test("validates faction, flags and counters", () => {
    expect(paths(questErrors({ faction: "Scourge" }))).toEqual([
      "quests[0].faction",
    ]);
    expect(paths(questErrors({ accepted: "yes" }))).toEqual([
      "quests[0].accepted",
    ]);
    expect(paths(questErrors({ turnedIn: 1 }))).toEqual(["quests[0].turnedIn"]);
    expect(paths(questErrors({ seenCount: 0 }))).toEqual([
      "quests[0].seenCount",
    ]);
  });

  test("validates contexts", () => {
    expect(
      validateExport(
        exportDocument([questRecord(120001, { contexts: [] })]),
        NOW,
      ).ok,
    ).toBe(true);
    expect(paths(questErrors({ contexts: "log" }))).toEqual([
      "quests[0].contexts",
    ]);
    expect(paths(questErrors({ contexts: undefined }))).toEqual([
      "quests[0].contexts",
    ]);
    expect(paths(questErrors({ contexts: ["log", "mailbox"] }))).toEqual([
      "quests[0].contexts[1]",
    ]);
    expect(paths(questErrors({ contexts: ["log", "log"] }))).toEqual([
      "quests[0].contexts[1]",
    ]);
  });

  test("validates timestamps", () => {
    expect(paths(questErrors({ firstSeen: EARLIEST_TIMESTAMP - 1 }))).toEqual([
      "quests[0].firstSeen",
    ]);
    expect(paths(questErrors({ lastSeen: NOW + MAX_CLOCK_SKEW + 60 }))).toEqual(
      ["quests[0].lastSeen"],
    );
    expect(
      paths(questErrors({ firstSeen: NOW - 10, lastSeen: NOW - 20 })),
    ).toEqual(["quests[0].lastSeen"]);
    expect(paths(questErrors({ firstSeen: "2026-09-01" }))).toEqual([
      "quests[0].firstSeen",
    ]);
  });

  test("rejects duplicate quest IDs", () => {
    const errors = errorsFor(
      exportDocument([
        questRecord(120001),
        questRecord(120002),
        questRecord(120001),
      ]),
    );
    expect(errors).toEqual([
      {
        path: "quests[2].id",
        message: "duplicates quest 120001 from quests[0]",
      },
    ]);
  });

  test("reports every broken field with a precise path", () => {
    const errors = errorsFor(
      exportDocument([
        questRecord(120001),
        questRecord(120002, { title: "", level: 500, contexts: ["nowhere"] }),
      ]),
    );
    expect(paths(errors)).toEqual([
      "quests[1].title",
      "quests[1].level",
      "quests[1].contexts[0]",
    ]);
  });

  test("caps the error list", () => {
    const broken = Array.from({ length: 300 }, (_, i) =>
      questRecord(120001 + i, { title: "" }),
    );
    const result = validateExport(exportDocument(broken), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(MAX_ERRORS);
      expect(result.truncated).toBe(true);
    }
  });

  test("accepts original Classic IDs; classification, not validation, keeps them out of promotion", () => {
    expect(
      validateExport(
        exportDocument([questRecord(176, { state: "confirmed" })]),
        NOW,
      ).ok,
    ).toBe(true);
  });
});
