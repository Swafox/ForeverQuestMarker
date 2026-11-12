import { describe, expect, test } from "bun:test";
import type { BuildResult } from "./build";
import { emitAll } from "./emit";

const result: BuildResult = {
  sets: {
    classic: [176, 783],
    sod: [79000],
    era: [9999],
    datamined: [99048, 99049],
    community: [],
    changed: [783],
  },
  places: [
    {
      id: 99048,
      giver: { type: "npc", id: 3142 },
      map: 1411,
      x: 0.45,
      y: 0.61,
      reporters: 3,
    },
    { id: 99049, giver: { type: "object", id: 7 } },
  ],
  changeKinds: [{ id: 783, kinds: ["giver", "objectives"] }],
  warnings: [],
  pins: {
    questieDB: {
      repo: "Questie/QuestieDB",
      commit: "a444a6418113ae0fce5d30c897674132e756ba1d",
      classicQuestDB: "data/Classic/classicQuestDB.lua",
      eraQuestFixes: "src/corrections/Era/classicQuestFixes.lua",
      sodBaseQuests: "src/corrections/Sod/sodBaseQuests.lua",
    },
    wago: { foreverBuild: "1.60.1.70888", eraBuild: "1.15.9.70576" },
  },
  inputs: {
    questieClassic: 2,
    questieEraAdditions: [],
    foreverClient: 4,
    eraClient: 3,
    classicAlsoNewInForeverClient: [],
  },
};

describe("emitAll", () => {
  const files = emitAll(result);

  test("writes quest givers and positions", () => {
    expect(files["Data/Places.lua"]).toEndWith(
      [
        "ns.Data.places = {",
        '\t[99048] = { "npc", 3142, 1411, 0.45, 0.61 },',
        '\t[99049] = { "object", 7 },',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("writes the kinds of change", () => {
    expect(files["Data/Changes.lua"]).toEndWith(
      [
        "ns.Data.changeKinds = {",
        '\t[783] = { "giver", "objectives" },',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("counts places in the metadata", () => {
    expect(files["Data/Meta.lua"]).toContain("\t\tplaces = 2,\n");
  });

  test("mirrors both into a plain fixture for the specs", () => {
    expect(files["tests/fixtures/community_data.lua"]).toContain(
      '\t\t{ id = 99048, giverType = "npc", giverId = 3142, map = 1411, x = 0.45, y = 0.61 },\n' +
        '\t\t{ id = 99049, giverType = "object", giverId = 7 },\n',
    );
    expect(files["tests/fixtures/community_data.lua"]).toContain(
      '\t\t{ id = 783, kinds = { "giver", "objectives" } },\n',
    );
  });

  test("produces Lua that the addon's Lua 5.1 can load", () => {
    const lua = Bun.which("lua5.1") ?? Bun.which("luajit");
    if (!lua) return;
    for (const path of [
      "Data/Places.lua",
      "Data/Changes.lua",
      "Data/Meta.lua",
      "tests/fixtures/community_data.lua",
    ]) {
      const check = Bun.spawnSync(
        [lua, "-e", `assert(loadstring(io.read("*a")))`],
        { stdin: new TextEncoder().encode(files[path]!) },
      );
      expect(check.exitCode).toBe(0);
    }
  });
});
