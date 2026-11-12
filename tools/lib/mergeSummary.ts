/** Human-readable summary of a merge run, used for the console and the pull request body. */
import type { CommunityEntry, SkippedQuest } from "./community";
import type { ChangeComparison } from "./changeCandidates";
import type { PlaceEntry } from "./places";

export interface PlacesSummary {
  added: PlaceEntry[];
  updated: PlaceEntry[];
  /** Reported new quests whose giver players do not agree on yet. */
  undecided: number;
}

export interface MergeSummary {
  workerUrl: string;
  generatedAt: string;
  confirmedByWorker: number;
  added: CommunityEntry[];
  alreadyListed: number;
  skipped: SkippedQuest[];
  places: PlacesSummary;
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
  const { places } = summary;
  lines.push(
    `Quest givers agreed on: ${places.added.length} added, ${places.updated.length} updated; ` +
      `not agreed yet: ${places.undecided}.`,
  );
  const describePlace = (entry: PlaceEntry) =>
    `${entry.id}: ${entry.giver.type} ${entry.giver.id}` +
    (entry.map === undefined
      ? ""
      : ` at map ${entry.map} (${entry.x}, ${entry.y})`);
  for (const entry of places.added) lines.push(`  + ${describePlace(entry)}`);
  for (const entry of places.updated) lines.push(`  ~ ${describePlace(entry)}`);
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
  const places = summary.places.added.length + summary.places.updated.length;
  const parts: string[] = [];
  if (count > 0)
    parts.push(
      `add ${count} community-confirmed quest${count === 1 ? "" : "s"}`,
    );
  if (places > 0)
    parts.push(`update ${places} quest giver${places === 1 ? "" : "s"}`);
  return `chore(data): ${parts.join(", ") || "refresh community data"}`;
}

export function pullRequestBody(summary: MergeSummary): string {
  return [
    "Automated merge of community quest reports (`tools/merge-submissions.ts`).",
    "",
    "```",
    renderSummary(summary),
    "```",
    "",
    "Review the added titles, notes and quest givers before merging. Classic change candidates are not applied;",
    "see the workflow artifact or `.cache/change-candidates.md` when run locally.",
    "",
  ].join("\n");
}
