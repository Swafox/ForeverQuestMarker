import { normalizeIds } from "./bitset";
import {
  parseCorrectionAdditions,
  parseDb2CsvIds,
  parseQuestieQuestIds,
} from "./parse";
import {
  fetchText,
  questieRawUrl,
  type SourcePins,
  wagoQuestV2Url,
  REPO_ROOT,
} from "./sources";
import { join } from "node:path";

export interface CommunityEntry {
  id: number;
  title?: string;
  note?: string;
  source?: string;
}

export interface QuestSets {
  /** Original Classic quests: QuestieDB Classic table plus Era-only additions. */
  classic: number[];
  /** Season of Discovery quests (QuestieDB SoD base quests). */
  sod: number[];
  /** In the Classic Era client but in neither list above (cut, unused, events). */
  era: number[];
  /** In the Forever client's QuestV2 table but not in the Classic Era client. */
  datamined: number[];
  /** Confirmed new by community reports (dataset/community/confirmed.json). */
  community: number[];
  /** Classic quests confirmed as modified (dataset/community/changed.json). */
  changed: number[];
}

export interface BuildResult {
  sets: QuestSets;
  warnings: string[];
  pins: SourcePins;
  inputs: {
    questieClassic: number;
    questieEraAdditions: number[];
    foreverClient: number;
    eraClient: number;
    classicAlsoNewInForeverClient: number[];
  };
}

async function readCommunity(file: string): Promise<CommunityEntry[]> {
  const data = (await Bun.file(
    join(REPO_ROOT, "dataset", "community", file),
  ).json()) as {
    quests: CommunityEntry[];
  };
  for (const entry of data.quests) {
    if (!Number.isInteger(entry.id) || entry.id <= 0) {
      throw new Error(
        `dataset/community/${file}: invalid quest ID ${JSON.stringify(entry.id)}`,
      );
    }
  }
  return data.quests;
}

const difference = (a: Iterable<number>, ...others: Set<number>[]) =>
  normalizeIds([...a].filter((id) => others.every((other) => !other.has(id))));

export async function buildQuestSets(
  pins: SourcePins,
  offline: boolean,
): Promise<BuildResult> {
  const fetchOptions = { offline, immutable: true };
  const [classicSource, eraFixesSource, sodSource, foreverCsv, eraCsv] =
    await Promise.all([
      fetchText(
        questieRawUrl(pins, pins.questieDB.classicQuestDB),
        fetchOptions,
      ),
      fetchText(
        questieRawUrl(pins, pins.questieDB.eraQuestFixes),
        fetchOptions,
      ),
      fetchText(
        questieRawUrl(pins, pins.questieDB.sodBaseQuests),
        fetchOptions,
      ),
      fetchText(wagoQuestV2Url(pins.wago.foreverBuild), fetchOptions),
      fetchText(wagoQuestV2Url(pins.wago.eraBuild), fetchOptions),
    ]);

  const questieClassic = new Set(parseQuestieQuestIds(classicSource));
  const eraAdditions = parseCorrectionAdditions(eraFixesSource).filter(
    (id) => !questieClassic.has(id),
  );
  const classic = new Set(normalizeIds([...questieClassic, ...eraAdditions]));
  const sod = new Set(normalizeIds(parseQuestieQuestIds(sodSource)));
  const foreverClient = new Set(
    parseDb2CsvIds(foreverCsv, `QuestV2 ${pins.wago.foreverBuild}`),
  );
  const eraClient = new Set(
    parseDb2CsvIds(eraCsv, `QuestV2 ${pins.wago.eraBuild}`),
  );

  const warnings: string[] = [];
  const overlap = [...classic].filter((id) => sod.has(id));
  if (overlap.length > 0)
    warnings.push(`IDs in both Classic and SoD lists: ${overlap.join(", ")}`);

  const datamined = difference(foreverClient, eraClient, classic, sod);
  const era = difference(eraClient, classic, sod);
  const classicAlsoNewInForeverClient = normalizeIds(
    [...foreverClient].filter((id) => !eraClient.has(id) && classic.has(id)),
  );

  const communityEntries = await readCommunity("confirmed.json");
  const community: number[] = [];
  for (const entry of communityEntries) {
    if (classic.has(entry.id)) {
      warnings.push(
        `confirmed.json: ${entry.id} is an original Classic quest; use changed.json`,
      );
    } else {
      community.push(entry.id);
    }
  }

  const changedEntries = await readCommunity("changed.json");
  const changed: number[] = [];
  for (const entry of changedEntries) {
    if (!classic.has(entry.id)) {
      warnings.push(
        `changed.json: ${entry.id} is not an original Classic quest; ignored`,
      );
    } else {
      changed.push(entry.id);
    }
  }

  return {
    sets: {
      classic: normalizeIds(classic),
      sod: normalizeIds(sod),
      era,
      datamined,
      community: normalizeIds(community),
      changed: normalizeIds(changed),
    },
    warnings,
    pins,
    inputs: {
      questieClassic: questieClassic.size,
      questieEraAdditions: normalizeIds(eraAdditions),
      foreverClient: foreverClient.size,
      eraClient: eraClient.size,
      classicAlsoNewInForeverClient,
    },
  };
}
