import { describe, expect, test } from "bun:test";
import {
  mergeConfirmed,
  parseCommunityFile,
  serializeCommunityFile,
  type CommunityFile,
  type KnownQuestSets,
} from "./community";
import type { ConfirmedQuest } from "./workerApi";

const EMPTY_FILE = `{
  "description": "Quest IDs confirmed as new in WoW Forever by community reports.",
  "quests": []
}
`;

const sets: KnownQuestSets = {
  classic: new Set([176]),
  datamined: new Set([92401]),
  sod: new Set([79000]),
  era: new Set([9999]),
};

function confirmed(
  id: number,
  overrides: Partial<ConfirmedQuest> = {},
): ConfirmedQuest {
  return {
    id,
    title: `Quest ${id}`,
    reporters: 3,
    firstReported: "2026-09-20T10:00:00.000Z",
    confirmedBy: "auto",
    ...overrides,
  };
}

describe("community file format", () => {
  test("round-trips the committed layout byte for byte", () => {
    expect(serializeCommunityFile(parseCommunityFile(EMPTY_FILE, "test"))).toBe(
      EMPTY_FILE,
    );
    const withEntries = `{
  "description": "d",
  "quests": [
    {
      "id": 120001,
      "title": "Into the Ruins",
      "note": "3 independent reports, first 2026-09-20",
      "source": "pipeline"
    }
  ]
}
`;
    expect(
      serializeCommunityFile(parseCommunityFile(withEntries, "test")),
    ).toBe(withEntries);
  });

  test("writes entry keys in a fixed order and keeps unknown keys", () => {
    const file: CommunityFile = {
      description: "d",
      quests: [
        {
          source: "manual",
          note: "n",
          id: 5,
          extra: true,
        } as unknown as CommunityFile["quests"][number],
      ],
    };
    expect(
      Object.keys(JSON.parse(serializeCommunityFile(file)).quests[0]),
    ).toEqual(["id", "note", "source", "extra"]);
  });

  test("rejects malformed files", () => {
    expect(() => parseCommunityFile(`{"quests": []}`, "x.json")).toThrow(
      "x.json",
    );
    expect(() =>
      parseCommunityFile(
        `{"description": "d", "quests": [{"id": "5"}]}`,
        "x.json",
      ),
    ).toThrow("quests[0]");
    expect(() =>
      parseCommunityFile(
        `{"description": "d", "quests": [{"id": 5, "note": 1}]}`,
        "x.json",
      ),
    ).toThrow("note");
  });
});

describe("mergeConfirmed", () => {
  const file = parseCommunityFile(EMPTY_FILE, "test");

  test("adds new quests sorted by ID with a pipeline source and a note", () => {
    const result = mergeConfirmed(
      file,
      [confirmed(120005), confirmed(120001, { confirmedBy: "admin" })],
      sets,
    );
    expect(result.added).toEqual([
      {
        id: 120001,
        title: "Quest 120001",
        note: "3 independent reports, first 2026-09-20, confirmed by a reviewer",
        source: "pipeline",
      },
      {
        id: 120005,
        title: "Quest 120005",
        note: "3 independent reports, first 2026-09-20",
        source: "pipeline",
      },
    ]);
    expect(result.file.quests.map((entry) => entry.id)).toEqual([
      120001, 120005,
    ]);
    expect(result.file.description).toBe(file.description);
  });

  test("skips quests the local data already classifies", () => {
    const result = mergeConfirmed(
      file,
      [
        confirmed(176),
        confirmed(92401),
        confirmed(79000),
        confirmed(9999),
        confirmed(120001),
      ],
      sets,
    );
    expect(result.added.map((entry) => entry.id)).toEqual([120001]);
    expect(result.skipped).toEqual([
      { id: 176, reason: "original Classic quest" },
      { id: 9999, reason: "present in the Classic Era client" },
      { id: 79000, reason: "Season of Discovery quest" },
      { id: 92401, reason: "already in the datamined Forever list" },
    ]);
  });

  test("never modifies existing entries and changes nothing when nothing is new", () => {
    const existing: CommunityFile = {
      description: "d",
      quests: [
        {
          id: 130000,
          title: "Hand-written title",
          note: "added by hand",
          source: "manual",
        },
        { id: 120001, title: "Old title" },
      ],
    };
    const before = serializeCommunityFile(existing);
    const result = mergeConfirmed(
      existing,
      [confirmed(120001, { title: "New title" }), confirmed(130000)],
      sets,
    );
    expect(result.added).toEqual([]);
    expect(result.alreadyListed).toEqual([120001, 130000]);
    expect(result.file).toBe(existing);
    expect(serializeCommunityFile(result.file)).toBe(before);
  });

  test("sorts the whole list when it adds something", () => {
    const existing: CommunityFile = {
      description: "d",
      quests: [{ id: 130000 }, { id: 110000 }],
    };
    const result = mergeConfirmed(existing, [confirmed(120000)], sets);
    expect(result.file.quests.map((entry) => entry.id)).toEqual([
      110000, 120000, 130000,
    ]);
  });

  test("is deterministic regardless of input order and duplicates", () => {
    const quests = [
      confirmed(120003),
      confirmed(120001),
      confirmed(120002),
      confirmed(120001),
    ];
    const a = serializeCommunityFile(mergeConfirmed(file, quests, sets).file);
    const b = serializeCommunityFile(
      mergeConfirmed(file, [...quests].reverse(), sets).file,
    );
    expect(a).toBe(b);
    expect(JSON.parse(a).quests).toHaveLength(3);
  });

  test("omits the title when the Worker has none", () => {
    const result = mergeConfirmed(
      file,
      [confirmed(120001, { title: null })],
      sets,
    );
    expect(result.added[0]).toEqual({
      id: 120001,
      note: "3 independent reports, first 2026-09-20",
      source: "pipeline",
    });
  });
});
