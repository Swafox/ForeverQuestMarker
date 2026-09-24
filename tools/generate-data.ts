#!/usr/bin/env bun
/**
 * Regenerates the addon's quest ID tables and the derived test/worker data.
 *
 *   bun tools/generate-data.ts            generate from the pins in dataset/sources.json
 *   bun tools/generate-data.ts --update   move the pins to the newest upstream revisions first
 *   bun tools/generate-data.ts --check    fail if the committed outputs are out of date (CI)
 *   bun tools/generate-data.ts --offline  use only cached downloads in .cache/
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { buildQuestSets } from "./data/build";
import { emitAll } from "./data/emit";
import {
  readPins,
  REPO_ROOT,
  resolveLatestPins,
  writePins,
} from "./data/sources";

const { values: flags } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    update: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
  },
});

let pins = await readPins();
if (flags.update) {
  pins = await resolveLatestPins(pins);
  await writePins(pins);
  console.log(
    `Pinned QuestieDB ${pins.questieDB.commit}, Forever ${pins.wago.foreverBuild}, Era ${pins.wago.eraBuild}`,
  );
}

const result = await buildQuestSets(pins, flags.offline);
const files = emitAll(result);

let stale = 0;
for (const [relativePath, content] of Object.entries(files)) {
  const path = join(REPO_ROOT, relativePath);
  const existing = Bun.file(path);
  const current = (await existing.exists()) ? await existing.text() : null;
  if (current === content) continue;
  if (flags.check) {
    console.error(`out of date: ${relativePath}`);
    stale++;
    continue;
  }
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
  console.log(`wrote ${relativePath}`);
}

const { sets, inputs, warnings } = result;
console.log(
  [
    `QuestieDB Classic entries: ${inputs.questieClassic} (+${inputs.questieEraAdditions.length} Era additions: ${inputs.questieEraAdditions.join(", ")})`,
    `QuestV2 rows: Forever ${inputs.foreverClient}, Classic Era ${inputs.eraClient}`,
    `Sets: classic ${sets.classic.length}, sod ${sets.sod.length}, era ${sets.era.length}, datamined ${sets.datamined.length}, community ${sets.community.length}, changed ${sets.changed.length}`,
    `Classic quests newly present in the Forever QuestV2 table (kept as Classic): ${inputs.classicAlsoNewInForeverClient.join(", ") || "none"}`,
  ].join("\n"),
);
for (const warning of warnings) console.warn(`warning: ${warning}`);

if (stale > 0) {
  console.error(
    `${stale} generated file(s) are stale; run: bun tools/generate-data.ts`,
  );
  process.exit(1);
}
