/**
 * Strict validation of the addon export (docs/EXPORT_FORMAT.md). A document
 * with any error is rejected as a whole; unknown extra fields are ignored and
 * never stored.
 */

export const EXPORT_FORMAT = "ForeverQuestMarker";
export const SUPPORTED_VERSIONS: readonly number[] = [1];
export const MAX_QUESTS = 5000;
export const MAX_TEXT_LENGTH = 200;
export const MAX_ERRORS = 100;
/** 2026-01-01T00:00:00Z; nothing can have been observed in WoW Forever earlier. */
export const EARLIEST_TIMESTAMP = 1767225600;
/** Tolerated client clock drift into the future. */
export const MAX_CLOCK_SKEW = 86400;

export const QUEST_STATES = [
  "classic",
  "confirmed",
  "inferred",
  "changed",
  "sod",
  "era",
] as const;
export const QUEST_CONTEXTS = [
  "detail",
  "progress",
  "complete",
  "gossip",
  "greeting",
  "log",
  "tracker",
  "accepted",
  "turnedIn",
] as const;
export const GIVER_TYPES = ["npc", "object", "item", "unknown"] as const;
export const FACTIONS = ["Alliance", "Horde", "Neutral"] as const;
/** GetLocale() values of WoW Classic clients (enGB clients report enUS). */
export const LOCALES = [
  "enUS",
  "enGB",
  "deDE",
  "esES",
  "esMX",
  "frFR",
  "itIT",
  "koKR",
  "ptBR",
  "ruRU",
  "zhCN",
  "zhTW",
] as const;

export type QuestState = (typeof QUEST_STATES)[number];
export type QuestContext = (typeof QUEST_CONTEXTS)[number];
export type GiverType = (typeof GIVER_TYPES)[number];
export type Faction = (typeof FACTIONS)[number];
export type Locale = (typeof LOCALES)[number];

export interface GiverRecord {
  type: GiverType;
  id: number | null;
  name: string | null;
}

export interface QuestRecord {
  id: number;
  title: string;
  state: QuestState;
  level: number | null;
  giver: GiverRecord | null;
  map: number | null;
  x: number | null;
  y: number | null;
  faction: Faction | null;
  contexts: QuestContext[];
  firstSeen: number;
  lastSeen: number;
  seenCount: number;
  accepted: boolean | null;
  turnedIn: boolean | null;
}

export interface ExportDocument {
  format: typeof EXPORT_FORMAT;
  version: number;
  addonVersion: string;
  clientId: string;
  build: string;
  interface: number;
  locale: Locale;
  exportedAt: number;
  count: number;
  quests: QuestRecord[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; document: ExportDocument }
  | { ok: false; errors: ValidationError[]; truncated: boolean };

const CLIENT_ID = /^[0-9a-f]{16}$/;
const BUILD = /^\d+\.\d+\.\d+\.\d+$/;
const ADDON_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
/** Zero-width, bidirectional override and other invisible formatting characters. */
const FORMAT_CHARACTERS =
  /[\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

class Collector {
  readonly errors: ValidationError[] = [];
  truncated = false;

  add(path: string, message: string): void {
    if (this.errors.length < MAX_ERRORS) this.errors.push({ path, message });
    else this.truncated = true;
  }

  get full(): boolean {
    return this.errors.length >= MAX_ERRORS;
  }
}

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "string" ? "a string" : `${typeof value}`;
}

/** Optional fields may be absent or null; both mean "not provided". */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function integer(
  c: Collector,
  fields: Fields,
  key: string,
  path: string,
  min: number,
  max: number,
  required: boolean,
): number | null {
  const value = fields[key];
  if (isAbsent(value)) {
    if (required) c.add(`${path}${key}`, "is required");
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    c.add(`${path}${key}`, `must be an integer, got ${describe(value)}`);
    return null;
  }
  if (value < min || value > max) {
    c.add(`${path}${key}`, `must be between ${min} and ${max}, got ${value}`);
    return null;
  }
  return value;
}

function oneOf<T extends string>(
  c: Collector,
  fields: Fields,
  key: string,
  path: string,
  allowed: readonly T[],
  required: boolean,
): T | null {
  const value = fields[key];
  if (isAbsent(value)) {
    if (required) c.add(`${path}${key}`, "is required");
    return null;
  }
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    c.add(`${path}${key}`, `must be one of ${allowed.join(", ")}`);
    return null;
  }
  return value as T;
}

function patterned(
  c: Collector,
  fields: Fields,
  key: string,
  path: string,
  pattern: RegExp,
  description: string,
): string | null {
  const value = fields[key];
  if (typeof value !== "string" || !pattern.test(value)) {
    c.add(`${path}${key}`, `must be ${description}`);
    return null;
  }
  return value;
}

/** In-game text such as a title or NPC name. Returns the trimmed value. */
function text(
  c: Collector,
  value: unknown,
  path: string,
  required: boolean,
): string | null {
  if (isAbsent(value)) {
    if (required) c.add(path, "is required");
    return null;
  }
  if (typeof value !== "string") {
    c.add(path, `must be a string, got ${describe(value)}`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    c.add(path, "must not be empty");
    return null;
  }
  if ([...value].length > MAX_TEXT_LENGTH) {
    c.add(path, `must be at most ${MAX_TEXT_LENGTH} characters`);
    return null;
  }
  if (LONE_SURROGATE.test(value)) {
    c.add(path, "contains invalid Unicode");
    return null;
  }
  if (CONTROL_CHARACTERS.test(value)) {
    c.add(path, "must not contain control characters");
    return null;
  }
  if (FORMAT_CHARACTERS.test(value)) {
    c.add(path, "must not contain invisible formatting characters");
    return null;
  }
  if (value.includes("|")) {
    c.add(path, "must not contain '|' (UI escape sequences must be stripped)");
    return null;
  }
  return trimmed;
}

function timestamp(
  c: Collector,
  fields: Fields,
  key: string,
  path: string,
  now: number,
): number | null {
  const value = integer(c, fields, key, path, 0, Number.MAX_SAFE_INTEGER, true);
  if (value === null) return null;
  if (value < EARLIEST_TIMESTAMP) {
    c.add(`${path}${key}`, "must not be before 2026-01-01");
    return null;
  }
  if (value > now + MAX_CLOCK_SKEW) {
    c.add(`${path}${key}`, "must not be in the future");
    return null;
  }
  return value;
}

function optionalBoolean(
  c: Collector,
  fields: Fields,
  key: string,
  path: string,
): boolean | null {
  const value = fields[key];
  if (isAbsent(value)) return null;
  if (typeof value !== "boolean") {
    c.add(`${path}${key}`, `must be a boolean, got ${describe(value)}`);
    return null;
  }
  return value;
}

function coordinate(
  c: Collector,
  fields: Fields,
  key: string,
  path: string,
): number | null {
  const value = fields[key];
  if (isAbsent(value)) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    c.add(`${path}${key}`, "must be a number between 0 and 1");
    return null;
  }
  return value;
}

function giver(c: Collector, value: unknown, path: string): GiverRecord | null {
  if (isAbsent(value)) return null;
  if (!isObject(value)) {
    c.add(path, `must be an object, got ${describe(value)}`);
    return null;
  }
  const type = oneOf(c, value, "type", `${path}.`, GIVER_TYPES, true);
  const id = integer(c, value, "id", `${path}.`, 1, 2_147_483_647, false);
  const name = text(c, value["name"], `${path}.name`, false);
  return type === null ? null : { type, id, name };
}

function contexts(c: Collector, value: unknown, path: string): QuestContext[] {
  if (!Array.isArray(value)) {
    c.add(path, "must be an array of strings");
    return [];
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (
      typeof entry !== "string" ||
      !(QUEST_CONTEXTS as readonly string[]).includes(entry)
    ) {
      c.add(`${path}[${index}]`, `must be one of ${QUEST_CONTEXTS.join(", ")}`);
    } else if (seen.has(entry)) {
      c.add(`${path}[${index}]`, `duplicates "${entry}"`);
    } else {
      seen.add(entry);
    }
  });
  return [...seen] as QuestContext[];
}

function questRecord(
  c: Collector,
  value: unknown,
  path: string,
  now: number,
): QuestRecord | null {
  if (!isObject(value)) {
    c.add(path, `must be an object, got ${describe(value)}`);
    return null;
  }
  const prefix = `${path}.`;
  const id = integer(c, value, "id", prefix, 1, 1_000_000, true);
  const title = text(c, value["title"], `${prefix}title`, true);
  const state = oneOf(c, value, "state", prefix, QUEST_STATES, true);
  const level = integer(c, value, "level", prefix, 1, 100, false);
  const questGiver = giver(c, value["giver"], `${prefix}giver`);
  const map = integer(c, value, "map", prefix, 1, 1_000_000, false);
  const x = coordinate(c, value, "x", prefix);
  const y = coordinate(c, value, "y", prefix);
  if (isAbsent(value["x"]) !== isAbsent(value["y"])) {
    c.add(`${prefix}x`, "x and y must be given together");
  }
  const faction = oneOf(c, value, "faction", prefix, FACTIONS, false);
  const seenIn = contexts(c, value["contexts"], `${prefix}contexts`);
  const firstSeen = timestamp(c, value, "firstSeen", prefix, now);
  const lastSeen = timestamp(c, value, "lastSeen", prefix, now);
  if (firstSeen !== null && lastSeen !== null && firstSeen > lastSeen) {
    c.add(`${prefix}lastSeen`, "must not be before firstSeen");
  }
  const seenCount = integer(c, value, "seenCount", prefix, 1, 1_000_000, true);
  const accepted = optionalBoolean(c, value, "accepted", prefix);
  const turnedIn = optionalBoolean(c, value, "turnedIn", prefix);

  if (
    id === null ||
    title === null ||
    state === null ||
    firstSeen === null ||
    lastSeen === null ||
    seenCount === null
  ) {
    return null;
  }
  return {
    id,
    title,
    state,
    level,
    giver: questGiver,
    map,
    x,
    y,
    faction,
    contexts: seenIn,
    firstSeen,
    lastSeen,
    seenCount,
    accepted,
    turnedIn,
  };
}

export function validateExport(value: unknown, now: number): ValidationResult {
  const c = new Collector();
  if (!isObject(value)) {
    c.add("", `the export must be a JSON object, got ${describe(value)}`);
    return { ok: false, errors: c.errors, truncated: false };
  }

  if (value["format"] !== EXPORT_FORMAT) {
    c.add("format", `must be "${EXPORT_FORMAT}"`);
  }
  const version = value["version"];
  if (typeof version !== "number" || !SUPPORTED_VERSIONS.includes(version)) {
    c.add(
      "version",
      `must be one of the supported versions: ${SUPPORTED_VERSIONS.join(", ")}`,
    );
  }
  // Without a known format and version the rest cannot be interpreted.
  if (c.errors.length > 0)
    return { ok: false, errors: c.errors, truncated: false };

  const addonVersion = patterned(
    c,
    value,
    "addonVersion",
    "",
    ADDON_VERSION,
    "a version string",
  );
  const clientId = patterned(
    c,
    value,
    "clientId",
    "",
    CLIENT_ID,
    "16 lowercase hex characters",
  );
  const build = patterned(
    c,
    value,
    "build",
    "",
    BUILD,
    "a build number like 1.60.1.69977",
  );
  const interfaceVersion = integer(c, value, "interface", "", 1, 999_999, true);
  const locale = oneOf(c, value, "locale", "", LOCALES, true);
  const exportedAt = timestamp(c, value, "exportedAt", "", now);
  const count = integer(c, value, "count", "", 0, MAX_QUESTS, true);

  const quests = value["quests"];
  const records: QuestRecord[] = [];
  if (!Array.isArray(quests)) {
    c.add("quests", "must be an array");
  } else if (quests.length > MAX_QUESTS) {
    c.add(
      "quests",
      `must contain at most ${MAX_QUESTS} records, got ${quests.length}`,
    );
  } else if (quests.length === 0) {
    c.add("quests", "must contain at least one record");
  } else {
    if (count !== null && count !== quests.length) {
      c.add(
        "count",
        `is ${count} but quests has ${quests.length} records; the export was probably not copied completely`,
      );
    }
    const firstIndex = new Map<number, number>();
    for (let index = 0; index < quests.length; index++) {
      if (c.full) {
        c.truncated = true;
        break;
      }
      const record = questRecord(c, quests[index], `quests[${index}]`, now);
      if (!record) continue;
      const earlier = firstIndex.get(record.id);
      if (earlier !== undefined) {
        c.add(
          `quests[${index}].id`,
          `duplicates quest ${record.id} from quests[${earlier}]`,
        );
        continue;
      }
      firstIndex.set(record.id, index);
      records.push(record);
    }
  }

  if (
    c.errors.length > 0 ||
    c.truncated ||
    addonVersion === null ||
    clientId === null ||
    build === null ||
    interfaceVersion === null ||
    locale === null ||
    exportedAt === null ||
    count === null
  ) {
    return { ok: false, errors: c.errors, truncated: c.truncated };
  }
  return {
    ok: true,
    document: {
      format: EXPORT_FORMAT,
      version: version as number,
      addonVersion,
      clientId,
      build,
      interface: interfaceVersion,
      locale,
      exportedAt,
      count,
      quests: records,
    },
  };
}

/** Parses pasted text (tolerating a byte order mark and surrounding whitespace) and validates it. */
export function parseExport(body: string, now: number): ValidationResult {
  const trimmed = body.replace(/^\ufeff/, "").trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      errors: [{ path: "", message: "the request body is empty" }],
      truncated: false,
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [
        {
          path: "",
          message: `not valid JSON (${detail}); copy the whole export text`,
        },
      ],
      truncated: false,
    };
  }
  return validateExport(value, now);
}
