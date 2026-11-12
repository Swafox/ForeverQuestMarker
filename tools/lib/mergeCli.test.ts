/**
 * Runs tools/merge-submissions.ts in --dry-run mode against a local mock
 * Worker, so the whole command is exercised without writing any file.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { REPO_ROOT } from "../data/sources";

const SCRIPT = join(REPO_ROOT, "tools", "merge-submissions.ts");

let server: ReturnType<typeof Bun.serve>;
let requests: { path: string; authorization: string | null }[] = [];

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push({
        path: pathname,
        authorization: request.headers.get("Authorization"),
      });
      if (pathname === "/api/confirmed") {
        return Response.json({
          generatedAt: "2026-09-23T12:00:00.000Z",
          meta: { foreverBuild: "0.0.0.1" },
          confirmed: [
            {
              id: 199001,
              titles: { enUS: { title: "A Quest From The Mock", reports: 3 } },
              reporters: 3,
              firstReported: "2026-09-20T10:00:00.000Z",
              confirmedBy: "auto",
            },
            {
              id: 176,
              titles: { enUS: { title: "Poisoned", reports: 3 } },
              reporters: 3,
              firstReported: "2026-09-20T10:00:00.000Z",
              confirmedBy: "auto",
            },
          ],
          known: [
            {
              id: 99048,
              titles: { enUS: { title: "A Missing Hand", reports: 2 } },
              reporters: 2,
              firstReported: "2026-09-20T10:00:00.000Z",
              giver: {
                type: "npc",
                id: 3142,
                name: "Orgnil Soulscar",
                reports: 2,
                total: 2,
              },
              position: { map: 1411, x: 0.45, y: 0.61, reports: 2, total: 2 },
              source: "datamined",
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

/** Asynchronous, so the mock server in this process keeps answering. */
async function run(args: string[]) {
  requests = [];
  const env = { ...process.env };
  delete env["FQM_ADMIN_TOKEN"];
  delete env["FQM_WORKER_URL"];
  const child = Bun.spawn([process.execPath, SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out, err };
}

describe("merge-submissions --dry-run", () => {
  test("reports what it would add and writes nothing", async () => {
    const confirmedPath = join(
      REPO_ROOT,
      "dataset",
      "community",
      "confirmed.json",
    );
    const before = await Bun.file(confirmedPath).text();
    const placesBefore = await Bun.file(
      join(REPO_ROOT, "dataset", "community", "places.json"),
    ).text();
    const { code, out, err } = await run([
      "--worker",
      `http://127.0.0.1:${server.port}`,
      "--dry-run",
    ]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toContain("newly added: 1");
    expect(out).toContain("+ 199001 A Quest From The Mock");
    expect(out).toContain("- 176: original Classic quest");
    expect(out).toContain(
      "Warning: the Worker was deployed with data for Forever build 0.0.0.1",
    );
    expect(out).toContain("+ 99048: npc 3142 at map 1411 (0.45, 0.61)");
    expect(out).toContain("Dry run: nothing written.");
    expect(out).toContain("places.json would gain 1 and update 0 entries.");
    expect(requests).toEqual([{ path: "/api/confirmed", authorization: null }]);
    expect(await Bun.file(confirmedPath).text()).toBe(before);
    expect(
      await Bun.file(
        join(REPO_ROOT, "dataset", "community", "places.json"),
      ).text(),
    ).toBe(placesBefore);
  });

  test("fails clearly when the Worker answers with an error", async () => {
    const { code, err } = await run([
      "--worker",
      `http://127.0.0.1:${server.port}/missing`,
      "--dry-run",
    ]);
    expect(code).toBe(1);
    expect(err).toContain("failed with 404");
  });
});
