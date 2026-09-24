/** JSON shapes returned by the read endpoints. */
import {
  QUEST_CATEGORIES,
  type Classifier,
  type QuestCategory,
} from "./classify";
import { QUEST_DATA_META } from "./generated/questData";
import type { AuditRecord, QuestRow } from "./model";
import {
  CANDIDATE_STATUSES,
  type CandidateStatus,
  type PromotionConfig,
} from "./promotion";
import type { Stats } from "./repository";
import type { GiverSummary, QuestSummary } from "./summary";

export function isoTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export interface PublicQuest {
  id: number;
  /** Most common title per locale with the number of reports agreeing on it. */
  titles: Record<string, { title: string; reports: number }>;
  reporters: number;
  firstReported: string;
  lastReported: string;
  level: number | null;
  giver: Omit<GiverSummary, "reports"> | null;
  map: number | null;
}

function publicQuest(row: QuestRow): PublicQuest {
  const { summary } = row;
  return {
    id: row.questId,
    titles: Object.fromEntries(
      Object.entries(summary.locales).map(([locale, entry]) => [
        locale,
        { title: entry.title, reports: entry.titleReports },
      ]),
    ),
    reporters: row.reporters,
    firstReported: isoTime(row.firstReported),
    lastReported: isoTime(row.lastReported),
    level: summary.level?.value ?? null,
    giver: summary.giver
      ? {
          type: summary.giver.type,
          id: summary.giver.id,
          name: summary.giver.name,
        }
      : null,
    map: summary.map?.id ?? null,
  };
}

function thresholds(config: PromotionConfig) {
  return { minClients: config.minClients, minIps: config.minNetworks };
}

export function confirmedPayload(
  confirmed: readonly QuestRow[],
  known: readonly QuestRow[],
  classifier: Classifier,
  config: PromotionConfig,
  now: number,
) {
  return {
    generatedAt: isoTime(now),
    meta: QUEST_DATA_META,
    thresholds: thresholds(config),
    confirmed: confirmed
      .filter((row) => classifier.category(row.questId) === "candidate")
      .map((row) => ({
        ...publicQuest(row),
        confirmedBy: row.statusSource ?? "auto",
      })),
    known: known
      .filter((row) => classifier.category(row.questId) === "known")
      .map((row) => ({
        ...publicQuest(row),
        source: classifier.knownSource(row.questId),
      })),
  };
}

export function statsPayload(
  stats: Stats,
  config: PromotionConfig,
  now: number,
) {
  const pick = <K extends string>(
    keys: readonly K[],
    counts: Record<string, number>,
  ) =>
    Object.fromEntries(keys.map((key) => [key, counts[key] ?? 0])) as Record<
      K,
      number
    >;
  return {
    generatedAt: isoTime(now),
    meta: QUEST_DATA_META,
    thresholds: thresholds(config),
    candidates: pick<CandidateStatus>(CANDIDATE_STATUSES, stats.statuses),
    observedQuests: pick<QuestCategory>(QUEST_CATEGORIES, stats.categories),
    submissions: stats.submissions,
    reporters: stats.reporters,
    lastSubmissionAt:
      stats.lastSubmissionAt === null ? null : isoTime(stats.lastSubmissionAt),
  };
}

export interface CandidateView {
  id: number;
  category: QuestCategory;
  status: CandidateStatus | null;
  statusSource: string | null;
  statusReason: string | null;
  statusChangedAt: string | null;
  reporters: number;
  networks: number;
  firstReported: string;
  lastReported: string;
  summary: QuestSummary;
}

export function candidateView(
  row: QuestRow,
  classifier: Classifier,
): CandidateView {
  return {
    id: row.questId,
    category: classifier.category(row.questId),
    status: row.status,
    statusSource: row.statusSource,
    statusReason: row.statusReason,
    statusChangedAt:
      row.statusChangedAt === null ? null : isoTime(row.statusChangedAt),
    reporters: row.reporters,
    networks: row.networks,
    firstReported: isoTime(row.firstReported),
    lastReported: isoTime(row.lastReported),
    summary: row.summary,
  };
}

export function classicObservationsPayload(
  rows: readonly QuestRow[],
  classifier: Classifier,
  now: number,
) {
  return {
    generatedAt: isoTime(now),
    meta: QUEST_DATA_META,
    quests: rows
      .filter((row) => classifier.category(row.questId) === "classic")
      .map((row) => ({
        id: row.questId,
        reporters: row.reporters,
        level: row.summary.level,
        locales: row.summary.locales,
      })),
  };
}

export function auditView(entry: AuditRecord) {
  return { ...entry, at: isoTime(entry.at) };
}
