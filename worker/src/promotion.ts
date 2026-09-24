/** Automatic status decisions for Forever quest candidates. */

export type CandidateStatus = "pending" | "confirmed" | "flagged" | "rejected";
export type StatusSource = "auto" | "admin";

export const CANDIDATE_STATUSES: readonly CandidateStatus[] = [
  "pending",
  "confirmed",
  "flagged",
  "rejected",
];

export interface PromotionConfig {
  /** Distinct client IDs required before a candidate is decided. */
  minClients: number;
  /** Distinct hashed networks required before a candidate is decided. */
  minNetworks: number;
}

/** IDs at or below this are in the range of cut or unused vanilla quests. */
export const LOW_ID_LIMIT = 10000;
/** IDs above this are far beyond anything the Forever client has shipped. */
export const HIGH_ID_LIMIT = 200000;

export interface CandidateState {
  id: number;
  status: CandidateStatus;
  source: StatusSource | null;
  reporters: number;
  networks: number;
  /** Locales whose reports do not reach two-thirds agreement on the title. */
  conflictingLocales: readonly string[];
}

export interface StatusDecision {
  status: CandidateStatus;
  reason: string;
}

export function idRangeIssue(id: number): string | null {
  if (id <= LOW_ID_LIMIT)
    return `quest ID ${id} is in the cut or unused vanilla range (<= ${LOW_ID_LIMIT})`;
  if (id > HIGH_ID_LIMIT) return `quest ID ${id} is above ${HIGH_ID_LIMIT}`;
  return null;
}

export function meetsThresholds(
  state: CandidateState,
  config: PromotionConfig,
): boolean {
  return (
    state.reporters >= config.minClients && state.networks >= config.minNetworks
  );
}

/**
 * The status change automatic evaluation makes, or null for none.
 *
 * A pending candidate is decided once enough independent installations and
 * networks reported it: confirmed when every locale agrees on the title and the
 * ID is in the plausible range, flagged for manual review otherwise. An
 * automatically confirmed candidate is flagged again if its title consensus is
 * later lost. Flagged, rejected and admin-confirmed candidates only change by
 * manual review.
 */
export function decideStatus(
  state: CandidateState,
  config: PromotionConfig,
): StatusDecision | null {
  const conflicts =
    state.conflictingLocales.length > 0
      ? `conflicting titles in ${state.conflictingLocales.join(", ")}`
      : null;

  if (state.status === "confirmed") {
    if (state.source === "auto" && conflicts) {
      return {
        status: "flagged",
        reason: `title consensus lost: ${conflicts}`,
      };
    }
    return null;
  }
  if (state.status !== "pending" || !meetsThresholds(state, config))
    return null;

  const issues = [idRangeIssue(state.id), conflicts].filter(
    (issue): issue is string => issue !== null,
  );
  if (issues.length > 0)
    return { status: "flagged", reason: issues.join("; ") };
  return {
    status: "confirmed",
    reason: `${state.reporters} installations on ${state.networks} networks agree on the title`,
  };
}
