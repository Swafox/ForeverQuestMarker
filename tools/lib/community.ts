/**
 * Reading, merging and writing dataset/community/*.json. Serialization is
 * deterministic so an unchanged merge rewrites nothing.
 */
import type { ConfirmedQuest } from "./workerApi";

export interface CommunityEntry {
  id: number;
  title?: string;
  note?: string;
  source?: string;
}

export interface CommunityFile {
  description: string;
  quests: CommunityEntry[];
}

export interface KnownQuestSets {
  classic: ReadonlySet<number>;
  datamined: ReadonlySet<number>;
  sod: ReadonlySet<number>;
  era: ReadonlySet<number>;
}

export interface SkippedQuest {
  id: number;
  reason: string;
}

export interface MergeResult {
  file: CommunityFile;
  added: CommunityEntry[];
  /** Confirmed IDs that were already listed in the file. */
  alreadyListed: number[];
  /** Confirmed IDs the local data already classifies as not new or known. */
  skipped: SkippedQuest[];
}

export const PIPELINE_SOURCE = "pipeline";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCommunityFile(text: string, label: string): CommunityFile {
  const data: unknown = JSON.parse(text);
  if (
    !isObject(data) ||
    typeof data["description"] !== "string" ||
    !Array.isArray(data["quests"])
  ) {
    throw new Error(
      `${label}: expected { "description": string, "quests": [...] }`,
    );
  }
  const quests = data["quests"].map((entry: unknown, index): CommunityEntry => {
    if (
      !isObject(entry) ||
      !Number.isInteger(entry["id"]) ||
      (entry["id"] as number) <= 0
    ) {
      throw new Error(
        `${label}: quests[${index}] needs a positive integer "id"`,
      );
    }
    for (const key of ["title", "note", "source"]) {
      if (entry[key] !== undefined && typeof entry[key] !== "string") {
        throw new Error(`${label}: quests[${index}].${key} must be a string`);
      }
    }
    return entry as unknown as CommunityEntry;
  });
  return { description: data["description"], quests };
}

/** Pretty-printed JSON with a fixed key order per entry and a trailing newline. */
export function serializeCommunityFile(file: CommunityFile): string {
  const quests = file.quests.map((entry) => {
    const ordered: Record<string, unknown> = { id: entry.id };
    for (const key of ["title", "note", "source"] as const) {
      if (entry[key] !== undefined) ordered[key] = entry[key];
    }
    for (const [key, value] of Object.entries(entry)) {
      if (!(key in ordered)) ordered[key] = value;
    }
    return ordered;
  });
  return `${JSON.stringify({ description: file.description, quests }, null, 2)}\n`;
}

function notNewReason(id: number, sets: KnownQuestSets): string | null {
  if (sets.classic.has(id)) return "original Classic quest";
  if (sets.datamined.has(id)) return "already in the datamined Forever list";
  if (sets.sod.has(id)) return "Season of Discovery quest";
  if (sets.era.has(id)) return "present in the Classic Era client";
  return null;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Adds confirmed quests that the local data does not already cover. Existing
 * entries are never modified; when anything is added the list is sorted by ID.
 */
export function mergeConfirmed(
  file: CommunityFile,
  confirmed: readonly ConfirmedQuest[],
  sets: KnownQuestSets,
): MergeResult {
  const listed = new Set(file.quests.map((entry) => entry.id));
  const unique = new Map(confirmed.map((quest) => [quest.id, quest]));
  const result: MergeResult = {
    file,
    added: [],
    alreadyListed: [],
    skipped: [],
  };

  for (const quest of [...unique.values()].sort((a, b) => a.id - b.id)) {
    if (listed.has(quest.id)) {
      result.alreadyListed.push(quest.id);
      continue;
    }
    const reason = notNewReason(quest.id, sets);
    if (reason) {
      result.skipped.push({ id: quest.id, reason });
      continue;
    }
    const entry: CommunityEntry = { id: quest.id };
    if (quest.title !== null) entry.title = quest.title;
    entry.note =
      `${quest.reporters} independent reports, first ${day(quest.firstReported)}` +
      (quest.confirmedBy === "admin" ? ", confirmed by a reviewer" : "");
    entry.source = PIPELINE_SOURCE;
    result.added.push(entry);
  }

  if (result.added.length > 0) {
    result.file = {
      description: file.description,
      quests: [...file.quests, ...result.added].sort((a, b) => a.id - b.id),
    };
  }
  return result;
}
