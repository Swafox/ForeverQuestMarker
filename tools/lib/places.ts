/**
 * dataset/community/places.json: who offers each new quest and where, as
 * players agree on it. The addon uses it for NPC tooltips and waypoints.
 * Serialization is deterministic so an unchanged merge rewrites nothing.
 */
import type { PlaceReport } from "./workerApi";

export const PLACE_GIVER_TYPES = ["npc", "object", "item"] as const;
export type PlaceGiverType = (typeof PLACE_GIVER_TYPES)[number];

export interface PlaceEntry {
  id: number;
  giver: { type: PlaceGiverType; id: number };
  /** uiMapID and position (0..1) where players met the giver; given together. */
  map?: number;
  x?: number;
  y?: number;
  /** Independent reporters when the entry was last written. */
  reporters?: number;
}

export interface PlacesFile {
  description: string;
  quests: PlaceEntry[];
}

export const PLACES_DESCRIPTION =
  "Quest givers and positions of new WoW Forever quests, as several players agree on them. " +
  "Maintained by tools/merge-submissions.ts; entries can also be added or corrected by hand.";

export interface PlaceMergeOptions {
  /** Reports that must name the same giver (and position) before it is used. */
  minReports: number;
}

export interface PlaceMergeResult {
  file: PlacesFile;
  added: PlaceEntry[];
  updated: PlaceEntry[];
  /** Reported quests whose giver players do not agree on yet. */
  undecided: number;
  /** Reported quests the local data does not classify as new. */
  skipped: number[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

export function parsePlacesFile(text: string, label: string): PlacesFile {
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
  const seen = new Set<number>();
  const quests = data["quests"].map((entry: unknown, index): PlaceEntry => {
    const at = `${label}: quests[${index}]`;
    if (!isObject(entry) || !isPositiveInteger(entry["id"]))
      throw new Error(`${at} needs a positive integer "id"`);
    if (seen.has(entry["id"])) throw new Error(`${at} repeats ${entry["id"]}`);
    seen.add(entry["id"]);
    const giver = entry["giver"];
    if (
      !isObject(giver) ||
      !(PLACE_GIVER_TYPES as readonly unknown[]).includes(giver["type"]) ||
      !isPositiveInteger(giver["id"])
    ) {
      throw new Error(
        `${at}.giver needs a type (${PLACE_GIVER_TYPES.join(", ")}) and a positive integer id`,
      );
    }
    const place: PlaceEntry = {
      id: entry["id"],
      giver: { type: giver["type"] as PlaceGiverType, id: giver["id"] },
    };
    const hasMap = entry["map"] !== undefined;
    if (
      hasMap !== (entry["x"] !== undefined) ||
      hasMap !== (entry["y"] !== undefined)
    ) {
      throw new Error(`${at}: map, x and y must be given together`);
    }
    if (hasMap) {
      if (
        !isPositiveInteger(entry["map"]) ||
        !isCoordinate(entry["x"]) ||
        !isCoordinate(entry["y"])
      ) {
        throw new Error(
          `${at}: map must be a uiMapID and x, y numbers from 0 to 1`,
        );
      }
      place.map = entry["map"];
      place.x = entry["x"];
      place.y = entry["y"];
    }
    if (entry["reporters"] !== undefined) {
      if (!isPositiveInteger(entry["reporters"]))
        throw new Error(`${at}.reporters must be a positive integer`);
      place.reporters = entry["reporters"];
    }
    return place;
  });
  return { description: data["description"], quests };
}

/** Pretty-printed JSON with a fixed key order and a trailing newline. */
export function serializePlacesFile(file: PlacesFile): string {
  const quests = [...file.quests]
    .sort((a, b) => a.id - b.id)
    .map((entry) => {
      const ordered: Record<string, unknown> = {
        id: entry.id,
        giver: { type: entry.giver.type, id: entry.giver.id },
      };
      if (entry.map !== undefined) {
        ordered["map"] = entry.map;
        ordered["x"] = entry.x;
        ordered["y"] = entry.y;
      }
      if (entry.reporters !== undefined) ordered["reporters"] = entry.reporters;
      return ordered;
    });
  return `${JSON.stringify({ description: file.description, quests }, null, 2)}\n`;
}

function agrees(
  value: { reports: number; total: number },
  options: PlaceMergeOptions,
): boolean {
  return (
    value.reports >= options.minReports && value.reports * 3 >= value.total * 2
  );
}

/** The entry the Worker's consensus supports, or null when players do not agree yet. */
export function placeFromReport(
  report: PlaceReport,
  options: PlaceMergeOptions,
): PlaceEntry | null {
  const giver = report.giver;
  if (
    !giver ||
    giver.id === null ||
    !(PLACE_GIVER_TYPES as readonly string[]).includes(giver.type) ||
    !agrees(giver, options)
  ) {
    return null;
  }
  const entry: PlaceEntry = {
    id: report.id,
    giver: { type: giver.type as PlaceGiverType, id: giver.id },
  };
  if (report.position && agrees(report.position, options)) {
    entry.map = report.position.map;
    entry.x = report.position.x;
    entry.y = report.position.y;
  }
  entry.reporters = report.reporters;
  return entry;
}

const sameLocation = (a: PlaceEntry, b: PlaceEntry) =>
  a.giver.type === b.giver.type &&
  a.giver.id === b.giver.id &&
  a.map === b.map &&
  a.x === b.x &&
  a.y === b.y;

/**
 * Adds agreed givers for new quests and replaces entries whose consensus moved.
 * Entries the Worker no longer reports, or no longer agrees on, are kept.
 * `isNew` tells whether the local data classifies a quest ID as new in Forever.
 */
export function mergePlaces(
  file: PlacesFile,
  reports: readonly PlaceReport[],
  isNew: (id: number) => boolean,
  options: PlaceMergeOptions,
): PlaceMergeResult {
  const byId = new Map(file.quests.map((entry) => [entry.id, entry]));
  const result: PlaceMergeResult = {
    file,
    added: [],
    updated: [],
    undecided: 0,
    skipped: [],
  };
  const unique = new Map(reports.map((report) => [report.id, report]));
  for (const report of [...unique.values()].sort((a, b) => a.id - b.id)) {
    if (!isNew(report.id)) {
      result.skipped.push(report.id);
      continue;
    }
    const entry = placeFromReport(report, options);
    if (!entry) {
      result.undecided++;
      continue;
    }
    const existing = byId.get(report.id);
    if (!existing) {
      result.added.push(entry);
    } else if (!sameLocation(existing, entry)) {
      result.updated.push(entry);
    } else {
      continue;
    }
    byId.set(report.id, entry);
  }
  if (result.added.length > 0 || result.updated.length > 0) {
    result.file = {
      description: file.description,
      quests: [...byId.values()].sort((a, b) => a.id - b.id),
    };
  }
  return result;
}
