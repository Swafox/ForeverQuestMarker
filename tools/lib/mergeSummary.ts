/** Human-readable summary of a merge run, used for the console and the pull request body. */
import type { CommunityEntry, SkippedQuest } from "./community";
import type { ChangeComparison } from "./changeCandidates";

export interface MergeSummary {
  workerUrl: string;
  generatedAt: string;
  confirmedByWorker: number;
  added: CommunityEntry[];
  alreadyListed: number;
  skipped: SkippedQuest[];
  changes: ChangeComparison | null;
  reportPath: string | null;
  warnings: string[];
}

export function renderSummary(summary: MergeSummary): string {
  const lines = [
    `Worker ${summary.workerUrl}, data generated ${summary.generatedAt}.`,
    `Confirmed by community reports: ${summary.confirmedByWorker}; already in confirmed.json: ${summary.alreadyListed}; ` +
      `newly added: ${summary.added.length}.`,
  ];
  for (const entry of summary.added) {
    lines.push(
      `  + ${entry.id}${entry.title ? ` ${entry.title}` : ""} (${entry.note ?? "no note"})`,
    );
  }
  if (summary.skipped.length > 0) {
    lines.push(
      `Skipped because the local data already classifies them: ${summary.skipped.length}.`,
    );
    for (const skipped of summary.skipped)
      lines.push(`  - ${skipped.id}: ${skipped.reason}`);
  }
  if (summary.changes) {
    const fresh = summary.changes.candidates.filter(
      (candidate) => !candidate.alreadyRecorded,
    ).length;
    lines.push(
      `Classic change candidates: ${fresh} new, ${summary.changes.candidates.length - fresh} already recorded` +
        (summary.reportPath ? `; report: ${summary.reportPath}` : "") +
        ".",
    );
  } else {
    lines.push("Classic change detection skipped (no admin token).");
  }
  for (const warning of summary.warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

export function pullRequestTitle(summary: MergeSummary): string {
  const count = summary.added.length;
  return `chore(data): add ${count} community-confirmed quest${count === 1 ? "" : "s"}`;
}

export function pullRequestBody(summary: MergeSummary): string {
  return [
    "Automated merge of community quest reports (`tools/merge-submissions.ts`).",
    "",
    "```",
    renderSummary(summary),
    "```",
    "",
    "Review the added titles and notes before merging. Classic change candidates are not applied;",
    "see the workflow artifact or `.cache/change-candidates.md` when run locally.",
    "",
  ].join("\n");
}
