import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { observationVotes } from "../src/ingest";
import type { ObservationRow } from "../src/model";
import { Repository } from "../src/repository";
import {
  emptySummary,
  positionVoteValue,
  summarize,
  type Vote,
} from "../src/summary";
import { validateExport, type ValidationError } from "../src/validate";
import { exportDocument, NOW, questRecord, type Json } from "./fixtures";
import { MIGRATIONS_DIR, SqliteD1 } from "./sqlite";

const DETAILS = {
  finisher: { type: "npc" as const, id: 240, name: "Marshal Dughan" },
  objectivesHash: "0badf00d",
  items: [1931, 2589],
};

function accepted(quest: Json, version = 2) {
  const result = validateExport(exportDocument([quest], { version }), NOW);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.document.quests[0]!;
}

function errorPaths(quest: Json): string[] {
  const result = validateExport(exportDocument([quest]), NOW);
  if (result.ok) throw new Error("expected the document to be rejected");
  return result.errors.map((error: ValidationError) => error.path);
}

describe("export version 2", () => {
  test("accepts finisher, objectives hash and hand-in items", () => {
    const quest = accepted(questRecord(176, DETAILS));
    expect(quest.finisher).toEqual(DETAILS.finisher);
    expect(quest.objectivesHash).toBe("0badf00d");
    expect(quest.items).toEqual([1931, 2589]);
  });

  test("treats the new fields as absent when not given", () => {
    const quest = accepted(questRecord(176));
    expect(quest.finisher).toBeNull();
    expect(quest.objectivesHash).toBeNull();
    expect(quest.items).toBeNull();
  });

  test("ignores the new fields in version 1 documents", () => {
    const quest = accepted(
      questRecord(176, { ...DETAILS, objectivesHash: "not a hash" }),
      1,
    );
    expect(quest.finisher).toBeNull();
    expect(quest.objectivesHash).toBeNull();
    expect(quest.items).toBeNull();
  });

  test("validates the new fields", () => {
    expect(
      errorPaths(questRecord(176, { finisher: { type: "player", id: 1 } })),
    ).toEqual(["quests[0].finisher.type"]);
    expect(
      errorPaths(questRecord(176, { objectivesHash: "0BADF00D" })),
    ).toEqual(["quests[0].objectivesHash"]);
    expect(errorPaths(questRecord(176, { objectivesHash: "abc" }))).toEqual([
      "quests[0].objectivesHash",
    ]);
    expect(errorPaths(questRecord(176, { items: [] }))).toEqual([
      "quests[0].items",
    ]);
    expect(errorPaths(questRecord(176, { items: [5, 5] }))).toEqual([
      "quests[0].items[1]",
    ]);
    expect(errorPaths(questRecord(176, { items: [9, 3] }))).toEqual([
      "quests[0].items[1]",
    ]);
    expect(errorPaths(questRecord(176, { items: [0, 1.5] }))).toEqual([
      "quests[0].items[0]",
      "quests[0].items[1]",
    ]);
    expect(errorPaths(questRecord(176, { items: [10_000_001] }))).toEqual([
      "quests[0].items[0]",
    ]);
    expect(
      errorPaths(
        questRecord(176, {
          items: Array.from({ length: 21 }, (_, index) => index + 1),
        }),
      ),
    ).toEqual(["quests[0].items"]);
  });
});

describe("position votes", () => {
  test("count positions in cells of 0.02", () => {
    expect(positionVoteValue(1436, 0.452, 0.612)).toBe("1436:22:30");
    expect(positionVoteValue(1436, 0, 0)).toBe("1436:0:0");
    // The far edge belongs to the last cell.
    expect(positionVoteValue(1436, 1, 0.999)).toBe("1436:49:49");
    expect(positionVoteValue(null, 0.5, 0.5)).toBeNull();
    expect(positionVoteValue(1436, null, null)).toBeNull();
  });

  test("summarize to the center of the leading cell", () => {
    const votes: Vote[] = [
      { dimension: "position", locale: "", value: "1436:22:30", count: 3 },
      { dimension: "position", locale: "", value: "1436:40:2", count: 1 },
    ];
    expect(summarize(votes).position).toEqual({
      map: 1436,
      x: 0.45,
      y: 0.61,
      reports: 3,
      total: 4,
    });
  });
});

describe("detail summaries", () => {
  test("keep objective hashes per locale and the leading item set", () => {
    const votes: Vote[] = [
      { dimension: "objectives", locale: "enUS", value: "0000abcd", count: 2 },
      { dimension: "objectives", locale: "enUS", value: "1234beef", count: 1 },
      { dimension: "objectives", locale: "deDE", value: "99990000", count: 1 },
      { dimension: "items", locale: "", value: "1931,2589", count: 2 },
      { dimension: "items", locale: "", value: "1931", count: 1 },
    ];
    const summary = summarize(votes);
    expect(summary.objectives).toEqual({
      deDE: { value: "99990000", reports: 1, total: 1 },
      enUS: { value: "0000abcd", reports: 2, total: 3 },
    });
    expect(summary.items).toEqual({ value: "1931,2589", reports: 2, total: 3 });
  });

  test("an observation votes for each detail it carries", () => {
    const row = {
      locale: "enUS",
      title: "Wanted: Hogger",
      level: null,
      giverType: null,
      giverId: null,
      giverName: null,
      finisherType: "npc",
      finisherId: 240,
      finisherName: "Marshal Dughan",
      objectivesHash: "0badf00d",
      items: "1931",
      map: 1429,
      x: 0.5,
      y: 0.5,
    } as ObservationRow;
    expect(
      observationVotes(row).map((vote) => [
        vote.dimension,
        vote.locale,
        vote.value,
      ]),
    ).toEqual([
      ["title", "enUS", "Wanted: Hogger"],
      ["finisher", "enUS", '["npc",240,"Marshal Dughan"]'],
      ["objectives", "enUS", "0badf00d"],
      ["items", "", "1931"],
      ["map", "", "1429"],
      ["position", "", "1429:25:25"],
    ]);
  });
});

describe("migration 0002", () => {
  const migration = (file: string) =>
    readFileSync(join(MIGRATIONS_DIR, file), "utf8");

  test("counts position votes for existing observations", () => {
    const db = new Database(":memory:");
    db.exec(migration("0001_init.sql"));
    const insert = db.query(
      `INSERT INTO observations (client_id, quest_id, ip_hash, submission_id, locale, title, state,
         map, x, y, contexts, first_seen, last_seen, seen_count, created_at, updated_at)
       VALUES (?1, ?2, 'net', 's', 'enUS', 'T', 'confirmed', ?3, ?4, ?5, 'detail', 1, 1, 1, 1, 1)`,
    );
    insert.run("a", 92401, 1436, 0.452, 0.612);
    insert.run("b", 92401, 1436, 0.459, 0.619);
    insert.run("c", 92401, 1436, 1, 0.5);
    insert.run("d", 92401, null, null, null);
    insert.run("e", 92402, 1429, null, null);
    db.exec(migration("0002_quest_details.sql"));
    expect(
      db
        .query(
          "SELECT quest_id, dimension, locale, value, count FROM quest_votes ORDER BY value",
        )
        .all(),
    ).toEqual([
      {
        quest_id: 92401,
        dimension: "position",
        locale: "",
        value: "1436:22:30",
        count: 2,
      },
      {
        quest_id: 92401,
        dimension: "position",
        locale: "",
        value: "1436:49:25",
        count: 1,
      },
    ]);
    // The SQL cell computation matches the one used for new observations.
    expect(positionVoteValue(1436, 0.459, 0.619)).toBe("1436:22:30");
    expect(positionVoteValue(1436, 1, 0.5)).toBe("1436:49:25");
  });

  test("summaries stored before the migration read with the new fields empty", async () => {
    const db = new Database(":memory:");
    db.exec(migration("0001_init.sql"));
    db.exec(migration("0002_quest_details.sql"));
    db.query(
      `INSERT INTO quests (quest_id, category, reporters, networks, summary, first_reported, last_reported)
       VALUES (92401, 'known', 1, 1, ?1, 1, 1)`,
    ).run(
      JSON.stringify({
        locales: {},
        level: null,
        giver: { type: "npc", id: 3142, name: "Orgnil", reports: 1 },
        map: { id: 1411, reports: 1, total: 1 },
      }),
    );
    const [quest] = await new Repository(new SqliteD1(db)).questsByIds([92401]);
    expect(quest!.summary).toEqual({
      ...emptySummary(),
      giver: { type: "npc", id: 3142, name: "Orgnil", reports: 1 },
      map: { id: 1411, reports: 1, total: 1 },
    } as never);
  });
});
