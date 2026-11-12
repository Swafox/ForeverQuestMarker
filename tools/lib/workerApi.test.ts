import { describe, expect, test } from "bun:test";
import {
  parseClassicObservations,
  parseConfirmedResponse,
  pickTitle,
  workerBaseUrl,
} from "./workerApi";

const confirmedBody = {
  generatedAt: "2026-09-23T12:00:00.000Z",
  meta: {
    questieDB: "Questie/QuestieDB@3a1dc8886f85",
    foreverBuild: "1.60.1.69977",
    eraBuild: "1.15.9.69722",
  },
  thresholds: { minClients: 3, minIps: 2 },
  confirmed: [
    {
      id: 120001,
      titles: {
        deDE: { title: "In die Ruinen", reports: 4 },
        enUS: { title: "Into the Ruins", reports: 1 },
      },
      reporters: 5,
      firstReported: "2026-09-20T10:00:00.000Z",
      lastReported: "2026-09-22T10:00:00.000Z",
      level: 17,
      giver: null,
      map: 1436,
      confirmedBy: "auto",
    },
  ],
  known: [],
};

describe("pickTitle", () => {
  test("prefers enUS, then the locale with the most reports", () => {
    expect(
      pickTitle({
        deDE: { title: "A", reports: 9 },
        enUS: { title: "B", reports: 1 },
      }),
    ).toBe("B");
    expect(
      pickTitle({
        frFR: { title: "F", reports: 2 },
        deDE: { title: "D", reports: 3 },
      }),
    ).toBe("D");
    expect(
      pickTitle({
        frFR: { title: "F", reports: 3 },
        deDE: { title: "D", reports: 3 },
      }),
    ).toBe("D");
    expect(pickTitle({})).toBeNull();
  });
});

describe("parseConfirmedResponse", () => {
  test("reads confirmed quests", () => {
    expect(parseConfirmedResponse(confirmedBody)).toEqual({
      generatedAt: "2026-09-23T12:00:00.000Z",
      foreverBuild: "1.60.1.69977",
      confirmed: [
        {
          id: 120001,
          title: "Into the Ruins",
          reporters: 5,
          firstReported: "2026-09-20T10:00:00.000Z",
          confirmedBy: "auto",
        },
      ],
      places: [{ id: 120001, reporters: 5, giver: null, position: null }],
    });
  });

  test("reads giver and position agreement of confirmed and known quests", () => {
    const parsed = parseConfirmedResponse({
      ...confirmedBody,
      known: [
        {
          id: 99048,
          titles: { enUS: { title: "A Missing Hand", reports: 3 } },
          reporters: 3,
          firstReported: "2026-09-26T17:29:04.000Z",
          lastReported: "2026-09-26T17:29:04.000Z",
          level: 11,
          giver: {
            type: "npc",
            id: 3142,
            name: "Orgnil Soulscar",
            reports: 3,
            total: 3,
          },
          map: 1411,
          position: { map: 1411, x: 0.45, y: 0.61, reports: 2, total: 3 },
          source: "datamined",
        },
        {
          // A Worker deployed before agreement counts: no total, no position.
          id: 99049,
          titles: { enUS: { title: "B", reports: 1 } },
          reporters: 1,
          firstReported: "2026-09-26T17:29:04.000Z",
          lastReported: "2026-09-26T17:29:04.000Z",
          level: null,
          giver: { type: "npc", id: 3142, name: "Orgnil Soulscar" },
          map: 1411,
          source: "datamined",
        },
      ],
    });
    expect(parsed.places).toEqual([
      { id: 120001, reporters: 5, giver: null, position: null },
      {
        id: 99048,
        reporters: 3,
        giver: { type: "npc", id: 3142, reports: 3, total: 3 },
        position: { map: 1411, x: 0.45, y: 0.61, reports: 2, total: 3 },
      },
      { id: 99049, reporters: 1, giver: null, position: null },
    ]);
  });

  test.each([
    ["a non-object body", []],
    ["a missing list", { generatedAt: "x" }],
    [
      "an invalid ID",
      {
        ...confirmedBody,
        confirmed: [{ ...confirmedBody.confirmed[0], id: 0 }],
      },
    ],
    [
      "a title with an escape sequence",
      {
        ...confirmedBody,
        confirmed: [
          {
            ...confirmedBody.confirmed[0],
            titles: { enUS: { title: "|cffff0000X|r", reports: 3 } },
          },
        ],
      },
    ],
    [
      "a title with a newline",
      {
        ...confirmedBody,
        confirmed: [
          {
            ...confirmedBody.confirmed[0],
            titles: { enUS: { title: "A\nB", reports: 3 } },
          },
        ],
      },
    ],
    [
      "a position off the map",
      {
        ...confirmedBody,
        known: [
          {
            ...confirmedBody.confirmed[0],
            position: { map: 1411, x: 1.5, y: 0.5, reports: 1, total: 1 },
          },
        ],
      },
    ],
    [
      "an unknown giver type",
      {
        ...confirmedBody,
        confirmed: [
          {
            ...confirmedBody.confirmed[0],
            giver: { type: "player", id: 1, reports: 1, total: 1 },
          },
        ],
      },
    ],
    [
      "an invalid locale",
      {
        ...confirmedBody,
        confirmed: [
          {
            ...confirmedBody.confirmed[0],
            titles: { "../x": { title: "A", reports: 3 } },
          },
        ],
      },
    ],
  ])("rejects %s", (_label, body) => {
    expect(() => parseConfirmedResponse(body)).toThrow(
      "Unexpected Worker response",
    );
  });
});

describe("parseClassicObservations", () => {
  test("reads per-locale observations", () => {
    const quests = parseClassicObservations({
      generatedAt: "2026-09-23T12:00:00.000Z",
      quests: [
        {
          id: 176,
          reporters: 3,
          level: { value: 12, reports: 3, total: 3 },
          locales: {
            enUS: {
              reports: 3,
              title: "Wanted: Hogger",
              titleReports: 3,
              titleVariants: 1,
              agreed: true,
              level: 12,
              levelReports: 3,
            },
          },
        },
        {
          id: 2,
          reporters: 1,
          level: null,
          locales: {},
          giver: { type: "item", id: 16305, name: null, reports: 2, total: 2 },
          finisher: {
            type: "npc",
            id: 12696,
            name: "Senani",
            reports: 2,
            total: 3,
          },
          objectives: { enUS: { value: "42300a10", reports: 2, total: 2 } },
          items: { value: "16305,16306", reports: 2, total: 2 },
        },
      ],
    });
    expect(quests[0]).toEqual({
      id: 176,
      reporters: 3,
      level: { value: 12, reports: 3, total: 3 },
      locales: {
        enUS: {
          title: "Wanted: Hogger",
          titleReports: 3,
          reports: 3,
          agreed: true,
          level: 12,
          levelReports: 3,
        },
      },
      giver: null,
      finisher: null,
      objectives: {},
      items: null,
    });
    expect(quests[1]).toMatchObject({
      level: null,
      giver: { type: "item", id: 16305, reports: 2, total: 2 },
      finisher: { type: "npc", id: 12696, reports: 2, total: 3 },
      objectives: { enUS: { value: "42300a10", reports: 2, total: 2 } },
      items: { value: "16305,16306", reports: 2, total: 2 },
    });
  });

  test("rejects malformed entries", () => {
    expect(() =>
      parseClassicObservations({
        quests: [{ id: 176, reporters: -1, level: null, locales: {} }],
      }),
    ).toThrow("quests[0].reporters");
    expect(() =>
      parseClassicObservations({
        quests: [
          {
            id: 176,
            reporters: 1,
            level: null,
            locales: {},
            objectives: { enUS: { value: "<b>", reports: 1, total: 1 } },
          },
        ],
      }),
    ).toThrow("quests[0].objectives.enUS.value");
    expect(() =>
      parseClassicObservations({
        quests: [
          {
            id: 176,
            reporters: 1,
            level: null,
            locales: {},
            items: { value: "1,,2", reports: 1, total: 1 },
          },
        ],
      }),
    ).toThrow("quests[0].items.value");
  });
});

describe("workerBaseUrl", () => {
  test("requires https except for local development", () => {
    expect(workerBaseUrl("https://fqm.example.workers.dev/")).toBe(
      "https://fqm.example.workers.dev",
    );
    expect(workerBaseUrl("https://example.com/fqm//")).toBe(
      "https://example.com/fqm",
    );
    expect(workerBaseUrl("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
    expect(() => workerBaseUrl("http://example.com")).toThrow("https");
    expect(() => workerBaseUrl("not a url")).toThrow("Invalid");
  });
});
