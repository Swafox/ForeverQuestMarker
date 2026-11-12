import { describe, expect, test } from "bun:test";
import {
  mergePlaces,
  parsePlacesFile,
  placeFromReport,
  PLACES_DESCRIPTION,
  serializePlacesFile,
  type PlacesFile,
} from "./places";
import type { PlaceReport } from "./workerApi";

const options = { minReports: 2 };
const isNew = (id: number) => id >= 90000;

function report(id: number, overrides: Partial<PlaceReport> = {}): PlaceReport {
  return {
    id,
    reporters: 3,
    giver: { type: "npc", id: 3142, reports: 3, total: 3 },
    position: { map: 1411, x: 0.45, y: 0.61, reports: 3, total: 3 },
    ...overrides,
  };
}

const empty = (): PlacesFile => ({
  description: PLACES_DESCRIPTION,
  quests: [],
});

describe("placeFromReport", () => {
  test("uses an agreed giver and position", () => {
    expect(placeFromReport(report(99048), options)).toEqual({
      id: 99048,
      giver: { type: "npc", id: 3142 },
      map: 1411,
      x: 0.45,
      y: 0.61,
      reporters: 3,
    });
  });

  test("keeps the giver without a position players disagree on", () => {
    expect(
      placeFromReport(
        report(99048, {
          position: { map: 1411, x: 0.45, y: 0.61, reports: 2, total: 4 },
        }),
        options,
      ),
    ).toEqual({ id: 99048, giver: { type: "npc", id: 3142 }, reporters: 3 });
  });

  test("needs enough agreeing reports on a giver with an ID", () => {
    const cases: Partial<PlaceReport>[] = [
      { giver: null },
      { giver: { type: "npc", id: null, reports: 3, total: 3 } },
      { giver: { type: "unknown", id: 5, reports: 3, total: 3 } },
      { giver: { type: "npc", id: 5, reports: 1, total: 1 } },
      { giver: { type: "npc", id: 5, reports: 3, total: 5 } },
    ];
    for (const overrides of cases)
      expect(placeFromReport(report(99048, overrides), options)).toBeNull();
  });
});

describe("mergePlaces", () => {
  test("adds new quests and skips quests that are not new", () => {
    const result = mergePlaces(
      empty(),
      [report(99049), report(176), report(99048, { giver: null })],
      isNew,
      options,
    );
    expect(result.added.map((entry) => entry.id)).toEqual([99049]);
    expect(result.skipped).toEqual([176]);
    expect(result.undecided).toBe(1);
    expect(result.file.quests.map((entry) => entry.id)).toEqual([99049]);
  });

  test("replaces an entry when the consensus moves and keeps the rest", () => {
    const file: PlacesFile = {
      description: PLACES_DESCRIPTION,
      quests: [
        { id: 99048, giver: { type: "npc", id: 3142 }, reporters: 2 },
        { id: 99050, giver: { type: "object", id: 7 } },
        {
          id: 99051,
          giver: { type: "npc", id: 3142 },
          map: 1411,
          x: 0.45,
          y: 0.61,
          reporters: 2,
        },
      ],
    };
    const result = mergePlaces(
      file,
      [
        report(99048),
        report(99051, { reporters: 9 }),
        report(99050, { giver: null }),
      ],
      isNew,
      options,
    );
    expect(result.updated.map((entry) => entry.id)).toEqual([99048]);
    expect(result.added).toEqual([]);
    expect(result.file.quests).toEqual([
      {
        id: 99048,
        giver: { type: "npc", id: 3142 },
        map: 1411,
        x: 0.45,
        y: 0.61,
        reporters: 3,
      },
      { id: 99050, giver: { type: "object", id: 7 } },
      file.quests[2]!,
    ]);
  });

  test("leaves the file untouched when nothing changed", () => {
    const file = empty();
    expect(mergePlaces(file, [], isNew, options).file).toBe(file);
  });
});

describe("places file", () => {
  test("round-trips with a fixed key order", () => {
    const text = serializePlacesFile({
      description: "d",
      quests: [
        { id: 99049, giver: { type: "npc", id: 3142 } },
        {
          reporters: 2,
          y: 0.61,
          x: 0.45,
          map: 1411,
          giver: { id: 7, type: "object" },
          id: 99048,
        },
      ],
    });
    expect(text).toBe(`{
  "description": "d",
  "quests": [
    {
      "id": 99048,
      "giver": {
        "type": "object",
        "id": 7
      },
      "map": 1411,
      "x": 0.45,
      "y": 0.61,
      "reporters": 2
    },
    {
      "id": 99049,
      "giver": {
        "type": "npc",
        "id": 3142
      }
    }
  ]
}
`);
    expect(serializePlacesFile(parsePlacesFile(text, "places.json"))).toBe(
      text,
    );
  });

  test.each([
    ["no giver", `{"description":"","quests":[{"id":1}]}`],
    [
      "a giver type players cannot meet",
      `{"description":"","quests":[{"id":1,"giver":{"type":"unknown","id":2}}]}`,
    ],
    [
      "a map without coordinates",
      `{"description":"","quests":[{"id":1,"giver":{"type":"npc","id":2},"map":3}]}`,
    ],
    [
      "a coordinate off the map",
      `{"description":"","quests":[{"id":1,"giver":{"type":"npc","id":2},"map":3,"x":2,"y":0}]}`,
    ],
    [
      "a repeated ID",
      `{"description":"","quests":[{"id":1,"giver":{"type":"npc","id":2}},{"id":1,"giver":{"type":"npc","id":2}}]}`,
    ],
  ])("rejects %s", (_label, text) => {
    expect(() => parsePlacesFile(text, "places.json")).toThrow("places.json");
  });
});
