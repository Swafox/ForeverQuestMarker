/** Read-plan-commit loops for the write operations, retried on write conflicts. */
import type { Classifier } from "./classify";
import type { Config } from "./env";
import { diffObservations, planIngest, type IngestResult } from "./ingest";
import type { AuditEntry, QuestRow, SubmissionMeta } from "./model";
import { Repository, WriteConflictError } from "./repository";
import { planReview, type ReviewRequest } from "./review";
import type { ExportDocument } from "./validate";

export const MAX_WRITE_ATTEMPTS = 4;

/** Every attempt lost the race against concurrent writes. */
export class BusyError extends Error {
  constructor() {
    super("the database is busy; retry shortly");
    this.name = "BusyError";
  }
}

export class ReviewError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

export interface ServiceContext {
  repo: Repository;
  classifier: Classifier;
  config: Config;
  now: () => number;
  newId: () => string;
}

export async function ingestSubmission(
  context: ServiceContext,
  document: ExportDocument,
  ipHash: string,
  bodyBytes: number,
): Promise<IngestResult> {
  const { repo, classifier, config } = context;
  const meta: SubmissionMeta = {
    id: context.newId(),
    receivedAt: context.now(),
    clientId: document.clientId,
    ipHash,
    formatVersion: document.version,
    addonVersion: document.addonVersion,
    build: document.build,
    interface: document.interface,
    locale: document.locale,
    exportedAt: document.exportedAt,
    bodyBytes,
    questCount: document.quests.length,
  };
  const questIds = document.quests.map((quest) => quest.id);

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const { seq, previous } = await repo.readIngestBase(
      meta.clientId,
      questIds,
    );
    const changes = diffObservations(document.quests, previous, meta);
    const state = await repo.readQuestState(
      changes.rows.map((row) => row.questId),
      ipHash,
    );
    const plan = planIngest({
      meta,
      questIds,
      changes,
      previous,
      ...state,
      classifier,
      config: config.promotion,
    });
    try {
      await repo.commitIngest(seq, meta, plan);
      return plan.result;
    } catch (error) {
      if (!(error instanceof WriteConflictError)) throw error;
    }
  }
  throw new BusyError();
}

export async function reviewQuest(
  context: ServiceContext,
  request: ReviewRequest,
): Promise<{ quest: QuestRow; audit: AuditEntry[] }> {
  const category = context.classifier.category(request.id);
  if (category !== "candidate") {
    throw new ReviewError(
      409,
      `quest ${request.id} is ${category}, not a Forever candidate`,
    );
  }
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const { seq, quest } = await context.repo.readQuest(request.id);
    if (!quest)
      throw new ReviewError(
        404,
        `there are no reports for quest ${request.id}`,
      );
    const planned = planReview(
      { ...quest, category },
      request,
      context.now(),
      context.config.promotion,
    );
    try {
      await context.repo.commitReview(seq, planned.quest, planned.audit);
      return planned;
    } catch (error) {
      if (!(error instanceof WriteConflictError)) throw error;
    }
  }
  throw new BusyError();
}
