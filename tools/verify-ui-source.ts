#!/usr/bin/env bun
/**
 * Checks the addon's assumptions (tools/ui-contract.ts) against the client's UI
 * source, and regenerates the test mock's widget API list from it.
 *
 *   bun tools/verify-ui-source.ts <path to wow-ui-source checkout>
 *   bun tools/verify-ui-source.ts --clone     shallow-clone the forever branch into .cache/
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "./data/sources";
import { CONTRACT, type ContractCheck, type SourceKind } from "./ui-contract";

const { values: flags, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    clone: { type: "boolean", default: false },
    branch: { type: "string", default: "forever" },
  },
  allowPositionals: true,
});

let root = positionals[0] ?? process.env.WOW_UI_SOURCE;
if (flags.clone) {
  root = join(REPO_ROOT, ".cache", `wow-ui-source-${flags.branch}`);
  if (existsSync(root)) {
    await Bun.$`git -C ${root} fetch --depth 1 origin ${flags.branch}`.quiet();
    await Bun.$`git -C ${root} reset --hard FETCH_HEAD`.quiet();
  } else {
    await Bun.$`git clone --depth 1 --branch ${flags.branch} https://github.com/Gethe/wow-ui-source.git ${root}`.quiet();
  }
}
if (!root) {
  console.error(
    "usage: bun tools/verify-ui-source.ts <wow-ui-source path> | --clone",
  );
  process.exit(2);
}

const addons = join(root, "Interface", "AddOns");
const docsDir = join(addons, "Blizzard_APIDocumentationGenerated");
const version = existsSync(join(root, "version.txt"))
  ? (await Bun.file(join(root, "version.txt")).text()).trim()
  : "unknown";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

function kindOf(path: string): SourceKind | null {
  if (path.startsWith(docsDir)) return path.endsWith(".lua") ? "docs" : null;
  if (path.endsWith(".lua")) return "lua";
  if (path.endsWith(".xml")) return "xml";
  return null;
}

const pending = new Set<ContractCheck>(CONTRACT);
for await (const path of walk(addons)) {
  const kind = kindOf(path);
  if (!kind) continue;
  const candidates = [...pending].filter((check) => check.kind === kind);
  if (candidates.length === 0) continue;
  const text = await Bun.file(path).text();
  for (const check of candidates) {
    if (check.pattern.test(text)) pending.delete(check);
  }
  if (pending.size === 0) break;
}

console.log(
  `Checked ${CONTRACT.length} assumptions against wow-ui-source ${version}`,
);
for (const check of pending) {
  console.error(
    `MISSING ${check.id} (used by ${check.usedBy}): /${check.pattern.source}/`,
  );
}

const generator =
  await Bun.$`luajit tools/gen-widget-api.lua ${docsDir} ${version}`
    .cwd(REPO_ROOT)
    .nothrow()
    .quiet();
if (generator.exitCode !== 0) {
  console.error(
    `widget API generation failed:\n${generator.stderr.toString()}`,
  );
  process.exit(1);
}
console.log(generator.stdout.toString().trim());

if (pending.size > 0) {
  console.error(
    `${pending.size} assumption(s) no longer hold; revisit the listed files.`,
  );
  process.exit(1);
}
console.log("All assumptions hold.");
