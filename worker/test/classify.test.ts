import { describe, expect, test } from "bun:test";
import { createClassifier, generatedClassifier } from "../src/classify";
import {
  CLASSIC_QUEST_IDS,
  COMMUNITY_CONFIRMED_QUEST_IDS,
  DATAMINED_FOREVER_QUEST_IDS,
  ERA_CLIENT_QUEST_IDS,
  SOD_QUEST_IDS,
} from "../src/generated/questData";
import { testClassifier } from "./fixtures";

describe("classifier", () => {
  test("classifies each list", () => {
    expect(testClassifier.category(176)).toBe("classic");
    expect(testClassifier.category(92401)).toBe("known");
    expect(testClassifier.category(95000)).toBe("known");
    expect(testClassifier.category(79000)).toBe("sod");
    expect(testClassifier.category(9999)).toBe("era");
    expect(testClassifier.category(120001)).toBe("candidate");
    expect(testClassifier.knownSource(92401)).toBe("datamined");
    expect(testClassifier.knownSource(95000)).toBe("community");
    expect(testClassifier.knownSource(120001)).toBeNull();
  });

  test("never treats an original Classic quest as new, whatever other list contains it", () => {
    const classifier = createClassifier({
      classic: [7],
      sod: [7],
      era: [7],
      datamined: [7],
      community: [7],
    });
    expect(classifier.category(7)).toBe("classic");
    expect(classifier.knownSource(7)).toBeNull();
    expect(classifier.knownIds).toEqual([]);
  });

  test("lists known and classic IDs in ascending order", () => {
    expect(testClassifier.knownIds).toEqual([92401, 92402, 95000]);
    expect(testClassifier.classicIds).toEqual([2, 5, 176, 9665]);
  });
});

describe("generated data", () => {
  const classifier = generatedClassifier();

  test("is loaded and non-trivial", () => {
    expect(CLASSIC_QUEST_IDS.length).toBeGreaterThan(1000);
    expect(DATAMINED_FOREVER_QUEST_IDS.length).toBeGreaterThan(0);
  });

  test("maps every list to its category", () => {
    for (const id of CLASSIC_QUEST_IDS)
      expect(classifier.category(id)).toBe("classic");
    for (const id of DATAMINED_FOREVER_QUEST_IDS)
      expect(classifier.category(id)).toBe("known");
    for (const id of COMMUNITY_CONFIRMED_QUEST_IDS) {
      if (!CLASSIC_QUEST_IDS.includes(id))
        expect(classifier.category(id)).toBe("known");
    }
    const known = new Set([
      ...DATAMINED_FOREVER_QUEST_IDS,
      ...COMMUNITY_CONFIRMED_QUEST_IDS,
    ]);
    for (const id of SOD_QUEST_IDS) {
      if (!CLASSIC_QUEST_IDS.includes(id) && !known.has(id))
        expect(classifier.category(id)).toBe("sod");
    }
    for (const id of ERA_CLIENT_QUEST_IDS) {
      if (!known.has(id))
        expect(["era", "sod"]).toContain(classifier.category(id));
    }
  });
});
