/**
 * Compares what players observe for original Classic quests with QuestieDB's
 * Classic data. The result is a report for human review; nothing is applied
 * to dataset/community/changed.json automatically.
 */
import type { QuestieActors, QuestieQuestFacts } from "../data/parse";
import { questieObjectivesHash } from "./objectivesHash";
import type {
  ActorObservation,
  Agreement,
  ClassicObservation,
} from "./workerApi";

export const CHANGE_KINDS = [
  "title",
  "level",
  "giver",
  "finisher",
  "objectives",
  "items",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface ChangeCandidate {
  id: number;
  kinds: ChangeKind[];
  questieName: string;
  questieLevel: number | null;
  /** Observed enUS title, if enough reports agree on it. */
  observedTitle: string | null;
  titleReports: number;
  titleTotal: number;
  observedLevel: number | null;
  levelReports: number;
  levelTotal: number;
  /** One line per changed giver, finisher, objectives or items value. */
  details: string[];
  /** Already listed in dataset/community/changed.json. */
  alreadyRecorded: boolean;
}

export interface ChangeOptions {
  /** Reports that must agree on an observed value before it is compared. */
  minReports: number;
}

export interface ChangeComparison {
  candidates: ChangeCandidate[];
  observed: number;
  /** Observed quests QuestieDB has no entry for (for example Era-only additions). */
  withoutBaseline: number;
}

/** Only English titles can be compared with QuestieDB. */
const TITLE_LOCALES = ["enUS", "enGB"];

/** Case- and whitespace-insensitive form, as used by the Worker. */
export function normalizeTitle(title: string): string {
  return title.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function agreed(
  reports: number,
  total: number,
  options: ChangeOptions,
): boolean {
  return reports >= options.minReports && total > 0 && reports * 3 >= total * 2;
}

function agreedValue(value: Agreement | null, options: ChangeOptions): boolean {
  return value !== null && agreed(value.reports, value.total, options);
}

/** QuestieDB's IDs for an observed giver or finisher type, or null without a baseline. */
function baselineIds(
  actors: QuestieActors | null,
  type: string,
): number[] | null {
  if (!actors) return null;
  if (type === "npc") return actors.npcs;
  if (type === "object") return actors.objects;
  if (type === "item") return actors.items;
  return null;
}

function describeActors(actors: QuestieActors): string {
  const parts = [
    ...actors.npcs.map((id) => `npc ${id}`),
    ...actors.objects.map((id) => `object ${id}`),
    ...actors.items.map((id) => `item ${id}`),
  ];
  return parts.join(", ");
}

/** An agreed giver or finisher that QuestieDB does not list, as a report line. */
function actorChange(
  label: string,
  observed: ActorObservation | null,
  baseline: QuestieActors | null,
  options: ChangeOptions,
): string | null {
  if (!observed || observed.id === null || !agreedValue(observed, options))
    return null;
  const ids = baselineIds(baseline, observed.type);
  if (ids === null || ids.includes(observed.id)) return null;
  return `${label}: ${observed.type} ${observed.id} (${observed.reports}/${observed.total}); QuestieDB: ${describeActors(baseline!)}`;
}

export function findChangeCandidates(
  observations: readonly ClassicObservation[],
  facts: ReadonlyMap<number, QuestieQuestFacts>,
  recorded: ReadonlySet<number>,
  options: ChangeOptions,
): ChangeComparison {
  const candidates: ChangeCandidate[] = [];
  let withoutBaseline = 0;

  for (const observation of [...observations].sort((a, b) => a.id - b.id)) {
    const fact = facts.get(observation.id);
    if (!fact) {
      withoutBaseline++;
      continue;
    }
    const english = TITLE_LOCALES.map(
      (locale) => observation.locales[locale],
    ).find((entry) => entry !== undefined);
    const titleAgreed =
      english !== undefined &&
      english.agreed &&
      english.titleReports >= options.minReports;
    const titleChanged =
      titleAgreed &&
      normalizeTitle(english.title) !== normalizeTitle(fact.name);

    const level = observation.level;
    const levelAgreed =
      level !== null && agreed(level.reports, level.total, options);
    const levelChanged =
      levelAgreed &&
      fact.questLevel !== null &&
      fact.questLevel > 0 &&
      level.value !== fact.questLevel;

    const kinds: ChangeKind[] = [
      ...(titleChanged ? ["title" as const] : []),
      ...(levelChanged ? ["level" as const] : []),
    ];
    const details: string[] = [];

    const giver = actorChange(
      "giver",
      observation.giver,
      fact.startedBy,
      options,
    );
    if (giver) {
      kinds.push("giver");
      details.push(giver);
    }
    const finisher = actorChange(
      "finisher",
      observation.finisher,
      fact.finishedBy,
      options,
    );
    if (finisher) {
      kinds.push("finisher");
      details.push(finisher);
    }

    const baselineHash = fact.objectivesText
      ? questieObjectivesHash(fact.objectivesText)
      : null;
    const hash = TITLE_LOCALES.map(
      (locale) => observation.objectives[locale],
    ).find((entry) => entry !== undefined);
    if (
      baselineHash !== null &&
      hash !== undefined &&
      agreedValue(hash, options) &&
      hash.value !== baselineHash
    ) {
      kinds.push("objectives");
      details.push(
        `objectives: text hash ${hash.value} (${hash.reports}/${hash.total}); QuestieDB text hashes to ${baselineHash}`,
      );
    }

    const items = observation.items;
    const baselineItems = fact.objectiveItems.join(",");
    if (items && agreedValue(items, options) && items.value !== baselineItems) {
      kinds.push("items");
      details.push(
        `items: ${items.value} (${items.reports}/${items.total}); QuestieDB: ${baselineItems || "none"}`,
      );
    }

    if (kinds.length === 0) continue;
    candidates.push({
      id: observation.id,
      kinds,
      questieName: fact.name,
      questieLevel: fact.questLevel,
      observedTitle: titleAgreed ? english.title : null,
      titleReports: english?.titleReports ?? 0,
      titleTotal: english?.reports ?? 0,
      observedLevel: levelAgreed ? level.value : null,
      levelReports: level?.reports ?? 0,
      levelTotal: level?.total ?? 0,
      details,
      alreadyRecorded: recorded.has(observation.id),
    });
  }
  return { candidates, observed: observations.length, withoutBaseline };
}

function cell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

export interface ReportContext {
  generatedAt: string;
  workerUrl: string;
  questie: string;
  minReports: number;
}

export function renderChangeReport(
  comparison: ChangeComparison,
  context: ReportContext,
): string {
  const fresh = comparison.candidates.filter(
    (candidate) => !candidate.alreadyRecorded,
  );
  const recorded = comparison.candidates.filter(
    (candidate) => candidate.alreadyRecorded,
  );
  const lines = [
    "# Classic quest change candidates",
    "",
    `Generated ${context.generatedAt} from ${context.workerUrl}, compared with ${context.questie}.`,
    `An observed value counts once at least ${context.minReports} reports and two thirds of them agree.`,
    `Observed Classic quests: ${comparison.observed}; without a QuestieDB baseline: ${comparison.withoutBaseline}.`,
    "",
    "These are not applied automatically. Check each one in game, then add confirmed changes to",
    "`dataset/community/changed.json` (with a note and the confirmed `kinds`) and run",
    "`bun tools/generate-data.ts`.",
    "",
  ];

  const table = (candidates: ChangeCandidate[]) => [
    "| ID | Changed | QuestieDB title | Observed title (reports) | QuestieDB level | Observed level (reports) | Details |",
    "| ---: | --- | --- | --- | ---: | --- | --- |",
    ...candidates.map((candidate) =>
      [
        "",
        ` ${candidate.id} `,
        ` ${candidate.kinds.join(", ")} `,
        ` ${cell(candidate.questieName)} `,
        ` ${candidate.observedTitle === null ? "-" : `${cell(candidate.observedTitle)} (${candidate.titleReports}/${candidate.titleTotal})`} `,
        ` ${candidate.questieLevel ?? "-"} `,
        ` ${candidate.observedLevel === null ? "-" : `${candidate.observedLevel} (${candidate.levelReports}/${candidate.levelTotal})`} `,
        ` ${candidate.details.length === 0 ? "-" : candidate.details.map(cell).join("<br>")} `,
        "",
      ].join("|"),
    ),
  ];

  lines.push(`## New candidates (${fresh.length})`, "");
  lines.push(...(fresh.length > 0 ? table(fresh) : ["None."]), "");
  if (recorded.length > 0) {
    lines.push(
      `## Already in changed.json (${recorded.length})`,
      "",
      ...table(recorded),
      "",
    );
  }
  return lines.join("\n");
}
