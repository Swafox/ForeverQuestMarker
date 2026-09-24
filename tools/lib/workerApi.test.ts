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
    });
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
        { id: 2, reporters: 1, level: null, locales: {} },
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
    });
    expect(quests[1]!.level).toBeNull();
  });

  test("rejects malformed entries", () => {
    expect(() =>
      parseClassicObservations({
        quests: [{ id: 176, reporters: -1, level: null, locales: {} }],
      }),
    ).toThrow("quests[0].reporters");
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
