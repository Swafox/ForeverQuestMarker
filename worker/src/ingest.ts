/**
 * Pure planning of one submission: which observations change, how the vote
 * counters move, and the resulting quest aggregates and status changes. The
 * repository reads the inputs and writes the plan in one transaction.
 */
import type { Classifier, QuestCategory } from "./classify";
import type {
  AuditEntry,
  NetworkDelta,
  ObservationRow,
  QuestRow,
  SubmissionMeta,
  VoteDelta,
} from "./model";
import {
  decideStatus,
  type CandidateStatus,
  type PromotionConfig,
} from "./promotion";
import {
  conflictingLocales,
  giverVoteValue,
  summarize,
  type Vote,
} from "./summary";
import type { QuestRecord } from "./validate";

export interface ObservationChanges {
  /** New and changed rows, in submission order. */
  rows: ObservationRow[];
  inserted: Set<number>;
  updated: Set<number>;
  unchanged: number;
}

export interface IngestInput {
  meta: SubmissionMeta;
  questIds: readonly number[];
  changes: ObservationChanges;
  /** This installation's stored observations of the submitted quests. */
  previous: ReadonlyMap<number, ObservationRow>;
  /** Stored aggregates of the changed quests. */
  quests: ReadonlyMap<number, QuestRow>;
  /** Stored vote counters of the changed quests. */
  votes: ReadonlyMap<number, readonly Vote[]>;
  /** Stored reporter count of (quest, meta.ipHash) for the changed quests. */
  networkReporters: ReadonlyMap<number, number>;
  classifier: Classifier;
  config: PromotionConfig;
}

export interface IngestResult {
  submissionId: string;
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  categories: Record<QuestCategory, number>;
  confirmed: number[];
  flagged: number[];
}

export interface IngestPlan {
  observations: ObservationRow[];
  voteDeltas: VoteDelta[];
  networkDeltas: NetworkDelta[];
  quests: QuestRow[];
  audit: AuditEntry[];
  result: IngestResult;
}

const COMPARED_FIELDS = [
  "locale",
  "title",
  "state",
  "level",
  "giverType",
  "giverId",
  "giverName",
  "map",
  "x",
  "y",
  "faction",
  "contexts",
  "firstSeen",
  "lastSeen",
  "seenCount",
  "accepted",
  "turnedIn",
] as const satisfies readonly (keyof ObservationRow)[];

const flag = (value: boolean | null) => (value === null ? null : value ? 1 : 0);

export function toObservation(
  record: QuestRecord,
  meta: SubmissionMeta,
  previous: ObservationRow | undefined,
): ObservationRow {
  return {
    clientId: meta.clientId,
    questId: record.id,
    ipHash: previous?.ipHash ?? meta.ipHash,
    submissionId: meta.id,
    locale: meta.locale,
    title: record.title,
    state: record.state,
    level: record.level,
    giverType: record.giver?.type ?? null,
    giverId: record.giver?.id ?? null,
    giverName: record.giver?.name ?? null,
    map: record.map,
    x: record.x,
    y: record.y,
    faction: record.faction,
    contexts: [...record.contexts].sort().join(","),
    firstSeen: record.firstSeen,
    lastSeen: record.lastSeen,
    seenCount: record.seenCount,
    accepted: flag(record.accepted),
    turnedIn: flag(record.turnedIn),
    createdAt: previous?.createdAt ?? meta.receivedAt,
    updatedAt: meta.receivedAt,
  };
}

export function observationChanged(
  before: ObservationRow,
  after: ObservationRow,
): boolean {
  return COMPARED_FIELDS.some((field) => before[field] !== after[field]);
}

/** The votes one observation contributes, each with count 1. */
export function observationVotes(row: ObservationRow): Vote[] {
  const votes: Vote[] = [
    { dimension: "title", locale: row.locale, value: row.title, count: 1 },
  ];
  if (row.level !== null) {
    votes.push({
      dimension: "level",
      locale: row.locale,
      value: String(row.level),
      count: 1,
    });
  }
  const giver =
    row.giverType === null
      ? null
      : giverVoteValue({
          type: row.giverType as NonNullable<QuestRecord["giver"]>["type"],
          id: row.giverId,
          name: row.giverName,
        });
  if (giver !== null)
    votes.push({
      dimension: "giver",
      locale: row.locale,
      value: giver,
      count: 1,
    });
  if (row.map !== null)
    votes.push({
      dimension: "map",
      locale: "",
      value: String(row.map),
      count: 1,
    });
  return votes;
}

export function diffObservations(
  records: readonly QuestRecord[],
  previous: ReadonlyMap<number, ObservationRow>,
  meta: SubmissionMeta,
): ObservationChanges {
  const changes: ObservationChanges = {
    rows: [],
    inserted: new Set(),
    updated: new Set(),
    unchanged: 0,
  };
  for (const record of records) {
    const before = previous.get(record.id);
    const after = toObservation(record, meta, before);
    if (!before) {
      changes.inserted.add(record.id);
      changes.rows.push(after);
    } else if (observationChanged(before, after)) {
      changes.updated.add(record.id);
      changes.rows.push(after);
    } else {
      changes.unchanged++;
    }
  }
  return changes;
}

const voteKey = (vote: Vote) =>
  `${vote.dimension}\u0000${vote.locale}\u0000${vote.value}`;

/** Net vote counter changes per quest, without zero entries. */
function voteDeltasByQuest(input: IngestInput): Map<number, Map<string, Vote>> {
  const byQuest = new Map<number, Map<string, Vote>>();
  const add = (questId: number, votes: Vote[], sign: number) => {
    const deltas = byQuest.get(questId) ?? new Map<string, Vote>();
    byQuest.set(questId, deltas);
    for (const vote of votes) {
      const key = voteKey(vote);
      const current = deltas.get(key);
      deltas.set(key, {
        ...vote,
        count: (current?.count ?? 0) + sign * vote.count,
      });
    }
  };
  for (const row of input.changes.rows) {
    const before = input.previous.get(row.questId);
    if (before) add(row.questId, observationVotes(before), -1);
    add(row.questId, observationVotes(row), 1);
  }
  for (const deltas of byQuest.values()) {
    for (const [key, vote] of deltas) if (vote.count === 0) deltas.delete(key);
  }
  return byQuest;
}

function applyDeltas(
  current: readonly Vote[],
  deltas: ReadonlyMap<string, Vote>,
): Vote[] {
  const merged = new Map<string, Vote>();
  for (const vote of current) merged.set(voteKey(vote), { ...vote });
  for (const [key, delta] of deltas) {
    const vote = merged.get(key);
    merged.set(key, { ...delta, count: (vote?.count ?? 0) + delta.count });
  }
  return [...merged.values()].filter((vote) => vote.count > 0);
}

export function planIngest(input: IngestInput): IngestPlan {
  const { meta, changes, classifier, config } = input;
  const now = meta.receivedAt;
  const deltasByQuest = voteDeltasByQuest(input);
  const voteDeltas: VoteDelta[] = [];
  const networkDeltas: NetworkDelta[] = [];
  const quests: QuestRow[] = [];
  const audit: AuditEntry[] = [];
  const confirmed: number[] = [];
  const flagged: number[] = [];

  for (const row of changes.rows) {
    const id = row.questId;
    const inserted = changes.inserted.has(id);
    const deltas = deltasByQuest.get(id) ?? new Map<string, Vote>();
    for (const delta of deltas.values())
      voteDeltas.push({ questId: id, ...delta });
    if (inserted)
      networkDeltas.push({ questId: id, ipHash: row.ipHash, delta: 1 });

    const existing = input.quests.get(id);
    const category = classifier.category(id);
    const summary = summarize(applyDeltas(input.votes.get(id) ?? [], deltas));
    const quest: QuestRow = {
      questId: id,
      category,
      status: existing?.status ?? null,
      statusSource: existing?.statusSource ?? null,
      statusReason: existing?.statusReason ?? null,
      statusChangedAt: existing?.statusChangedAt ?? null,
      reporters: (existing?.reporters ?? 0) + (inserted ? 1 : 0),
      networks:
        (existing?.networks ?? 0) +
        (inserted && (input.networkReporters.get(id) ?? 0) === 0 ? 1 : 0),
      summary,
      firstReported: existing?.firstReported ?? now,
      lastReported: now,
    };

    const transition = (status: CandidateStatus | null, reason: string) => {
      audit.push({
        at: now,
        questId: id,
        actor: "auto",
        fromStatus: quest.status,
        toStatus: status,
        reason,
        submissionId: meta.id,
      });
      quest.status = status;
      quest.statusSource = status === null ? null : "auto";
      quest.statusReason = reason;
      quest.statusChangedAt = now;
    };

    if (category === "candidate") {
      if (quest.status === null)
        transition(
          "pending",
          existing ? "reclassified as a candidate" : "first report",
        );
      const decision = decideStatus(
        {
          id,
          status: quest.status!,
          source: quest.statusSource,
          reporters: quest.reporters,
          networks: quest.networks,
          conflictingLocales: conflictingLocales(summary),
        },
        config,
      );
      if (decision) {
        transition(decision.status, decision.reason);
        if (decision.status === "confirmed") confirmed.push(id);
        if (decision.status === "flagged") flagged.push(id);
      }
    } else if (quest.status !== null) {
      transition(null, `reclassified as ${category}`);
    }
    quests.push(quest);
  }

  const categories: Record<QuestCategory, number> = {
    candidate: 0,
    known: 0,
    classic: 0,
    sod: 0,
    era: 0,
  };
  for (const id of input.questIds) categories[classifier.category(id)]++;

  return {
    observations: changes.rows,
    voteDeltas,
    networkDeltas,
    quests,
    audit,
    result: {
      submissionId: meta.id,
      received: input.questIds.length,
      inserted: changes.inserted.size,
      updated: changes.updated.size,
      unchanged: changes.unchanged,
      categories,
      confirmed,
      flagged,
    },
  };
}
