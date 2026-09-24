import {
  CLASSIC_QUEST_IDS,
  COMMUNITY_CONFIRMED_QUEST_IDS,
  DATAMINED_FOREVER_QUEST_IDS,
  ERA_CLIENT_QUEST_IDS,
  SOD_QUEST_IDS,
} from "./generated/questData";

/**
 * candidate: possibly new in WoW Forever, subject to promotion.
 * known: already known to be new (datamined or community-confirmed).
 * classic: original Classic quest, only used for change detection.
 * sod, era: in other Classic clients, so not new; aggregated but never promoted.
 */
export type QuestCategory = "candidate" | "known" | "classic" | "sod" | "era";
export type KnownSource = "datamined" | "community";

export const QUEST_CATEGORIES: readonly QuestCategory[] = [
  "candidate",
  "known",
  "classic",
  "sod",
  "era",
];

export interface QuestSets {
  classic: readonly number[];
  sod: readonly number[];
  era: readonly number[];
  datamined: readonly number[];
  community: readonly number[];
}

export interface Classifier {
  category(id: number): QuestCategory;
  knownSource(id: number): KnownSource | null;
  /** Every known-new ID, ascending. */
  readonly knownIds: readonly number[];
  /** Every original Classic ID, ascending. */
  readonly classicIds: readonly number[];
}

export function createClassifier(sets: QuestSets): Classifier {
  const classic = new Set(sets.classic);
  const datamined = new Set(sets.datamined);
  const community = new Set(sets.community);
  const sod = new Set(sets.sod);
  const era = new Set(sets.era);
  const ascending = (ids: Iterable<number>) =>
    [...new Set(ids)].sort((a, b) => a - b);

  const knownSource = (id: number): KnownSource | null => {
    if (classic.has(id)) return null;
    if (datamined.has(id)) return "datamined";
    if (community.has(id)) return "community";
    return null;
  };

  return {
    // Classic wins over every other list: an original quest is never a Forever candidate.
    category(id) {
      if (classic.has(id)) return "classic";
      if (knownSource(id)) return "known";
      if (sod.has(id)) return "sod";
      if (era.has(id)) return "era";
      return "candidate";
    },
    knownSource,
    knownIds: ascending(
      [...datamined, ...community].filter((id) => !classic.has(id)),
    ),
    classicIds: ascending(classic),
  };
}

let generated: Classifier | null = null;

/** Classifier over the generated data in src/generated/questData.ts. */
export function generatedClassifier(): Classifier {
  generated ??= createClassifier({
    classic: CLASSIC_QUEST_IDS,
    sod: SOD_QUEST_IDS,
    era: ERA_CLIENT_QUEST_IDS,
    datamined: DATAMINED_FOREVER_QUEST_IDS,
    community: COMMUNITY_CONFIRMED_QUEST_IDS,
  });
  return generated;
}
