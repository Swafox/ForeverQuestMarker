import { describe, expect, test } from "bun:test";
import { createClassifier, type Classifier } from "../src/classify";
import { MAX_BODY_BYTES, readConfig } from "../src/env";
import { diffObservations, observationVotes, planIngest } from "../src/ingest";
import type { ObservationRow, QuestRow } from "../src/model";
import {
  jsonChunks,
  Repository,
  utf8Length,
  WriteConflictError,
} from "../src/repository";
import {
  BusyError,
  ingestSubmission,
  ReviewError,
  reviewQuest,
  type ServiceContext,
} from "../src/service";
import { validateExport, type ExportDocument } from "../src/validate";
import { classicObservationsPayload, confirmedPayload } from "../src/views";
import {
  CANDIDATE_ID,
  clientId,
  exportDocument,
  NOW,
  questRecord,
  TEST_SETS,
  testClassifier,
  type Json,
} from "./fixtures";
import { createTestDatabase, type SqliteD1 } from "./sqlite";

interface Harness {
  d1: SqliteD1;
  repo: Repository;
  context: ServiceContext;
  submit(
    client: number,
    network: string,
    quests: Json[],
    locale?: string,
  ): ReturnType<typeof ingestSubmission>;
  quest(id: number): Promise<QuestRow>;
  audit(id: number): Promise<string[]>;
}

function documentFor(
  client: number,
  quests: Json[],
  locale = "enUS",
): ExportDocument {
  const result = validateExport(
    exportDocument(quests, { clientId: clientId(client), locale }),
    NOW,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.document;
}

function harness(
  classifier: Classifier = testClassifier,
  d1: SqliteD1 = createTestDatabase(),
): Harness {
  const repo = new Repository(d1);
  let clock = NOW;
  let counter = 0;
  const context: ServiceContext = {
    repo,
    classifier,
    config: readConfig({ DB: d1 }),
    now: () => (clock += 10),
    newId: () => `submission-${++counter}-${crypto.randomUUID()}`,
  };
  return {
    d1,
    repo,
    context,
    submit: (client, network, quests, locale) =>
      ingestSubmission(
        context,
        documentFor(client, quests, locale),
        network,
        100,
      ),
    async quest(id) {
      const { quest } = await repo.readQuest(id);
      if (!quest) throw new Error(`quest ${id} not stored`);
      return quest;
    },
    async audit(id) {
      const entries = await repo.auditLog(id, 100);
      return entries
        .reverse()
        .map(
          (entry) => `${entry.actor} ${entry.fromStatus} -> ${entry.toStatus}`,
        );
    },
  };
}

const titled = (title: string, id = CANDIDATE_ID) => questRecord(id, { title });

describe("schema", () => {
  test("the migration creates every table", () => {
    const tables = createTestDatabase()
      .rows<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "audit_log",
        "observations",
        "quest_networks",
        "quest_votes",
        "quests",
        "rate_limits",
        "submissions",
        "write_sequence",
      ]),
    );
  });
});

describe("promotion through ingest", () => {
  test("confirms a candidate reported by 3 installations on 2 networks", async () => {
    const h = harness();
    expect(
      (await h.submit(1, "net-a", [titled("Into the Ruins")])).confirmed,
    ).toEqual([]);
    expect(
      (await h.submit(2, "net-a", [titled("Into the Ruins")])).confirmed,
    ).toEqual([]);
    expect(await h.quest(CANDIDATE_ID)).toMatchObject({
      status: "pending",
      reporters: 2,
      networks: 1,
    });
    const third = await h.submit(3, "net-b", [titled("into  the ruins")]);
    expect(third.confirmed).toEqual([CANDIDATE_ID]);
    const quest = await h.quest(CANDIDATE_ID);
    expect(quest).toMatchObject({
      status: "confirmed",
      statusSource: "auto",
      reporters: 3,
      networks: 2,
    });
    expect(quest.summary.locales["enUS"]).toMatchObject({
      title: "Into the Ruins",
      titleReports: 3,
      reports: 3,
    });
    expect(await h.audit(CANDIDATE_ID)).toEqual([
      "auto null -> pending",
      "auto pending -> confirmed",
    ]);
  });

  test("counts an installation once however often it resubmits", async () => {
    const h = harness();
    for (let i = 1; i <= 5; i++) {
      await h.submit(1, `net-${i}`, [
        questRecord(CANDIDATE_ID, { seenCount: i }),
      ]);
    }
    expect(await h.quest(CANDIDATE_ID)).toMatchObject({
      status: "pending",
      reporters: 1,
      networks: 1,
    });
    expect(h.d1.rows("SELECT seen_count FROM observations")).toEqual([
      { seen_count: 5 },
    ]);
    expect(h.d1.rows("SELECT COUNT(*) AS n FROM submissions")).toEqual([
      { n: 5 },
    ]);
  });

  test("keeps many installations on one network pending", async () => {
    const h = harness();
    for (let client = 1; client <= 6; client++)
      await h.submit(client, "net-a", [titled("Into the Ruins")]);
    expect(await h.quest(CANDIDATE_ID)).toMatchObject({
      status: "pending",
      reporters: 6,
      networks: 1,
    });
  });

  test("confirms with exactly two thirds agreement and flags anything less", async () => {
    const agreed = harness();
    await agreed.submit(1, "net-a", [titled("Into the Ruins")]);
    await agreed.submit(2, "net-b", [titled("Into the Ruins")]);
    await agreed.submit(3, "net-c", [titled("Out of the Ruins")]);
    expect((await agreed.quest(CANDIDATE_ID)).status).toBe("confirmed");

    const split = harness();
    await split.submit(1, "net-a", [titled("Into the Ruins")]);
    await split.submit(2, "net-b", [titled("Out of the Ruins")]);
    const third = await split.submit(3, "net-c", [titled("Beyond the Ruins")]);
    expect(third.flagged).toEqual([CANDIDATE_ID]);
    const quest = await split.quest(CANDIDATE_ID);
    expect(quest).toMatchObject({
      status: "flagged",
      statusReason: "conflicting titles in enUS",
    });
  });

  test("evaluates title agreement per locale", async () => {
    const h = harness();
    await h.submit(1, "net-a", [titled("Into the Ruins")], "enUS");
    await h.submit(2, "net-b", [titled("Into the Ruins")], "enUS");
    await h.submit(3, "net-c", [titled("In die Ruinen")], "deDE");
    const quest = await h.quest(CANDIDATE_ID);
    expect(quest.status).toBe("confirmed");
    expect(Object.keys(quest.summary.locales)).toEqual(["deDE", "enUS"]);
  });

  test("uses an installation's corrected title instead of counting both", async () => {
    const h = harness();
    await h.submit(1, "net-a", [titled("Into teh Ruins")]);
    await h.submit(1, "net-a", [titled("Into the Ruins")]);
    await h.submit(2, "net-b", [titled("Into the Ruins")]);
    await h.submit(3, "net-b", [titled("Into the Ruins")]);
    const quest = await h.quest(CANDIDATE_ID);
    expect(quest.status).toBe("confirmed");
    expect(quest.summary.locales["enUS"]).toMatchObject({
      reports: 3,
      titleVariants: 1,
    });
  });

  test.each([[5000], [250000]])(
    "flags candidate ID %p for manual review",
    async (id) => {
      const h = harness();
      await h.submit(1, "net-a", [titled("Old Quest", id)]);
      await h.submit(2, "net-b", [titled("Old Quest", id)]);
      await h.submit(3, "net-c", [titled("Old Quest", id)]);
      expect(await h.quest(id)).toMatchObject({ status: "flagged" });
    },
  );

  test("flags an automatically confirmed candidate when later reports disagree", async () => {
    const h = harness();
    for (const client of [1, 2, 3])
      await h.submit(client, `net-${client}`, [titled("Into the Ruins")]);
    for (const client of [4, 5])
      await h.submit(client, `net-${client}`, [titled("Poisoned Title")]);
    const quest = await h.quest(CANDIDATE_ID);
    expect(quest).toMatchObject({
      status: "flagged",
      statusReason: "title consensus lost: conflicting titles in enUS",
    });
  });
});

describe("classification", () => {
  test("never promotes an original Classic quest, however many reports claim it is new", async () => {
    const h = harness();
    for (let client = 1; client <= 6; client++) {
      await h.submit(client, `net-${client}`, [
        questRecord(176, { title: "Free Epic Mount", state: "confirmed" }),
      ]);
    }
    const quest = await h.quest(176);
    expect(quest).toMatchObject({
      category: "classic",
      status: null,
      reporters: 6,
      networks: 6,
    });
    expect(h.d1.rows("SELECT * FROM audit_log")).toEqual([]);

    const confirmed = confirmedPayload(
      await h.repo.questsByStatus("confirmed", 100),
      await h.repo.questsByIds(testClassifier.knownIds),
      testClassifier,
      h.context.config.promotion,
      NOW,
    );
    expect(confirmed.confirmed).toEqual([]);

    const classic = classicObservationsPayload(
      await h.repo.questsByIds(testClassifier.classicIds),
      testClassifier,
      NOW,
    );
    expect(classic.quests).toHaveLength(1);
    expect(classic.quests[0]).toMatchObject({
      id: 176,
      reporters: 6,
      level: { value: 20, reports: 6, total: 6 },
    });
    expect(classic.quests[0]!.locales["enUS"]).toMatchObject({
      title: "Free Epic Mount",
      titleReports: 6,
    });
  });

  test("aggregates known-new quests for the public list without a status", async () => {
    const h = harness();
    await h.submit(1, "net-a", [
      questRecord(92401, { title: "Into the Ruins" }),
    ]);
    await h.submit(2, "net-b", [
      questRecord(92401, {
        title: "Into the Ruins",
        giver: { type: "npc", id: 77 },
      }),
    ]);
    await h.submit(3, "net-c", [
      questRecord(92401, {
        title: "Into the Ruins",
        giver: { type: "npc", id: 77 },
      }),
    ]);
    const quest = await h.quest(92401);
    expect(quest).toMatchObject({
      category: "known",
      status: null,
      reporters: 3,
    });
    const known = await h.repo.questsByIds(testClassifier.knownIds);
    const payload = confirmedPayload(
      [],
      known,
      testClassifier,
      h.context.config.promotion,
      NOW,
    );
    expect(payload.known).toEqual([
      {
        id: 92401,
        titles: { enUS: { title: "Into the Ruins", reports: 3 } },
        reporters: 3,
        firstReported: expect.any(String),
        lastReported: expect.any(String),
        level: 20,
        giver: { type: "npc", id: 77, name: null },
        map: 1436,
        source: "datamined",
      },
    ]);
  });

  test("stores SoD and Era quests as not new", async () => {
    const h = harness();
    await h.submit(1, "net-a", [questRecord(79000), questRecord(9999)]);
    expect(await h.quest(79000)).toMatchObject({
      category: "sod",
      status: null,
    });
    expect(await h.quest(9999)).toMatchObject({
      category: "era",
      status: null,
    });
  });

  test("clears a candidate's status once the data lists it as known", async () => {
    const d1 = createTestDatabase();
    const before = harness(testClassifier, d1);
    await before.submit(1, "net-a", [titled("Into the Ruins")]);
    const after = harness(
      createClassifier({
        ...TEST_SETS,
        datamined: [...TEST_SETS.datamined, CANDIDATE_ID],
      }),
      d1,
    );
    await after.submit(2, "net-b", [titled("Into the Ruins")]);
    expect(await after.quest(CANDIDATE_ID)).toMatchObject({
      category: "known",
      status: null,
      reporters: 2,
    });
    expect(await after.audit(CANDIDATE_ID)).toEqual([
      "auto null -> pending",
      "auto pending -> null",
    ]);
  });
});

describe("incremental aggregates", () => {
  /** Deterministic pseudo-random numbers (mulberry32). */
  function random(seed: number): () => number {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test("match a rebuild from the stored observations", async () => {
    const h = harness();
    const next = random(42);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)]!;
    const questIds = [
      CANDIDATE_ID,
      CANDIDATE_ID + 1,
      CANDIDATE_ID + 2,
      176,
      92401,
      79000,
      5000,
    ];
    const locales = ["enUS", "enUS", "deDE"];

    for (let round = 0; round < 80; round++) {
      const client = 1 + Math.floor(next() * 12);
      const quests = questIds
        .filter(() => next() < 0.6)
        .map((id) =>
          questRecord(id, {
            title: pick([
              "Into the Ruins",
              "into the ruins",
              "Out of the Ruins",
            ]),
            level: pick([null, 17, 18]),
            giver: pick([
              null,
              { type: "npc", id: 4001, name: "Scout" },
              { type: "object", name: "Chest" },
            ]),
            map: pick([null, 1436, 1429]),
            x: null,
            y: null,
            seenCount: 1 + Math.floor(next() * 3),
          }),
        );
      if (quests.length === 0) continue;
      await h.submit(
        client,
        pick(["net-a", "net-b", "net-c", "net-d"]),
        quests,
        locales[client % locales.length],
      );
    }

    const observations = h.d1.rows<ObservationRow>(
      `SELECT client_id AS clientId, quest_id AS questId, ip_hash AS ipHash, locale, title, level,
         giver_type AS giverType, giver_id AS giverId, giver_name AS giverName, map FROM observations`,
    );
    const expectedVotes = new Map<string, number>();
    for (const row of observations) {
      for (const vote of observationVotes(row)) {
        const key = [row.questId, vote.dimension, vote.locale, vote.value].join(
          "|",
        );
        expectedVotes.set(key, (expectedVotes.get(key) ?? 0) + 1);
      }
    }
    const storedVotes = new Map(
      h.d1
        .rows<{
          quest_id: number;
          dimension: string;
          locale: string;
          value: string;
          count: number;
        }>("SELECT * FROM quest_votes")
        .map((row) => [
          [row.quest_id, row.dimension, row.locale, row.value].join("|"),
          row.count,
        ]),
    );
    expect(storedVotes).toEqual(expectedVotes);

    expect(
      h.d1.rows(
        "SELECT quest_id, ip_hash, reporters FROM quest_networks ORDER BY 1, 2",
      ),
    ).toEqual(
      h.d1.rows(
        "SELECT quest_id, ip_hash, COUNT(*) AS reporters FROM observations GROUP BY quest_id, ip_hash ORDER BY 1, 2",
      ),
    );
    expect(
      h.d1.rows(
        "SELECT quest_id, reporters, networks FROM quests ORDER BY quest_id",
      ),
    ).toEqual(
      h.d1.rows(
        `SELECT quest_id, COUNT(*) AS reporters, COUNT(DISTINCT ip_hash) AS networks
         FROM observations GROUP BY quest_id ORDER BY quest_id`,
      ),
    );
  });
});

describe("concurrency", () => {
  test("rejects a commit based on a stale read without writing anything", async () => {
    const h = harness();
    const document = documentFor(1, [titled("Into the Ruins")]);
    const meta = {
      id: "stale",
      receivedAt: NOW,
      clientId: document.clientId,
      ipHash: "net-a",
      formatVersion: 1,
      addonVersion: "0.1.0",
      build: document.build,
      interface: document.interface,
      locale: document.locale,
      exportedAt: document.exportedAt,
      bodyBytes: 10,
      questCount: 1,
    };
    const base = await h.repo.readIngestBase(meta.clientId, [CANDIDATE_ID]);
    const changes = diffObservations(document.quests, base.previous, meta);
    const state = await h.repo.readQuestState([CANDIDATE_ID], "net-a");
    const plan = planIngest({
      meta,
      questIds: [CANDIDATE_ID],
      changes,
      previous: base.previous,
      ...state,
      classifier: testClassifier,
      config: h.context.config.promotion,
    });

    await h.submit(2, "net-b", [titled("Into the Ruins")]);
    await expect(
      h.repo.commitIngest(base.seq, meta, plan),
    ).rejects.toBeInstanceOf(WriteConflictError);
    expect(h.d1.rows("SELECT id FROM submissions WHERE id = 'stale'")).toEqual(
      [],
    );
    expect(await h.quest(CANDIDATE_ID)).toMatchObject({ reporters: 1 });
  });

  test("retries after losing a race and keeps both submissions", async () => {
    const d1 = createTestDatabase();
    const h = harness(testClassifier, d1);
    class RacingRepository extends Repository {
      raced = false;
      override async commitIngest(
        ...args: Parameters<Repository["commitIngest"]>
      ): Promise<void> {
        if (!this.raced) {
          this.raced = true;
          await h.submit(2, "net-b", [titled("Into the Ruins")]);
        }
        return super.commitIngest(...args);
      }
    }
    const racing = new RacingRepository(d1);
    await ingestSubmission(
      { ...h.context, repo: racing },
      documentFor(1, [titled("Into the Ruins")]),
      "net-a",
      10,
    );
    expect(racing.raced).toBe(true);
    expect(await h.quest(CANDIDATE_ID)).toMatchObject({
      reporters: 2,
      networks: 2,
    });
    expect(h.d1.rows("SELECT COUNT(*) AS n FROM submissions")).toEqual([
      { n: 2 },
    ]);
  });

  test("gives up with BusyError when every attempt conflicts", async () => {
    const d1 = createTestDatabase();
    class AlwaysConflicting extends Repository {
      override async commitIngest(): Promise<void> {
        throw new WriteConflictError();
      }
    }
    const h = harness(testClassifier, d1);
    await expect(
      ingestSubmission(
        { ...h.context, repo: new AlwaysConflicting(d1) },
        documentFor(1, [titled("A")]),
        "net-a",
        10,
      ),
    ).rejects.toBeInstanceOf(BusyError);
  });
});

describe("manual review", () => {
  const request = (
    id: number,
    status: "confirmed" | "rejected" | "pending",
    note = "checked in game",
  ) => ({
    id,
    status,
    note,
    reviewer: "maintainer",
  });

  test("confirms and rejects candidates with an audit trail", async () => {
    const h = harness();
    await h.submit(1, "net-a", [titled("Into the Ruins")]);
    const confirmed = await reviewQuest(
      h.context,
      request(CANDIDATE_ID, "confirmed", "seen it myself"),
    );
    expect(confirmed.quest).toMatchObject({
      status: "confirmed",
      statusSource: "admin",
      statusReason: "seen it myself",
    });
    await reviewQuest(
      h.context,
      request(CANDIDATE_ID, "rejected", "was a test realm quest"),
    );
    for (const client of [2, 3, 4])
      await h.submit(client, `net-${client}`, [titled("Into the Ruins")]);
    expect(await h.quest(CANDIDATE_ID)).toMatchObject({
      status: "rejected",
      reporters: 4,
    });
    expect(await h.audit(CANDIDATE_ID)).toEqual([
      "auto null -> pending",
      "admin:maintainer pending -> confirmed",
      "admin:maintainer confirmed -> rejected",
    ]);
  });

  test("keeps a manual confirmation when later reports disagree", async () => {
    const h = harness();
    await h.submit(1, "net-a", [titled("Into the Ruins")]);
    await reviewQuest(h.context, request(CANDIDATE_ID, "confirmed"));
    for (const client of [2, 3])
      await h.submit(client, `net-${client}`, [titled("Something Else")]);
    expect(await h.quest(CANDIDATE_ID)).toMatchObject({
      status: "confirmed",
      statusSource: "admin",
    });
  });

  test("re-evaluates immediately when a candidate is set back to pending", async () => {
    const h = harness();
    await h.submit(1, "net-a", [titled("Into the Ruins")]);
    await h.submit(2, "net-b", [titled("Out of the Ruins")]);
    await h.submit(3, "net-c", [titled("Beyond the Ruins")]);
    expect((await h.quest(CANDIDATE_ID)).status).toBe("flagged");
    const result = await reviewQuest(
      h.context,
      request(CANDIDATE_ID, "pending", "look again"),
    );
    expect(result.quest.status).toBe("flagged");
    expect(
      result.audit.map(
        (entry) => `${entry.actor} ${entry.fromStatus} -> ${entry.toStatus}`,
      ),
    ).toEqual(["admin:maintainer flagged -> pending", "auto pending -> flagged"]);

    await h.submit(4, "net-a", [titled("A", CANDIDATE_ID + 1)]);
    await reviewQuest(h.context, request(CANDIDATE_ID + 1, "rejected"));
    expect(
      (await reviewQuest(h.context, request(CANDIDATE_ID + 1, "pending"))).quest
        .status,
    ).toBe("pending");
  });

  test("refuses quests that are not candidates or have no reports", async () => {
    const h = harness();
    await h.submit(1, "net-a", [questRecord(176)]);
    await expect(
      reviewQuest(h.context, request(176, "confirmed")),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      reviewQuest(h.context, request(CANDIDATE_ID, "confirmed")),
    ).rejects.toBeInstanceOf(ReviewError);
  });
});

describe("repository", () => {
  test("stays within the D1 per-request query budget for the largest submission", async () => {
    const h = harness();
    // As large as the body limit allows, with multi-byte text to stress the chunking.
    const quests = Array.from({ length: 5000 }, (_, i) =>
      questRecord(20001 + i, {
        title: `Руины забытого города ${i}`,
        giver: {
          type: "npc",
          id: 4001 + i,
          name: "Страж Ансельм Светлолесный",
        },
      }),
    );
    expect(
      utf8Length(JSON.stringify(exportDocument(quests))),
    ).toBeLessThanOrEqual(MAX_BODY_BYTES);
    const before = h.d1.statementCount;
    const result = await h.submit(1, "net-a", quests, "ruRU");
    const used = h.d1.statementCount - before;
    expect(result.inserted).toBe(5000);
    // Free Workers allow 50 D1 queries per request; the rate limit checks use 6 more.
    expect(used).toBeLessThan(35);
    expect(h.d1.rows("SELECT COUNT(*) AS n FROM observations")).toEqual([
      { n: 5000 },
    ]);
    expect(
      h.d1.rows("SELECT COUNT(*) AS n FROM quests WHERE status = 'pending'"),
    ).toEqual([{ n: 5000 }]);
    expect(h.d1.rows("SELECT COUNT(*) AS n FROM audit_log")).toEqual([
      { n: 5000 },
    ]);
  });

  test("counts rate limit attempts per window and forgets old windows", async () => {
    const h = harness();
    expect(await h.repo.countAttempt("ip:x", 7200, 3600)).toEqual({
      current: 1,
      previous: 0,
    });
    expect(await h.repo.countAttempt("ip:x", 7200, 3600)).toEqual({
      current: 2,
      previous: 0,
    });
    expect(await h.repo.countAttempt("ip:y", 7200, 3600)).toEqual({
      current: 1,
      previous: 0,
    });
    expect(await h.repo.countAttempt("ip:x", 10800, 3600)).toEqual({
      current: 1,
      previous: 2,
    });
    await h.repo.countAttempt("ip:z", 18000, 3600);
    expect(
      h.d1.rows("SELECT DISTINCT window_start FROM rate_limits ORDER BY 1"),
    ).toEqual([{ window_start: 18000 }]);
  });

  test("reports statistics", async () => {
    const h = harness();
    await h.submit(1, "net-a", [
      titled("A"),
      questRecord(176),
      questRecord(92401),
    ]);
    await h.submit(2, "net-b", [titled("A")]);
    expect(await h.repo.stats()).toEqual({
      statuses: { pending: 1 },
      categories: { candidate: 1, classic: 1, known: 1 },
      submissions: 2,
      reporters: 2,
      lastSubmissionAt: expect.any(Number),
    });
  });
});

describe("jsonChunks", () => {
  test("splits by UTF-8 size and keeps every row", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      i,
      text: "Ж".repeat(40),
    }));
    const chunks = jsonChunks(rows, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(utf8Length(chunk)).toBeLessThanOrEqual(1000);
    expect(chunks.flatMap((chunk) => JSON.parse(chunk) as unknown[])).toEqual(
      rows,
    );
  });

  test("counts multi-byte characters", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("Жé")).toBe(4);
    expect(utf8Length("任务")).toBe(6);
    expect(utf8Length("\u{1F5E1}")).toBe(4);
    expect(utf8Length("\u{1F5E1}")).toBe(
      new TextEncoder().encode("\u{1F5E1}").length,
    );
  });
});
