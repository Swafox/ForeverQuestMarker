/**
 * Contract test between the two sides of docs/EXPORT_FORMAT.md: the addon's exporter,
 * run inside the client emulation by tools/sample-export.lua, must produce documents
 * the Worker's validator accepts. Skipped when no Lua interpreter is installed.
 */
import { describe, expect, test } from "bun:test";
import { parseExport } from "../worker/src/validate";
import { REPO_ROOT } from "./data/sources";

const lua = ["luajit", "lua5.1", "lua"].find(
  (name) => Bun.which(name) !== null,
);

async function sampleExport(...args: string[]): Promise<string> {
  const result = await Bun.$`${lua!} tools/sample-export.lua ${args}`
    .cwd(REPO_ROOT)
    .quiet();
  return result.stdout.toString();
}

describe.skipIf(!lua)("addon export accepted by the Worker", () => {
  const now = () => Math.floor(Date.now() / 1000);

  test("a realistic session with awkward input", async () => {
    const result = parseExport(await sampleExport("json"), now());
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
    const byId = new Map(
      result.document.quests.map((quest) => [quest.id, quest]),
    );
    expect(byId.size).toBe(8);
    expect(byId.get(92401)?.giver?.name).toBe("Scout of the Watch");
    expect(byId.get(999999)?.level).toBeNull();
    expect(byId.get(999999)?.x).toBeNull();
    expect(byId.get(95189)?.title).toBe("Café in the Ruins");
  });

  test("an oversized recorder is capped to what one export may carry", async () => {
    const result = parseExport(await sampleExport("json", "bulk"), now());
    if (!result.ok)
      throw new Error(JSON.stringify(result.errors.slice(0, 5), null, 2));
    expect(result.document.quests.length).toBe(5000);
    // New quests are kept first; the Classic observation is the one dropped.
    expect(result.document.quests.some((quest) => quest.id === 176)).toBe(
      false,
    );
  });

  test("the CSV variant has one row per quest", async () => {
    const lines = (await sampleExport("csv")).trim().split("\n");
    expect(lines[0]).toStartWith("id,title,state,");
    // Header plus 8 quests; line breaks in titles were already replaced by the recorder.
    expect(lines).toHaveLength(1 + 8);
  });
});
