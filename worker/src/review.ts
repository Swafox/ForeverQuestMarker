/** Manual review of candidates through POST /api/admin/review. */
import type { AuditEntry, QuestRow } from "./model";
import { decideStatus, type PromotionConfig } from "./promotion";
import { conflictingLocales } from "./summary";
import type { ValidationError } from "./validate";

export const REVIEW_STATUSES = ["confirmed", "rejected", "pending"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ReviewRequest {
  id: number;
  status: ReviewStatus;
  note: string;
  reviewer: string;
}

export const MAX_NOTE_LENGTH = 500;
const REVIEWER = /^[A-Za-z0-9_.@-]{1,64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export function parseReviewRequest(
  value: unknown,
):
  | { ok: true; request: ReviewRequest }
  | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      errors: [{ path: "", message: "must be a JSON object" }],
    };
  }
  const fields = value as Record<string, unknown>;
  const { id, status, note } = fields;
  const reviewer = fields["reviewer"] ?? "admin";
  if (
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    id < 1 ||
    id > 1_000_000
  ) {
    errors.push({
      path: "id",
      message: "must be a quest ID between 1 and 1000000",
    });
  }
  if (
    typeof status !== "string" ||
    !(REVIEW_STATUSES as readonly string[]).includes(status)
  ) {
    errors.push({
      path: "status",
      message: `must be one of ${REVIEW_STATUSES.join(", ")}`,
    });
  }
  if (
    typeof note !== "string" ||
    note.trim().length === 0 ||
    note.length > MAX_NOTE_LENGTH ||
    CONTROL_CHARACTERS.test(note)
  ) {
    errors.push({
      path: "note",
      message: `must be a non-empty single-line string of at most ${MAX_NOTE_LENGTH} characters`,
    });
  }
  if (typeof reviewer !== "string" || !REVIEWER.test(reviewer)) {
    errors.push({
      path: "reviewer",
      message: "must match [A-Za-z0-9_.@-]{1,64}",
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    request: {
      id: id as number,
      status: status as ReviewStatus,
      note: (note as string).trim(),
      reviewer: reviewer as string,
    },
  };
}

/**
 * Applies a review decision. Setting a candidate back to pending hands it to
 * automatic evaluation again, which runs immediately.
 */
export function planReview(
  current: QuestRow,
  request: ReviewRequest,
  now: number,
  config: PromotionConfig,
): { quest: QuestRow; audit: AuditEntry[] } {
  const quest: QuestRow = {
    ...current,
    status: request.status,
    statusSource: "admin",
    statusReason: request.note,
    statusChangedAt: now,
  };
  const audit: AuditEntry[] = [
    {
      at: now,
      questId: quest.questId,
      actor: `admin:${request.reviewer}`,
      fromStatus: current.status,
      toStatus: request.status,
      reason: request.note,
      submissionId: null,
    },
  ];
  if (request.status === "pending") {
    const decision = decideStatus(
      {
        id: quest.questId,
        status: "pending",
        source: "admin",
        reporters: quest.reporters,
        networks: quest.networks,
        conflictingLocales: conflictingLocales(quest.summary),
      },
      config,
    );
    if (decision) {
      audit.push({
        at: now,
        questId: quest.questId,
        actor: "auto",
        fromStatus: "pending",
        toStatus: decision.status,
        reason: decision.reason,
        submissionId: null,
      });
      quest.status = decision.status;
      quest.statusSource = "auto";
      quest.statusReason = decision.reason;
    }
  }
  return { quest, audit };
}
