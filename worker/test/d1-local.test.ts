/**
 * End-to-end check against Cloudflare's local D1 (workerd via wrangler's
 * getPlatformProxy), with the schema applied by `wrangler d1 migrations apply
 * --local`. Complements the bun:sqlite tests by exercising D1's own SQL
 * limits, error messages and batch semantics. Runs offline.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { createApp } from "../src/app";
import type { SqlDatabase } from "../src/db";
import type { Env } from "../src/env";
import { Repository, WriteConflictError } from "../src/repository";
import {
  CANDIDATE_ID,
  clientId,
  exportDocument,
  NOW,
  questRecord,
  testClassifier,
  type Json,
} from "./fixtures";

const WORKER_DIR = join(import.meta.dir, "..");
const ADMIN_TOKEN = "admin-token-for-tests-0123456789";

let persistDir = "";
let proxy:
  Awaited<ReturnType<typeof getPlatformProxy<{ DB: SqlDatabase }>>> | undefined;
let env: Env;

beforeAll(async () => {
  persistDir = mkdtempSync(join(tmpdir(), "fqm-d1-"));
  const migrate = Bun.spawnSync(
    [
      "bunx",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "forever-quest-marker",
      "--local",
      "--persist-to",
      persistDir,
    ],
    {
      cwd: WORKER_DIR,
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (migrate.exitCode !== 0) {
    throw new Error(
      `migration failed:\n${migrate.stdout.toString()}\n${migrate.stderr.toString()}`,
    );
  }
  proxy = await getPlatformProxy<{ DB: SqlDatabase }>({
    configPath: join(WORKER_DIR, "wrangler.toml"),
    persist: { path: join(persistDir, "v3") },
  });
  env = {
    DB: proxy.env.DB,
    ADMIN_TOKEN,
    IP_HASH_SALT: "salt-for-tests-0123456789",
  };
}, 120_000);

afterAll(async () => {
  await proxy?.dispose();
  if (persistDir) rmSync(persistDir, { recursive: true, force: true });
});

let clock = NOW;
const app = createApp({ classifier: testClassifier, now: () => (clock += 5) });

function submit(client: number, ip: string, quests: Json[], locale = "enUS") {
  return app.fetch(
    new Request("https://fqm.test/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(
        exportDocument(quests, { clientId: clientId(client), locale }),
      ),
    }),
    env,
  );
}

function get(path: string, admin = false) {
  return app.fetch(
    new Request(`https://fqm.test${path}`, {
      headers: admin ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {},
    }),
    env,
  );
}

async function rows<T>(sql: string): Promise<T[]> {
  return (await env.DB.prepare(sql).all<T>()).results;
}

describe("local D1", () => {
  test("promotes a candidate and publishes it", async () => {
    const quest = questRecord(CANDIDATE_ID, { title: "Into the Ruins" });
    expect(
      (
        await submit(1, "203.0.113.1", [
          quest,
          questRecord(176),
          questRecord(92401),
        ])
      ).status,
    ).toBe(200);
    expect((await submit(2, "203.0.113.2", [quest])).status).toBe(200);
    const third = (await (
      await submit(3, "203.0.113.2", [quest])
    ).json()) as Json;
    expect(third["confirmed"]).toEqual([CANDIDATE_ID]);

    const again = (await (
      await submit(3, "203.0.113.9", [quest])
    ).json()) as Json;
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });

    const confirmed = (await (await get("/api/confirmed")).json()) as {
      confirmed: Json[];
      known: Json[];
    };
    expect(confirmed.confirmed.map((entry) => entry["id"])).toEqual([
      CANDIDATE_ID,
    ]);
    expect(confirmed.known.map((entry) => entry["id"])).toEqual([92401]);

    const audit = (await (
      await get(`/api/admin/audit?quest=${CANDIDATE_ID}`, true)
    ).json()) as { entries: Json[] };
    expect(audit.entries.map((entry) => entry["toStatus"])).toEqual([
      "confirmed",
      "pending",
    ]);
  });

  test("keeps classic quests out of promotion and exposes them for change detection", async () => {
    for (const client of [11, 12, 13]) {
      await submit(client, `198.51.100.${client}`, [
        questRecord(176, { title: "Totally New", state: "confirmed" }),
      ]);
    }
    const classic = (await (
      await get("/api/admin/classic-observations", true)
    ).json()) as { quests: Json[] };
    expect(classic.quests).toHaveLength(1);
    expect(classic.quests[0]).toMatchObject({ id: 176, reporters: 4 });
    expect(
      await rows("SELECT status FROM quests WHERE quest_id = 176"),
    ).toEqual([{ status: null }]);
  });

  test("ingests the largest allowed export within D1's limits", async () => {
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
    const response = await submit(21, "192.0.2.21", quests, "ruRU");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      received: 5000,
      inserted: 5000,
    });
    expect(
      await rows(
        "SELECT COUNT(*) AS n FROM observations WHERE client_id = '0000000000000015'",
      ),
    ).toEqual([{ n: 5000 }]);
  }, 60_000);

  test("keeps vote counters equal to a rebuild from observations", async () => {
    await submit(31, "192.0.2.31", [
      questRecord(CANDIDATE_ID + 5, { title: "First" }),
    ]);
    await submit(31, "192.0.2.31", [
      questRecord(CANDIDATE_ID + 5, { title: "Second", level: 30 }),
    ]);
    await submit(32, "192.0.2.32", [
      questRecord(CANDIDATE_ID + 5, { title: "Second", map: null }),
    ]);
    const stored = await rows(
      `SELECT locale, value, count FROM quest_votes
       WHERE quest_id = ${CANDIDATE_ID + 5} AND dimension = 'title' ORDER BY value`,
    );
    const rebuilt = await rows(
      `SELECT locale, title AS value, COUNT(*) AS count FROM observations
       WHERE quest_id = ${CANDIDATE_ID + 5} GROUP BY locale, title ORDER BY title`,
    );
    expect(stored).toEqual(rebuilt);
    expect(stored).toEqual([{ locale: "enUS", value: "Second", count: 2 }]);
  });

  test("maps D1's UNIQUE conflict to WriteConflictError", async () => {
    const repo = new Repository(env.DB);
    const { seq, quest } = await repo.readQuest(CANDIDATE_ID);
    await repo.commitReview(seq, quest!, []);
    await expect(repo.commitReview(seq, quest!, [])).rejects.toBeInstanceOf(
      WriteConflictError,
    );
  });

  test("rate-limits a network", async () => {
    const statuses: number[] = [];
    for (let client = 41; client <= 62; client++) {
      statuses.push(
        (await submit(client, "192.0.2.200", [questRecord(CANDIDATE_ID + 9)]))
          .status,
      );
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
});
