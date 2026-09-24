/**
 * Thin D1 access layer. Bulk writes pass rows as one JSON parameter and expand
 * them with json_each, so a submission needs a handful of statements however
 * many quests it carries. Every write batch first claims the next
 * write_sequence number; a concurrent writer that read the same number fails
 * with a UNIQUE conflict, which surfaces as WriteConflictError.
 */
import type { SqlDatabase, SqlStatement, SqlValue } from "./db";
import type { IngestPlan } from "./ingest";
import type {
  AuditEntry,
  AuditRecord,
  ObservationRow,
  QuestRow,
  SubmissionMeta,
} from "./model";
import type { CandidateStatus } from "./promotion";
import type { Vote, VoteDimension } from "./summary";

export class WriteConflictError extends Error {
  constructor() {
    super("another write committed first");
    this.name = "WriteConflictError";
  }
}

/** Keeps each JSON parameter well below D1's 2 MB limit for a single value. */
const CHUNK_BYTES = 1_000_000;

type Columns = readonly (readonly [column: string, key: string])[];
type DbRow = Record<string, unknown>;

const OBSERVATION_COLUMNS = [
  ["client_id", "clientId"],
  ["quest_id", "questId"],
  ["ip_hash", "ipHash"],
  ["submission_id", "submissionId"],
  ["locale", "locale"],
  ["title", "title"],
  ["state", "state"],
  ["level", "level"],
  ["giver_type", "giverType"],
  ["giver_id", "giverId"],
  ["giver_name", "giverName"],
  ["map", "map"],
  ["x", "x"],
  ["y", "y"],
  ["faction", "faction"],
  ["contexts", "contexts"],
  ["first_seen", "firstSeen"],
  ["last_seen", "lastSeen"],
  ["seen_count", "seenCount"],
  ["accepted", "accepted"],
  ["turned_in", "turnedIn"],
  ["created_at", "createdAt"],
  ["updated_at", "updatedAt"],
] as const satisfies Columns;

/** Columns a resubmission never changes. */
const OBSERVATION_IMMUTABLE = new Set([
  "client_id",
  "quest_id",
  "ip_hash",
  "created_at",
]);

const QUEST_COLUMNS = [
  ["quest_id", "questId"],
  ["category", "category"],
  ["status", "status"],
  ["status_source", "statusSource"],
  ["status_reason", "statusReason"],
  ["status_changed_at", "statusChangedAt"],
  ["reporters", "reporters"],
  ["networks", "networks"],
  ["summary", "summary"],
  ["first_reported", "firstReported"],
  ["last_reported", "lastReported"],
] as const satisfies Columns;

const AUDIT_COLUMNS = [
  ["at", "at"],
  ["quest_id", "questId"],
  ["actor", "actor"],
  ["from_status", "fromStatus"],
  ["to_status", "toStatus"],
  ["reason", "reason"],
  ["submission_id", "submissionId"],
] as const satisfies Columns;

const IN_IDS = "(SELECT j.value FROM json_each(?1) AS j)";

function extractList(columns: Columns): string {
  return columns
    .map(([, key]) => `json_extract(j.value, '$.${key}')`)
    .join(", ");
}

function columnList(columns: Columns): string {
  return columns.map(([column]) => column).join(", ");
}

function fromDb<T>(row: DbRow, columns: Columns): T {
  const result: Record<string, unknown> = {};
  for (const [column, key] of columns) result[key] = row[column] ?? null;
  return result as T;
}

export function utf8Length(text: string): number {
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Surrogate halves add 1 each (4 bytes per pair), other non-ASCII 1 or 2.
    if (code >= 0xd800 && code <= 0xdfff) bytes += 1;
    else if (code > 0x7ff) bytes += 2;
    else if (code > 0x7f) bytes += 1;
  }
  return bytes;
}

/** Splits rows into JSON array strings of at most CHUNK_BYTES (UTF-8) each, unless a single row is larger. */
export function jsonChunks(
  rows: readonly unknown[],
  maxBytes = CHUNK_BYTES,
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const row of rows) {
    const json = JSON.stringify(row);
    const bytes = utf8Length(json) + 1;
    if (current.length > 0 && size + bytes > maxBytes) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      size = 2;
    }
    current.push(json);
    size += bytes;
  }
  if (current.length > 0) chunks.push(`[${current.join(",")}]`);
  return chunks;
}

function questFromDb(row: DbRow): QuestRow {
  const quest = fromDb<QuestRow & { summary: unknown }>(row, QUEST_COLUMNS);
  return {
    ...quest,
    summary: JSON.parse(String(quest.summary)) as QuestRow["summary"],
  };
}

function isSequenceConflict(error: unknown): boolean {
  const messages: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  if (messages.length === 0) messages.push(String(error));
  return messages.some((message) =>
    /UNIQUE constraint failed: write_sequence\.seq/.test(message),
  );
}

export interface Stats {
  statuses: Record<string, number>;
  categories: Record<string, number>;
  submissions: number;
  reporters: number;
  lastSubmissionAt: number | null;
}

export class Repository {
  constructor(private readonly db: SqlDatabase) {}

  private statement(sql: string, ...values: SqlValue[]): SqlStatement {
    return this.db.prepare(sql).bind(...values);
  }

  private async batch(statements: SqlStatement[]): Promise<DbRow[][]> {
    return (await this.db.batch<DbRow>(statements)).map(
      (result) => result.results,
    );
  }

  private async commit(seq: number, statements: SqlStatement[]): Promise<void> {
    try {
      await this.batch([
        this.statement("INSERT INTO write_sequence (seq) VALUES (?1)", seq + 1),
        this.statement("DELETE FROM write_sequence WHERE seq < ?1", seq + 1),
        ...statements,
      ]);
    } catch (error) {
      if (isSequenceConflict(error)) throw new WriteConflictError();
      throw error;
    }
  }

  /** Counts one attempt in a rate limit bucket and returns this and the previous window's counts. */
  async countAttempt(
    bucket: string,
    windowStart: number,
    windowSeconds: number,
  ): Promise<{ current: number; previous: number }> {
    const [, current, previous] = await this.batch([
      this.statement(
        "DELETE FROM rate_limits WHERE window_start < ?1",
        windowStart - windowSeconds,
      ),
      this.statement(
        `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
         RETURNING count`,
        bucket,
        windowStart,
      ),
      this.statement(
        "SELECT count FROM rate_limits WHERE bucket = ?1 AND window_start = ?2",
        bucket,
        windowStart - windowSeconds,
      ),
    ]);
    return {
      current: Number(current?.[0]?.["count"] ?? 1),
      previous: Number(previous?.[0]?.["count"] ?? 0),
    };
  }

  /** The current write sequence and this installation's stored observations of the given quests. */
  async readIngestBase(
    clientId: string,
    questIds: readonly number[],
  ): Promise<{ seq: number; previous: Map<number, ObservationRow> }> {
    const [sequence, observations] = await this.batch([
      this.statement("SELECT COALESCE(MAX(seq), 0) AS seq FROM write_sequence"),
      this.statement(
        `SELECT ${columnList(OBSERVATION_COLUMNS)} FROM observations
         WHERE client_id = ?2 AND quest_id IN ${IN_IDS}`,
        JSON.stringify(questIds),
        clientId,
      ),
    ]);
    const previous = new Map<number, ObservationRow>();
    for (const row of observations ?? []) {
      const observation = fromDb<ObservationRow>(row, OBSERVATION_COLUMNS);
      previous.set(observation.questId, observation);
    }
    return { seq: Number(sequence?.[0]?.["seq"] ?? 0), previous };
  }

  /** Stored aggregates, vote counters and per-network reporter counts of the given quests. */
  async readQuestState(
    questIds: readonly number[],
    ipHash: string,
  ): Promise<{
    quests: Map<number, QuestRow>;
    votes: Map<number, Vote[]>;
    networkReporters: Map<number, number>;
  }> {
    const state = {
      quests: new Map<number, QuestRow>(),
      votes: new Map<number, Vote[]>(),
      networkReporters: new Map<number, number>(),
    };
    if (questIds.length === 0) return state;
    const ids = JSON.stringify(questIds);
    const [quests, votes, networks] = await this.batch([
      this.statement(
        `SELECT ${columnList(QUEST_COLUMNS)} FROM quests WHERE quest_id IN ${IN_IDS}`,
        ids,
      ),
      this.statement(
        `SELECT quest_id, dimension, locale, value, count FROM quest_votes WHERE quest_id IN ${IN_IDS}`,
        ids,
      ),
      this.statement(
        `SELECT quest_id, reporters FROM quest_networks WHERE ip_hash = ?2 AND quest_id IN ${IN_IDS}`,
        ids,
        ipHash,
      ),
    ]);
    for (const row of quests ?? []) {
      const quest = questFromDb(row);
      state.quests.set(quest.questId, quest);
    }
    for (const row of votes ?? []) {
      const questId = Number(row["quest_id"]);
      const list = state.votes.get(questId) ?? [];
      list.push({
        dimension: String(row["dimension"]) as VoteDimension,
        locale: String(row["locale"]),
        value: String(row["value"]),
        count: Number(row["count"]),
      });
      state.votes.set(questId, list);
    }
    for (const row of networks ?? []) {
      state.networkReporters.set(
        Number(row["quest_id"]),
        Number(row["reporters"]),
      );
    }
    return state;
  }

  private upsertQuests(quests: readonly QuestRow[]): SqlStatement[] {
    const updates = QUEST_COLUMNS.filter(([column]) => column !== "quest_id")
      .map(([column]) => `${column} = excluded.${column}`)
      .join(", ");
    return jsonChunks(
      quests.map((quest) => ({
        ...quest,
        summary: JSON.stringify(quest.summary),
      })),
    ).map((chunk) =>
      this.statement(
        `INSERT INTO quests (${columnList(QUEST_COLUMNS)})
           SELECT ${extractList(QUEST_COLUMNS)} FROM json_each(?1) AS j WHERE true
           ON CONFLICT (quest_id) DO UPDATE SET ${updates}`,
        chunk,
      ),
    );
  }

  private insertAudit(entries: readonly AuditEntry[]): SqlStatement[] {
    return jsonChunks(entries).map((chunk) =>
      this.statement(
        `INSERT INTO audit_log (${columnList(AUDIT_COLUMNS)})
         SELECT ${extractList(AUDIT_COLUMNS)} FROM json_each(?1) AS j ORDER BY j.key`,
        chunk,
      ),
    );
  }

  /** Writes a planned submission atomically. Throws WriteConflictError if another write came first. */
  async commitIngest(
    seq: number,
    meta: SubmissionMeta,
    plan: IngestPlan,
  ): Promise<void> {
    const observationUpdates = OBSERVATION_COLUMNS.filter(
      ([column]) => !OBSERVATION_IMMUTABLE.has(column),
    )
      .map(([column]) => `${column} = excluded.${column}`)
      .join(", ");
    const decremented = [
      ...new Set(
        plan.voteDeltas
          .filter((delta) => delta.count < 0)
          .map((delta) => delta.questId),
      ),
    ];

    await this.commit(seq, [
      this.statement(
        `INSERT INTO submissions (id, received_at, client_id, ip_hash, format_version, addon_version,
           build, interface, locale, exported_at, body_bytes, quest_count, inserted_count, updated_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        meta.id,
        meta.receivedAt,
        meta.clientId,
        meta.ipHash,
        meta.formatVersion,
        meta.addonVersion,
        meta.build,
        meta.interface,
        meta.locale,
        meta.exportedAt,
        meta.bodyBytes,
        meta.questCount,
        plan.result.inserted,
        plan.result.updated,
      ),
      ...jsonChunks(plan.observations).map((chunk) =>
        this.statement(
          `INSERT INTO observations (${columnList(OBSERVATION_COLUMNS)})
           SELECT ${extractList(OBSERVATION_COLUMNS)} FROM json_each(?1) AS j WHERE true
           ON CONFLICT (client_id, quest_id) DO UPDATE SET ${observationUpdates}`,
          chunk,
        ),
      ),
      ...jsonChunks(plan.voteDeltas).map((chunk) =>
        this.statement(
          `INSERT INTO quest_votes (quest_id, dimension, locale, value, count)
           SELECT json_extract(j.value, '$.questId'), json_extract(j.value, '$.dimension'),
             json_extract(j.value, '$.locale'), json_extract(j.value, '$.value'),
             json_extract(j.value, '$.count')
           FROM json_each(?1) AS j WHERE true
           ON CONFLICT (quest_id, dimension, locale, value) DO UPDATE SET count = count + excluded.count`,
          chunk,
        ),
      ),
      ...(decremented.length > 0
        ? [
            this.statement(
              `DELETE FROM quest_votes WHERE count <= 0 AND quest_id IN ${IN_IDS}`,
              JSON.stringify(decremented),
            ),
          ]
        : []),
      ...jsonChunks(plan.networkDeltas).map((chunk) =>
        this.statement(
          `INSERT INTO quest_networks (quest_id, ip_hash, reporters)
           SELECT json_extract(j.value, '$.questId'), json_extract(j.value, '$.ipHash'),
             json_extract(j.value, '$.delta')
           FROM json_each(?1) AS j WHERE true
           ON CONFLICT (quest_id, ip_hash) DO UPDATE SET reporters = reporters + excluded.reporters`,
          chunk,
        ),
      ),
      ...this.upsertQuests(plan.quests),
      ...this.insertAudit(plan.audit),
    ]);
  }

  async readQuest(
    questId: number,
  ): Promise<{ seq: number; quest: QuestRow | null }> {
    const [sequence, quests] = await this.batch([
      this.statement("SELECT COALESCE(MAX(seq), 0) AS seq FROM write_sequence"),
      this.statement(
        `SELECT ${columnList(QUEST_COLUMNS)} FROM quests WHERE quest_id = ?1`,
        questId,
      ),
    ]);
    const row = quests?.[0];
    return {
      seq: Number(sequence?.[0]?.["seq"] ?? 0),
      quest: row ? questFromDb(row) : null,
    };
  }

  /** Writes a reviewed quest and its audit entries. Throws WriteConflictError if another write came first. */
  async commitReview(
    seq: number,
    quest: QuestRow,
    audit: readonly AuditEntry[],
  ): Promise<void> {
    await this.commit(seq, [
      ...this.upsertQuests([quest]),
      ...this.insertAudit(audit),
    ]);
  }

  async questsByStatus(
    status: CandidateStatus,
    limit: number,
  ): Promise<QuestRow[]> {
    const { results } = await this.statement(
      `SELECT ${columnList(QUEST_COLUMNS)} FROM quests WHERE status = ?1
       ORDER BY reporters DESC, quest_id LIMIT ?2`,
      status,
      limit,
    ).all<DbRow>();
    return results.map(questFromDb);
  }

  async questsByIds(questIds: readonly number[]): Promise<QuestRow[]> {
    if (questIds.length === 0) return [];
    const { results } = await this.statement(
      `SELECT ${columnList(QUEST_COLUMNS)} FROM quests WHERE quest_id IN ${IN_IDS} ORDER BY quest_id`,
      JSON.stringify(questIds),
    ).all<DbRow>();
    return results.map(questFromDb);
  }

  async stats(): Promise<Stats> {
    const [statuses, categories, submissions] = await this.batch([
      this.statement(
        "SELECT status AS key, COUNT(*) AS n FROM quests WHERE status IS NOT NULL GROUP BY status",
      ),
      this.statement(
        "SELECT category AS key, COUNT(*) AS n FROM quests GROUP BY category",
      ),
      this.statement(
        `SELECT COUNT(*) AS submissions, COUNT(DISTINCT client_id) AS reporters,
           MAX(received_at) AS last FROM submissions`,
      ),
    ]);
    const counts = (rows: DbRow[] | undefined) =>
      Object.fromEntries(
        (rows ?? []).map((row) => [String(row["key"]), Number(row["n"])]),
      );
    const totals = submissions?.[0] ?? {};
    return {
      statuses: counts(statuses),
      categories: counts(categories),
      submissions: Number(totals["submissions"] ?? 0),
      reporters: Number(totals["reporters"] ?? 0),
      lastSubmissionAt:
        totals["last"] === null || totals["last"] === undefined
          ? null
          : Number(totals["last"]),
    };
  }

  /** Newest audit entries first, optionally for one quest. */
  async auditLog(
    questId: number | null,
    limit: number,
  ): Promise<AuditRecord[]> {
    const where = questId === null ? "" : "WHERE quest_id = ?2";
    const values: SqlValue[] = questId === null ? [limit] : [limit, questId];
    const { results } = await this.statement(
      `SELECT id, ${columnList(AUDIT_COLUMNS)} FROM audit_log ${where} ORDER BY id DESC LIMIT ?1`,
      ...values,
    ).all<DbRow>();
    return results.map((row) => ({
      id: Number(row["id"]),
      ...fromDb<AuditEntry>(row, AUDIT_COLUMNS),
    }));
  }
}
