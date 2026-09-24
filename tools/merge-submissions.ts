#!/usr/bin/env bun
/**
 * Merges community quest reports collected by the Worker (worker/) into
 * dataset/community and regenerates the addon's data. See docs/PIPELINE.md.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  CLASSIC_QUEST_IDS,
  DATAMINED_FOREVER_QUEST_IDS,
  ERA_CLIENT_QUEST_IDS,
  SOD_QUEST_IDS,
} from "../worker/src/generated/questData";
import { parseQuestieQuestFacts } from "./data/parse";
import { fetchText, questieRawUrl, readPins, REPO_ROOT } from "./data/sources";
import {
  findChangeCandidates,
  renderChangeReport,
  type ChangeComparison,
} from "./lib/changeCandidates";
import {
  mergeConfirmed,
  parseCommunityFile,
  serializeCommunityFile,
} from "./lib/community";
import {
  pullRequestBody,
  pullRequestTitle,
  renderSummary,
  type MergeSummary,
} from "./lib/mergeSummary";
import { branchName, openPullRequest } from "./lib/pullRequest";
import {
  fetchWorkerJson,
  parseClassicObservations,
  parseConfirmedResponse,
  workerBaseUrl,
} from "./lib/workerApi";

const USAGE = `Usage: bun tools/merge-submissions.ts [options]

Pulls quests confirmed by community reports from the Worker, adds new ones to
dataset/community/confirmed.json and regenerates the addon data.

Options:
  --worker <url>         Worker base URL (default: $FQM_WORKER_URL)
  --admin-token <token>  Admin token (default: $FQM_ADMIN_TOKEN); enables the Classic
                         change report in .cache/change-candidates.md
  --min-reports <n>      Agreeing reports needed for a change candidate (default: 2)
  --dry-run              Show what would change and write nothing
  --offline              Use only cached QuestieDB and wago.tools downloads
  --summary-file <path>  Also write the summary as a pull request body (for CI)
  --pr                   Commit on a new branch and open a pull request with gh.
                         Meant for CI or deliberate manual use.
  -h, --help             Show this help`;

const CONFIRMED_FILE = "dataset/community/confirmed.json";
const CHANGED_FILE = "dataset/community/changed.json";
const REPORT_FILE = ".cache/change-candidates.md";
/** Files the pipeline may modify, for --pr. */
const GENERATED_PATHS = [
  CONFIRMED_FILE,
  "Data",
  "tests/fixtures/quest_sets.lua",
  "worker/src/generated/questData.ts",
];

function readFlags() {
  try {
    return parseArgs({
      args: Bun.argv.slice(2),
      options: {
        worker: { type: "string" },
        "admin-token": { type: "string" },
        "min-reports": { type: "string", default: "2" },
        "dry-run": { type: "boolean", default: false },
        offline: { type: "boolean", default: false },
        "summary-file": { type: "string" },
        pr: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    }).values;
  } catch (error) {
    console.error(
      `${error instanceof Error ? error.message : error}\n\n${USAGE}`,
    );
    process.exit(2);
  }
}

async function writeFile(relativePath: string, content: string): Promise<void> {
  const path = join(REPO_ROOT, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

function regenerateData(offline: boolean): void {
  const command = [
    process.execPath,
    "tools/generate-data.ts",
    ...(offline ? ["--offline"] : []),
  ];
  const result = Bun.spawnSync(command, {
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0)
    throw new Error(
      `bun tools/generate-data.ts exited with ${result.exitCode}`,
    );
}

async function main(): Promise<void> {
  const flags = readFlags();
  if (flags.help) {
    console.log(USAGE);
    return;
  }
  const workerArg = flags.worker ?? process.env["FQM_WORKER_URL"];
  if (!workerArg) {
    console.error(
      `No Worker URL: pass --worker or set FQM_WORKER_URL.\n\n${USAGE}`,
    );
    process.exit(2);
  }
  if (flags.pr && flags["dry-run"])
    throw new Error("--pr and --dry-run cannot be combined");
  const minReports = Number(flags["min-reports"]);
  if (!Number.isInteger(minReports) || minReports < 1)
    throw new Error("--min-reports must be a positive integer");
  const adminToken =
    flags["admin-token"] ?? process.env["FQM_ADMIN_TOKEN"] ?? "";
  const dryRun = flags["dry-run"];
  const baseUrl = workerBaseUrl(workerArg);
  const pins = await readPins();
  const warnings: string[] = [];

  const confirmed = parseConfirmedResponse(
    await fetchWorkerJson(baseUrl, "/api/confirmed"),
  );
  if (
    confirmed.foreverBuild &&
    confirmed.foreverBuild !== pins.wago.foreverBuild
  ) {
    warnings.push(
      `the Worker was deployed with data for Forever build ${confirmed.foreverBuild}, ` +
        `this checkout pins ${pins.wago.foreverBuild}; redeploy the Worker after regenerating data`,
    );
  }

  const originalText = await Bun.file(join(REPO_ROOT, CONFIRMED_FILE)).text();
  const merge = mergeConfirmed(
    parseCommunityFile(originalText, CONFIRMED_FILE),
    confirmed.confirmed,
    {
      classic: new Set(CLASSIC_QUEST_IDS),
      datamined: new Set(DATAMINED_FOREVER_QUEST_IDS),
      sod: new Set(SOD_QUEST_IDS),
      era: new Set(ERA_CLIENT_QUEST_IDS),
    },
  );
  const mergedText = serializeCommunityFile(merge.file);
  const changed = merge.added.length > 0 && mergedText !== originalText;

  let changes: ChangeComparison | null = null;
  let report: string | null = null;
  if (adminToken) {
    const observations = parseClassicObservations(
      await fetchWorkerJson(
        baseUrl,
        "/api/admin/classic-observations",
        adminToken,
      ),
    );
    const questieSource = await fetchText(
      questieRawUrl(pins, pins.questieDB.classicQuestDB),
      {
        immutable: true,
        offline: flags.offline,
      },
    );
    const recorded = parseCommunityFile(
      await Bun.file(join(REPO_ROOT, CHANGED_FILE)).text(),
      CHANGED_FILE,
    );
    changes = findChangeCandidates(
      observations,
      parseQuestieQuestFacts(questieSource),
      new Set(recorded.quests.map((entry) => entry.id)),
      { minReports },
    );
    report = renderChangeReport(changes, {
      generatedAt: new Date().toISOString(),
      workerUrl: baseUrl,
      questie: `${pins.questieDB.repo}@${pins.questieDB.commit.slice(0, 12)}`,
      minReports,
    });
  }

  const summary: MergeSummary = {
    workerUrl: baseUrl,
    generatedAt: confirmed.generatedAt,
    confirmedByWorker: confirmed.confirmed.length,
    added: merge.added,
    alreadyListed: merge.alreadyListed.length,
    skipped: merge.skipped,
    changes,
    reportPath: report === null || dryRun ? null : REPORT_FILE,
    warnings,
  };
  console.log(renderSummary(summary));

  if (dryRun) {
    console.log(
      `Dry run: nothing written.${changed ? ` ${CONFIRMED_FILE} would gain ${merge.added.length} entries.` : ""}`,
    );
    return;
  }

  if (report !== null) await writeFile(REPORT_FILE, report);
  if (flags["summary-file"])
    await Bun.write(flags["summary-file"], pullRequestBody(summary));
  if (!changed) {
    console.log("No new quests; the dataset and generated data are unchanged.");
    return;
  }

  await writeFile(CONFIRMED_FILE, mergedText);
  console.log(`Wrote ${CONFIRMED_FILE}; regenerating addon data.`);
  regenerateData(flags.offline);

  if (flags.pr) {
    const url = openPullRequest({
      root: REPO_ROOT,
      branch: branchName(new Date()),
      title: pullRequestTitle(summary),
      body: pullRequestBody(summary),
      paths: GENERATED_PATHS,
    });
    console.log(`Opened pull request ${url}`);
  }
}

main().catch((error: unknown) => {
  console.error(
    `merge-submissions: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
