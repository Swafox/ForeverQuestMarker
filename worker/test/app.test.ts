import { describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import {
  CANDIDATE_ID,
  clientId,
  exportDocument,
  NOW,
  questRecord,
  testClassifier,
  type Json,
} from "./fixtures";
import { createTestDatabase, type SqliteD1 } from "./sqlite";

const ADMIN_TOKEN = "admin-token-for-tests-0123456789";
const BASE = "https://fqm.example.workers.dev";

function setup(vars: Partial<Env> = {}) {
  const d1 = createTestDatabase();
  let clock = NOW;
  const app = createApp({ classifier: testClassifier, now: () => clock });
  const env: Env = {
    DB: d1,
    ADMIN_TOKEN,
    IP_HASH_SALT: "salt-for-tests-0123456789",
    ...vars,
  };
  return {
    d1,
    env,
    advance(seconds: number) {
      clock += seconds;
    },
    request(path: string, init: RequestInit & { ip?: string } = {}) {
      const headers = new Headers(init.headers);
      headers.set("CF-Connecting-IP", init.ip ?? "203.0.113.7");
      return app.fetch(
        new Request(`${BASE}${path}`, { ...init, headers }),
        env,
      );
    },
    submit(body: unknown, options: { ip?: string; type?: string } = {}) {
      return this.request("/api/submit", {
        method: "POST",
        ip: options.ip,
        headers: { "Content-Type": options.type ?? "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    },
    admin(path: string, init: RequestInit = {}, token = ADMIN_TOKEN) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return this.request(path, { ...init, headers });
    },
  };
}

type App = ReturnType<typeof setup>;

const report = (
  client: number,
  quests: Json[] = [questRecord(CANDIDATE_ID, { title: "Into the Ruins" })],
) => exportDocument(quests, { clientId: clientId(client) });

async function confirmCandidate(app: App): Promise<void> {
  for (const [client, ip] of [
    [1, "203.0.113.1"],
    [2, "203.0.113.2"],
    [3, "203.0.113.2"],
  ] as const) {
    expect((await app.submit(report(client), { ip })).status).toBe(200);
  }
}

function allText(d1: SqliteD1): string {
  const tables = d1.rows<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  return tables
    .map(({ name }) => JSON.stringify(d1.rows(`SELECT * FROM "${name}"`)))
    .join("\n");
}

describe("paste page", () => {
  test("serves a self-contained page with a strict CSP", async () => {
    const app = setup();
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "script-src 'self'",
    );
    const html = await response.text();
    expect(html).toContain("/fqm export");
    expect(html).toContain("Ctrl</kbd>+<kbd>A");
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
    expect(html).toContain("prefers-color-scheme: dark");

    const script = await app.request("/app.js");
    expect(script.headers.get("Content-Type")).toContain("javascript");
    expect(await script.text()).toContain('fetch("/api/submit"');
  });

  test("answers HEAD without a body and rejects unknown routes and methods", async () => {
    const app = setup();
    const head = await app.request("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await app.request("/nope")).status).toBe(404);
    const wrong = await app.request("/api/submit");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toBe("POST");
  });
});

describe("POST /api/submit", () => {
  test("accepts a valid export and reports what it did", async () => {
    const app = setup();
    const response = await app.submit(
      report(1, [
        questRecord(CANDIDATE_ID),
        questRecord(176),
        questRecord(92401),
      ]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await response.json()) as Json;
    expect(body).toMatchObject({
      ok: true,
      received: 3,
      inserted: 3,
      updated: 0,
      unchanged: 0,
      categories: { candidate: 1, known: 1, classic: 1, sod: 0, era: 0 },
      confirmed: [],
    });
    expect(body["submissionId"]).toEqual(expect.any(String));
  });

  test("accepts text/plain, as sent by a simple cross-origin form post", async () => {
    const app = setup();
    expect(
      (await app.submit(report(1), { type: "text/plain;charset=UTF-8" }))
        .status,
    ).toBe(200);
  });

  test("rejects other content types", async () => {
    const app = setup();
    expect(
      (
        await app.submit(report(1), {
          type: "application/x-www-form-urlencoded",
        })
      ).status,
    ).toBe(415);
  });

  test("rejects an invalid export with the full error list and stores nothing", async () => {
    const app = setup();
    const response = await app.submit(
      report(1, [questRecord(CANDIDATE_ID, { title: "", level: 900 })]),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "invalid_submission",
      message: "The export is not valid; nothing was saved.",
      errors: [
        { path: "quests[0].title", message: "must not be empty" },
        {
          path: "quests[0].level",
          message: "must be between 1 and 100, got 900",
        },
      ],
      truncated: false,
    });
    expect(app.d1.rows("SELECT * FROM submissions")).toEqual([]);
  });

  test("rejects a truncated paste", async () => {
    const app = setup();
    const response = await app.submit(JSON.stringify(report(1)).slice(0, 200));
    expect(response.status).toBe(400);
  });

  test("rejects bodies over the size limit", async () => {
    const app = setup();
    const response = await app.submit(`"${"x".repeat(2 * 1024 * 1024)}"`);
    expect(response.status).toBe(413);
  });

  test("refuses submissions until IP_HASH_SALT is configured", async () => {
    const app = setup({ IP_HASH_SALT: undefined });
    expect((await app.submit(report(1))).status).toBe(503);
  });

  test("never stores the client IP address", async () => {
    const app = setup();
    await app.submit(report(1), { ip: "198.51.100.23" });
    expect(allText(app.d1)).not.toContain("198.51.100.23");
    expect(
      app.d1.rows<{ ip_hash: string }>("SELECT ip_hash FROM submissions")[0]!
        .ip_hash,
    ).toMatch(/^[0-9a-f]{32}$/);
  });

  test("rate-limits one installation", async () => {
    const app = setup({
      RATE_LIMIT_CLIENT_PER_HOUR: "3",
      RATE_LIMIT_IP_PER_HOUR: "100",
    });
    for (let i = 0; i < 3; i++)
      expect(
        (await app.submit(report(1), { ip: `203.0.113.${i}` })).status,
      ).toBe(200);
    const limited = await app.submit(report(1), { ip: "203.0.113.99" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await app.submit(report(2), { ip: "203.0.113.99" })).status).toBe(
      200,
    );
    app.advance(2 * 3600);
    expect((await app.submit(report(1))).status).toBe(200);
  });

  test("rate-limits one network, counting invalid attempts too", async () => {
    const app = setup({ RATE_LIMIT_IP_PER_HOUR: "3" });
    expect((await app.submit("{}")).status).toBe(400);
    expect((await app.submit(report(1))).status).toBe(200);
    expect((await app.submit(report(2))).status).toBe(200);
    expect((await app.submit(report(3))).status).toBe(429);
    expect((await app.submit(report(3), { ip: "198.51.100.1" })).status).toBe(
      200,
    );
  });

  test("answers CORS preflight for the public endpoints only", async () => {
    const app = setup();
    const preflight = await app.request("/api/submit", { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(
      preflight.headers.get("Access-Control-Allow-Credentials"),
    ).toBeNull();
    const adminPreflight = await app.request("/api/admin/review", {
      method: "OPTIONS",
    });
    expect(adminPreflight.status).toBe(405);
    expect(
      adminPreflight.headers.get("Access-Control-Allow-Origin"),
    ).toBeNull();
  });
});

describe("public data", () => {
  test("lists confirmed candidates and known quests", async () => {
    const app = setup();
    await confirmCandidate(app);
    await app.submit(
      report(4, [questRecord(92401, { title: "Known Quest" })]),
      { ip: "198.51.100.4" },
    );
    const response = await app.request("/api/confirmed");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await response.json()) as {
      confirmed: Json[];
      known: Json[];
      meta: Json;
      thresholds: Json;
      generatedAt: string;
    };
    expect(body.thresholds).toEqual({ minClients: 3, minIps: 2 });
    expect(body.meta).toHaveProperty("foreverBuild");
    expect(body.generatedAt).toBe(new Date(NOW * 1000).toISOString());
    expect(body.confirmed).toEqual([
      {
        id: CANDIDATE_ID,
        titles: { enUS: { title: "Into the Ruins", reports: 3 } },
        reporters: 3,
        firstReported: expect.any(String),
        lastReported: expect.any(String),
        level: 20,
        giver: { type: "npc", id: 4001, name: "Scout Aldren" },
        map: 1436,
        confirmedBy: "auto",
      },
    ]);
    expect(body.known.map((quest) => [quest["id"], quest["source"]])).toEqual([
      [92401, "datamined"],
    ]);
  });

  test("reports statistics", async () => {
    const app = setup();
    await confirmCandidate(app);
    await app.submit(report(4, [questRecord(CANDIDATE_ID + 1)]), {
      ip: "198.51.100.4",
    });
    const body = (await (await app.request("/api/stats")).json()) as Json;
    expect(body).toMatchObject({
      candidates: { pending: 1, confirmed: 1, flagged: 0, rejected: 0 },
      observedQuests: { candidate: 2, known: 0, classic: 0, sod: 0, era: 0 },
      submissions: 4,
      reporters: 4,
    });
  });
});

describe("admin endpoints", () => {
  test("require the configured bearer token", async () => {
    const app = setup();
    expect((await app.request("/api/admin/candidates")).status).toBe(401);
    expect(
      (
        await app.admin(
          "/api/admin/candidates",
          {},
          "wrong-token-wrong-token-wrong",
        )
      ).status,
    ).toBe(401);
    expect((await app.admin("/api/admin/candidates")).status).toBe(200);
    const disabled = setup({ ADMIN_TOKEN: undefined });
    expect((await disabled.admin("/api/admin/candidates")).status).toBe(503);
    const weak = setup({ ADMIN_TOKEN: "short" });
    expect(
      (await weak.admin("/api/admin/candidates", {}, "short")).status,
    ).toBe(503);
  });

  test("list candidates by status", async () => {
    const app = setup();
    await confirmCandidate(app);
    await app.submit(report(4, [questRecord(CANDIDATE_ID + 1)]), {
      ip: "198.51.100.4",
    });
    const pending = (await (
      await app.admin("/api/admin/candidates")
    ).json()) as { candidates: Json[] };
    expect(pending.candidates.map((quest) => quest["id"])).toEqual([
      CANDIDATE_ID + 1,
    ]);
    const confirmed = (await (
      await app.admin("/api/admin/candidates?status=confirmed")
    ).json()) as {
      candidates: Json[];
    };
    expect(confirmed.candidates[0]).toMatchObject({
      id: CANDIDATE_ID,
      status: "confirmed",
      reporters: 3,
      networks: 2,
    });
    expect(
      (await app.admin("/api/admin/candidates?status=everything")).status,
    ).toBe(400);
    expect((await app.admin("/api/admin/candidates?limit=0")).status).toBe(400);
  });

  test("review a candidate and read the audit log", async () => {
    const app = setup();
    await app.submit(report(1, [questRecord(CANDIDATE_ID + 1)]));
    const review = await app.admin("/api/admin/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: CANDIDATE_ID + 1,
        status: "rejected",
        note: "Placeholder quest",
        reviewer: "maintainer",
      }),
    });
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({
      ok: true,
      quest: { status: "rejected", statusSource: "admin" },
    });

    const audit = (await (
      await app.admin(`/api/admin/audit?quest=${CANDIDATE_ID + 1}`)
    ).json()) as {
      entries: Json[];
    };
    expect(
      audit.entries.map((entry) => [
        entry["actor"],
        entry["toStatus"],
        entry["reason"],
      ]),
    ).toEqual([
      ["admin:maintainer", "rejected", "Placeholder quest"],
      ["auto", "pending", "first report"],
    ]);
  });

  test("validate review requests", async () => {
    const app = setup();
    await app.submit(report(1, [questRecord(176)]));
    const post = (body: unknown) =>
      app.admin("/api/admin/review", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    const invalid = await post({ id: "x", status: "maybe", note: "" });
    expect(invalid.status).toBe(400);
    expect(
      ((await invalid.json()) as { errors: Json[] }).errors.map(
        (error) => error["path"],
      ),
    ).toEqual(["id", "status", "note"]);
    expect((await post("not json")).status).toBe(400);
    expect(
      (await post({ id: 176, status: "confirmed", note: "no" })).status,
    ).toBe(409);
    expect(
      (
        await post({
          id: CANDIDATE_ID,
          status: "confirmed",
          note: "no reports",
        })
      ).status,
    ).toBe(404);
  });

  test("expose classic observations for change detection", async () => {
    const app = setup();
    await app.submit(
      report(1, [questRecord(176, { title: "Wanted: Hogger", level: 12 })]),
      { ip: "198.51.100.1" },
    );
    await app.submit(
      report(2, [questRecord(176, { title: "Wanted: Hogger", level: 12 })]),
      { ip: "198.51.100.2" },
    );
    const body = (await (
      await app.admin("/api/admin/classic-observations")
    ).json()) as { quests: Json[] };
    expect(body.quests).toEqual([
      {
        id: 176,
        reporters: 2,
        level: { value: 12, reports: 2, total: 2 },
        locales: {
          enUS: {
            reports: 2,
            title: "Wanted: Hogger",
            titleReports: 2,
            titleVariants: 1,
            agreed: true,
            level: 12,
            levelReports: 2,
          },
        },
      },
    ]);
  });
});

describe("configuration", () => {
  test("rejects invalid thresholds instead of silently using defaults", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const app = setup({ PROMOTION_MIN_CLIENTS: "zero" });
    expect((await app.request("/api/stats")).status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  test("uses configured promotion thresholds", async () => {
    const app = setup({ PROMOTION_MIN_CLIENTS: "1", PROMOTION_MIN_IPS: 1 });
    const body = (await (await app.submit(report(1))).json()) as Json;
    expect(body["confirmed"]).toEqual([CANDIDATE_ID]);
  });
});
