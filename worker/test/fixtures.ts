import { createClassifier, type QuestSets } from "../src/classify";

/** 2026-09-21T13:46:40Z */
export const NOW = 1790000000;

/** Small, hand-picked ID sets so tests do not depend on regenerated data. */
export const TEST_SETS: QuestSets = {
  classic: [2, 5, 176, 9665],
  sod: [79000],
  era: [9999],
  datamined: [92401, 92402],
  community: [95000],
};

export const testClassifier = createClassifier(TEST_SETS);

/** A candidate in the plausible ID range (not in any test set). */
export const CANDIDATE_ID = 120001;

export function clientId(n: number): string {
  return n.toString(16).padStart(16, "0");
}

export type Json = Record<string, unknown>;

export function questRecord(id: number, overrides: Json = {}): Json {
  return {
    id,
    title: `Quest ${id}`,
    state: "inferred",
    level: 20,
    giver: { type: "npc", id: 4001, name: "Scout Aldren" },
    map: 1436,
    x: 0.452,
    y: 0.612,
    faction: "Alliance",
    contexts: ["detail", "accepted"],
    firstSeen: NOW - 3600,
    lastSeen: NOW - 60,
    seenCount: 2,
    accepted: true,
    turnedIn: false,
    ...overrides,
  };
}

export function exportDocument(quests: Json[], overrides: Json = {}): Json {
  return {
    format: "ForeverQuestMarker",
    version: 1,
    addonVersion: "0.1.0",
    clientId: clientId(1),
    build: "1.60.1.69977",
    interface: 16001,
    locale: "enUS",
    exportedAt: NOW - 30,
    count: quests.length,
    quests,
    ...overrides,
  };
}
