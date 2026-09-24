import type { QuestCategory } from "./classify";
import type { CandidateStatus, StatusSource } from "./promotion";
import type { QuestSummary, Vote } from "./summary";

export interface SubmissionMeta {
  id: string;
  receivedAt: number;
  clientId: string;
  ipHash: string;
  formatVersion: number;
  addonVersion: string;
  build: string;
  interface: number;
  locale: string;
  exportedAt: number;
  bodyBytes: number;
  questCount: number;
}

/** Latest observation of one quest by one installation (table observations). */
export interface ObservationRow {
  clientId: string;
  questId: number;
  /** Network of the installation's first report of this quest; never updated. */
  ipHash: string;
  submissionId: string;
  locale: string;
  title: string;
  state: string;
  level: number | null;
  giverType: string | null;
  giverId: number | null;
  giverName: string | null;
  map: number | null;
  x: number | null;
  y: number | null;
  faction: string | null;
  contexts: string;
  firstSeen: number;
  lastSeen: number;
  seenCount: number;
  accepted: number | null;
  turnedIn: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Aggregate and candidate state of one quest (table quests). */
export interface QuestRow {
  questId: number;
  category: QuestCategory;
  status: CandidateStatus | null;
  statusSource: StatusSource | null;
  statusReason: string | null;
  statusChangedAt: number | null;
  reporters: number;
  networks: number;
  summary: QuestSummary;
  firstReported: number;
  lastReported: number;
}

/** Change to one vote counter; count is the (possibly negative) delta. */
export interface VoteDelta extends Vote {
  questId: number;
}

export interface NetworkDelta {
  questId: number;
  ipHash: string;
  delta: number;
}

export interface AuditEntry {
  at: number;
  questId: number;
  /** "auto" or "admin:<reviewer>". */
  actor: string;
  fromStatus: CandidateStatus | null;
  toStatus: CandidateStatus | null;
  reason: string;
  submissionId: string | null;
}

export interface AuditRecord extends AuditEntry {
  id: number;
}
