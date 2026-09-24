import { describe, expect, test } from "bun:test";
import { diffObservations, planIngest, type IngestInput } from "../src/ingest";
import type { ObservationRow, QuestRow, SubmissionMeta } from "../src/model";
import type { Vote } from "../src/summary";
import { validateExport, type QuestRecord } from "../src/validate";
import {
  CANDIDATE_ID,
  clientId,
  exportDocument,
  NOW,
  questRecord,
  testClassifier,
  type Json,
} from "./fixtures";

function records(...quests: Json[]): QuestRecord[] {
  const result = validateExport(exportDocument(quests), NOW);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.document.quests;
}

function meta(overrides: Partial<SubmissionMeta> = {}): SubmissionMeta {
  return {
    id: "submission-1",
    receivedAt: NOW,
    clientId: clientId(1),
    ipHash: "net-a",
    formatVersion: 1,
    addonVersion: "0.1.0",
    build: "1.60.1.69977",
    interface: 16001,
    locale: "enUS",
    exportedAt: NOW - 30,
    bodyBytes: 1000,
    questCount: 1,
    ...overrides,
  };
}

function plan(
  quests: QuestRecord[],
  options: {
    meta?: SubmissionMeta;
    previous?: Map<number, ObservationRow>;
    stored?: Map<number, QuestRow>;
    votes?: Map<number, Vote[]>;
    networkReporters?: Map<number, number>;
  } = {},
) {
  const submission = options.meta ?? meta();
  const previous = options.previous ?? new Map();
  const input: IngestInput = {
    meta: submission,
    questIds: quests.map((quest) => quest.id),
    changes: diffObservations(quests, previous, submission),
    previous,
    quests: options.stored ?? new Map(),
    votes: options.votes ?? new Map(),
    networkReporters: options.networkReporters ?? new Map(),
    classifier: testClassifier,
    config: { minClients: 3, minNetworks: 2 },
  };
  return planIngest(input);
}

describe("diffObservations", () => {
  test("separates new, changed and unchanged observations", () => {
    const first = plan(
      records(questRecord(CANDIDATE_ID), questRecord(CANDIDATE_ID + 1)),
    );
    const previous = new Map(
      first.observations.map((row) => [row.questId, row]),
    );
    const later = meta({ id: "submission-2", receivedAt: NOW + 100 });
    const changes = diffObservations(
      records(
        questRecord(CANDIDATE_ID),
        questRecord(CANDIDATE_ID + 1, { seenCount: 3 }),
        questRecord(CANDIDATE_ID + 2),
      ),
      previous,
      later,
    );
    expect([...changes.inserted]).toEqual([CANDIDATE_ID + 2]);
    expect([...changes.updated]).toEqual([CANDIDATE_ID + 1]);
    expect(changes.unchanged).toBe(1);
    const updated = changes.rows.find(
      (row) => row.questId === CANDIDATE_ID + 1,
    )!;
    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe(NOW + 100);
    expect(updated.submissionId).toBe("submission-2");
  });

  test("treats a reordered context list as unchanged", () => {
    const first = plan(
      records(questRecord(CANDIDATE_ID, { contexts: ["log", "detail"] })),
    );
    const previous = new Map(
      first.observations.map((row) => [row.questId, row]),
    );
    const changes = diffObservations(
      records(questRecord(CANDIDATE_ID, { contexts: ["detail", "log"] })),
      previous,
      meta(),
    );
    expect(changes.unchanged).toBe(1);
  });

  test("keeps the network of the first report when the installation moves", () => {
    const first = plan(records(questRecord(CANDIDATE_ID)));
    const previous = new Map(
      first.observations.map((row) => [row.questId, row]),
    );
    const changes = diffObservations(
      records(questRecord(CANDIDATE_ID, { seenCount: 9 })),
      previous,
      meta({ ipHash: "net-b" }),
    );
    expect(changes.rows[0]!.ipHash).toBe("net-a");
  });
});

describe("planIngest", () => {
  test("records a first report of a candidate as pending", () => {
    const result = plan(
      records(questRecord(CANDIDATE_ID, { title: "Into the Ruins" })),
    );
    expect(result.quests).toHaveLength(1);
    const quest = result.quests[0]!;
    expect(quest).toMatchObject({
      questId: CANDIDATE_ID,
      category: "candidate",
      status: "pending",
      statusSource: "auto",
      reporters: 1,
      networks: 1,
      firstReported: NOW,
      lastReported: NOW,
    });
    expect(quest.summary.locales["enUS"]!.title).toBe("Into the Ruins");
    expect(result.audit).toEqual([
      {
        at: NOW,
        questId: CANDIDATE_ID,
        actor: "auto",
        fromStatus: null,
        toStatus: "pending",
        reason: "first report",
        submissionId: "submission-1",
      },
    ]);
    expect(result.networkDeltas).toEqual([
      { questId: CANDIDATE_ID, ipHash: "net-a", delta: 1 },
    ]);
    expect(
      result.voteDeltas.map((delta) => [delta.dimension, delta.count]),
    ).toEqual([
      ["title", 1],
      ["level", 1],
      ["giver", 1],
      ["map", 1],
    ]);
  });

  test("moves votes instead of adding them when an installation corrects a title", () => {
    const first = plan(
      records(questRecord(CANDIDATE_ID, { title: "Into the Ruin" })),
    );
    const previous = new Map(
      first.observations.map((row) => [row.questId, row]),
    );
    const stored = new Map(first.quests.map((quest) => [quest.questId, quest]));
    const votes = new Map([
      [CANDIDATE_ID, first.voteDeltas.map(({ questId: _, ...vote }) => vote)],
    ]);
    const second = plan(
      records(questRecord(CANDIDATE_ID, { title: "Into the Ruins" })),
      {
        meta: meta({ id: "submission-2", receivedAt: NOW + 60 }),
        previous,
        stored,
        votes,
        networkReporters: new Map([[CANDIDATE_ID, 1]]),
      },
    );
    expect(second.voteDeltas).toEqual([
      {
        questId: CANDIDATE_ID,
        dimension: "title",
        locale: "enUS",
        value: "Into the Ruin",
        count: -1,
      },
      {
        questId: CANDIDATE_ID,
        dimension: "title",
        locale: "enUS",
        value: "Into the Ruins",
        count: 1,
      },
    ]);
    expect(second.networkDeltas).toEqual([]);
    expect(second.quests[0]).toMatchObject({
      reporters: 1,
      networks: 1,
      firstReported: NOW,
      lastReported: NOW + 60,
    });
    expect(second.quests[0]!.summary.locales["enUS"]).toMatchObject({
      title: "Into the Ruins",
      reports: 1,
    });
    expect(second.audit).toEqual([]);
    expect(second.result).toMatchObject({
      inserted: 0,
      updated: 1,
      unchanged: 0,
    });
  });

  test("writes nothing but the submission for an identical resubmission", () => {
    const quests = records(questRecord(CANDIDATE_ID), questRecord(176));
    const first = plan(quests);
    const previous = new Map(
      first.observations.map((row) => [row.questId, row]),
    );
    const second = plan(quests, { previous });
    expect(second.observations).toEqual([]);
    expect(second.voteDeltas).toEqual([]);
    expect(second.quests).toEqual([]);
    expect(second.result).toMatchObject({
      received: 2,
      inserted: 0,
      updated: 0,
      unchanged: 2,
    });
  });

  test("keeps original Classic quests out of promotion, whatever the report claims", () => {
    const result = plan(
      records(
        questRecord(176, { title: "Totally New Quest", state: "confirmed" }),
        questRecord(92401),
      ),
    );
    const classic = result.quests.find((quest) => quest.questId === 176)!;
    expect(classic).toMatchObject({ category: "classic", status: null });
    expect(classic.summary.locales["enUS"]!.title).toBe("Totally New Quest");
    expect(
      result.quests.find((quest) => quest.questId === 92401),
    ).toMatchObject({ category: "known", status: null });
    expect(result.audit).toEqual([]);
    expect(result.result.categories).toEqual({
      candidate: 0,
      known: 1,
      classic: 1,
      sod: 0,
      era: 0,
    });
  });

  test("aggregates SoD and Era quests without making them candidates", () => {
    const result = plan(records(questRecord(79000), questRecord(9999)));
    expect(
      result.quests.map((quest) => [quest.category, quest.status]),
    ).toEqual([
      ["sod", null],
      ["era", null],
    ]);
  });

  test("clears the status of a candidate that the data now lists as known", () => {
    const first = plan(records(questRecord(CANDIDATE_ID)));
    const stored = new Map([[92402, { ...first.quests[0]!, questId: 92402 }]]);
    const result = plan(records(questRecord(92402)), { stored });
    expect(result.quests[0]).toMatchObject({
      category: "known",
      status: null,
      statusSource: null,
    });
    expect(result.audit[0]).toMatchObject({
      fromStatus: "pending",
      toStatus: null,
      reason: "reclassified as known",
    });
  });

  test("counts a network once per quest", () => {
    const result = plan(records(questRecord(CANDIDATE_ID)), {
      meta: meta({ clientId: clientId(2) }),
      stored: new Map([
        [
          CANDIDATE_ID,
          {
            questId: CANDIDATE_ID,
            category: "candidate",
            status: "pending",
            statusSource: "auto",
            statusReason: "first report",
            statusChangedAt: NOW - 100,
            reporters: 1,
            networks: 1,
            summary: { locales: {}, level: null, giver: null, map: null },
            firstReported: NOW - 100,
            lastReported: NOW - 100,
          },
        ],
      ]),
      networkReporters: new Map([[CANDIDATE_ID, 1]]),
    });
    expect(result.quests[0]).toMatchObject({ reporters: 2, networks: 1 });
    expect(result.networkDeltas).toEqual([
      { questId: CANDIDATE_ID, ipHash: "net-a", delta: 1 },
    ]);
  });
});
