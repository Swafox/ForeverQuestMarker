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
import { CHANGE_KINDS, type ChangeKind } from "../lib/changeCandidates";
import { parsePlacesFile, type PlaceEntry } from "../lib/places";

export interface CommunityEntry {
  id: number;
  title?: string;
  note?: string;
  source?: string;
  /** changed.json only: what players confirmed as modified. */
  kinds?: ChangeKind[];
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
  /** Agreed quest givers of new quests (dataset/community/places.json), by ID. */
  places: PlaceEntry[];
  /** What changed in each modified Classic quest, for those changed.json describes. */
  changeKinds: { id: number; kinds: ChangeKind[] }[];
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
    if (entry.kinds !== undefined) {
      if (
        !Array.isArray(entry.kinds) ||
        entry.kinds.some(
          (kind) => !(CHANGE_KINDS as readonly string[]).includes(kind),
        ) ||
        new Set(entry.kinds).size !== entry.kinds.length
      ) {
        throw new Error(
          `dataset/community/${file}: quest ${entry.id} kinds must be distinct values of ${CHANGE_KINDS.join(", ")}`,
        );
      }
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
  const changeKinds: BuildResult["changeKinds"] = [];
  for (const entry of changedEntries) {
    if (!classic.has(entry.id)) {
      warnings.push(
        `changed.json: ${entry.id} is not an original Classic quest; ignored`,
      );
    } else {
      changed.push(entry.id);
      if (entry.kinds && entry.kinds.length > 0)
        changeKinds.push({
          id: entry.id,
          // Fixed order, so the generated file does not depend on how the entry lists them.
          kinds: CHANGE_KINDS.filter((kind) => entry.kinds!.includes(kind)),
        });
    }
  }
  changeKinds.sort((a, b) => a.id - b.id);

  const newIds = new Set([...datamined, ...community]);
  const placesFile = parsePlacesFile(
    await Bun.file(
      join(REPO_ROOT, "dataset", "community", "places.json"),
    ).text(),
    "dataset/community/places.json",
  );
  const places: PlaceEntry[] = [];
  for (const entry of placesFile.quests) {
    if (newIds.has(entry.id)) places.push(entry);
    else
      warnings.push(
        `places.json: ${entry.id} is not a new Forever quest in this data; ignored`,
      );
  }
  places.sort((a, b) => a.id - b.id);

  return {
    sets: {
      classic: normalizeIds(classic),
      sod: normalizeIds(sod),
      era,
      datamined,
      community: normalizeIds(community),
      changed: normalizeIds(changed),
    },
    places,
    changeKinds,
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
