import {
  leader,
  normalizeTitle,
  titleConsensus,
  type Tally,
} from "./consensus";
import type { GiverRecord } from "./validate";

/**
 * Votes are per-quest counters of observed values. title, level, giver,
 * finisher and objectives are kept per locale (titles, names and objective
 * text are localized); map, items and position use locale "".
 */
export type VoteDimension =
  | "title"
  | "level"
  | "giver"
  | "finisher"
  | "objectives"
  | "map"
  | "items"
  | "position";

/** Positions are counted in cells of this size (0..1 map coordinates). */
export const POSITION_CELL = 0.02;
const LAST_CELL = Math.round(1 / POSITION_CELL) - 1;

export interface Vote {
  dimension: VoteDimension;
  locale: string;
  value: string;
  count: number;
}

export interface LocaleSummary {
  reports: number;
  title: string;
  titleReports: number;
  titleVariants: number;
  agreed: boolean;
  level: number | null;
  levelReports: number;
}

export interface GiverSummary {
  type: string;
  id: number | null;
  name: string | null;
  /** Reports naming this giver. */
  reports: number;
  /** Reports naming any giver. */
  total: number;
}

export interface ValueSummary {
  value: string;
  reports: number;
  total: number;
}

export interface PositionSummary {
  map: number;
  /** Center of the most reported position cell. */
  x: number;
  y: number;
  reports: number;
  total: number;
}

export interface QuestSummary {
  locales: Record<string, LocaleSummary>;
  level: { value: number; reports: number; total: number } | null;
  giver: GiverSummary | null;
  /** Who shows the progress or reward page. */
  finisher: GiverSummary | null;
  /** Leading objective text hash per locale. */
  objectives: Record<string, ValueSummary>;
  /** Leading hand-in item set (IDs ascending, comma-separated). */
  items: ValueSummary | null;
  map: { id: number; reports: number; total: number } | null;
  position: PositionSummary | null;
}

export const PREFERRED_LOCALE = "enUS";

export function emptySummary(): QuestSummary {
  return {
    locales: {},
    level: null,
    giver: null,
    finisher: null,
    objectives: {},
    items: null,
    map: null,
    position: null,
  };
}

/** Vote value for a position, or null without a map and both coordinates. */
export function positionVoteValue(
  map: number | null,
  x: number | null,
  y: number | null,
): string | null {
  if (map === null || x === null || y === null) return null;
  const cell = (value: number) =>
    Math.min(Math.floor(value / POSITION_CELL), LAST_CELL);
  return `${map}:${cell(x)}:${cell(y)}`;
}

function parsePositionVote(value: string): {
  map: number;
  x: number;
  y: number;
} {
  const [map, cx, cy] = value.split(":").map(Number) as [
    number,
    number,
    number,
  ];
  const center = (cell: number) =>
    Math.round((cell + 0.5) * POSITION_CELL * 1000) / 1000;
  return { map, x: center(cx), y: center(cy) };
}

/** Vote value for a giver, or null when there is nothing to identify it by. */
export function giverVoteValue(giver: GiverRecord | null): string | null {
  if (!giver || (giver.id === null && giver.name === null)) return null;
  return JSON.stringify([giver.type, giver.id, giver.name]);
}

function parseGiverVote(value: string): GiverRecord {
  const [type, id, name] = JSON.parse(value) as [
    GiverRecord["type"],
    number | null,
    string | null,
  ];
  return { type, id, name };
}

function giverKey(giver: GiverRecord): string {
  return giver.id !== null
    ? `${giver.type}:${giver.id}`
    : `${giver.type}:~${normalizeTitle(giver.name ?? "")}`;
}

function summarizeGiver(votes: readonly Vote[]): GiverSummary | null {
  const parsed = votes.map((vote) => ({
    vote,
    giver: parseGiverVote(vote.value),
  }));
  const byKey = new Map<string, typeof parsed>();
  for (const entry of parsed) {
    const key = giverKey(entry.giver);
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }
  const top = leader(
    [...byKey].map(([key, group]) => ({
      value: key,
      count: group.reduce((sum, entry) => sum + entry.vote.count, 0),
    })),
  );
  if (!top) return null;
  const group = byKey.get(top.value)!;
  const names = (entries: typeof parsed): Tally[] =>
    entries
      .filter((entry) => entry.giver.name !== null)
      .map((entry) => ({ value: entry.giver.name!, count: entry.vote.count }));
  const preferred = names(
    group.filter((entry) => entry.vote.locale === PREFERRED_LOCALE),
  );
  const name =
    leader(preferred.length > 0 ? preferred : names(group))?.value ?? null;
  const { type, id } = group[0]!.giver;
  return { type, id, name, reports: top.count, total: top.total };
}

function numericLeader(
  tallies: readonly Tally[],
): { value: number; count: number; total: number } | null {
  const top = leader(tallies);
  return top
    ? { value: Number(top.value), count: top.count, total: top.total }
    : null;
}

/** Summary of all votes for one quest. Locales are listed in sorted order. */
export function summarize(votes: readonly Vote[]): QuestSummary {
  const summary = emptySummary();
  const byDimension = (dimension: VoteDimension) =>
    votes.filter((vote) => vote.dimension === dimension && vote.count > 0);

  const titlesByLocale = new Map<string, Tally[]>();
  for (const vote of byDimension("title")) {
    const tallies = titlesByLocale.get(vote.locale) ?? [];
    tallies.push({ value: vote.value, count: vote.count });
    titlesByLocale.set(vote.locale, tallies);
  }
  const levelVotes = byDimension("level");
  for (const locale of [...titlesByLocale.keys()].sort()) {
    const consensus = titleConsensus(titlesByLocale.get(locale)!)!;
    const level = numericLeader(
      levelVotes.filter((vote) => vote.locale === locale),
    );
    summary.locales[locale] = {
      reports: consensus.total,
      title: consensus.title,
      titleReports: consensus.reports,
      titleVariants: consensus.variants,
      agreed: consensus.agreed,
      level: level?.value ?? null,
      levelReports: level?.count ?? 0,
    };
  }

  const levelTotals = new Map<string, number>();
  for (const vote of levelVotes)
    levelTotals.set(
      vote.value,
      (levelTotals.get(vote.value) ?? 0) + vote.count,
    );
  const level = numericLeader(
    [...levelTotals].map(([value, count]) => ({ value, count })),
  );
  summary.level = level
    ? { value: level.value, reports: level.count, total: level.total }
    : null;

  summary.giver = summarizeGiver(byDimension("giver"));
  summary.finisher = summarizeGiver(byDimension("finisher"));

  const hashesByLocale = new Map<string, Tally[]>();
  for (const vote of byDimension("objectives")) {
    const tallies = hashesByLocale.get(vote.locale) ?? [];
    tallies.push({ value: vote.value, count: vote.count });
    hashesByLocale.set(vote.locale, tallies);
  }
  for (const locale of [...hashesByLocale.keys()].sort()) {
    const top = leader(hashesByLocale.get(locale)!)!;
    summary.objectives[locale] = {
      value: top.value,
      reports: top.count,
      total: top.total,
    };
  }

  const items = leader(byDimension("items"));
  summary.items = items
    ? { value: items.value, reports: items.count, total: items.total }
    : null;

  const map = numericLeader(byDimension("map"));
  summary.map = map
    ? { id: map.value, reports: map.count, total: map.total }
    : null;

  const position = leader(byDimension("position"));
  summary.position = position
    ? {
        ...parsePositionVote(position.value),
        reports: position.count,
        total: position.total,
      }
    : null;
  return summary;
}

/** Locales whose reports do not agree on one title. */
export function conflictingLocales(summary: QuestSummary): string[] {
  return Object.entries(summary.locales)
    .filter(([, locale]) => !locale.agreed)
    .map(([name]) => name);
}
