import { describe, expect, test } from "bun:test";
import {
  parseCorrectionAdditions,
  parseDb2CsvIds,
  parseQuestieQuestFacts,
  parseQuestieQuestIds,
  splitTopLevelFields,
} from "./parse";

const QUESTIE_SAMPLE = `QuestieDB.questData = [[return {
[2] = {"Sharptalon's Claw",nil,{{12676}},20,24,178,nil,{"Bring Sharptalon's Claw."},nil,{nil,nil,{{16305}}}},
[176] = {"Wanted: \\"Hogger\\"",{nil,{68}},{{240}},5,11,77,nil,{"Kill Hogger."},nil,nil},
[9665] = {"Bolstering Our Defenses",{{17072}},{{17072}},55,60,178,nil,nil},
}]]`;

describe("parseQuestieQuestIds", () => {
  test("reads every entry ID", () => {
    expect(parseQuestieQuestIds(QUESTIE_SAMPLE)).toEqual([2, 176, 9665]);
  });

  test("fails loudly on an unrecognised format", () => {
    expect(() => parseQuestieQuestIds("return {}")).toThrow();
  });
});

describe("parseQuestieQuestFacts", () => {
  test("reads names and levels, unescaping quotes", () => {
    const facts = parseQuestieQuestFacts(QUESTIE_SAMPLE);
    expect(facts.get(176)).toEqual({
      name: 'Wanted: "Hogger"',
      requiredLevel: 5,
      questLevel: 11,
    });
    expect(facts.get(9665)?.questLevel).toBe(60);
  });
});

describe("splitTopLevelFields", () => {
  test("keeps nested tables and strings with commas intact", () => {
    expect(splitTopLevelFields(`"a, b",{1,{2,3}},nil,5`)).toEqual([
      `"a, b"`,
      "{1,{2,3}}",
      "nil",
      "5",
    ]);
  });
});

describe("parseCorrectionAdditions", () => {
  test("returns only entries that define a quest name", () => {
    const source = `
        [960] = { -- Onu is meditating
            [questKeys.name] = "Onu is meditating",
            [questKeys.startedBy] = {{3616}},
        },
        [961] = {
            [questKeys.preQuestSingle] = {960},
        },
        [65593] = {
            [questKeys.name] = "Hearts of the Lovers",
        },`;
    expect(parseCorrectionAdditions(source)).toEqual([960, 65593]);
  });
});

describe("parseDb2CsvIds", () => {
  const rows = Array.from({ length: 1200 }, (_, i) => `${i + 1},${i},0`).join(
    "\n",
  );

  test("reads the ID column", () => {
    const ids = parseDb2CsvIds(
      `ID,UniqueBitFlag,UiQuestDetailsThemeID\n${rows}\n`,
      "test",
    );
    expect(ids).toHaveLength(1200);
    expect(ids[0]).toBe(1);
  });

  test("rejects an HTML error page or a truncated export", () => {
    expect(() => parseDb2CsvIds("<html>", "test")).toThrow();
    expect(() => parseDb2CsvIds("ID,UniqueBitFlag\n1,2\n", "test")).toThrow();
  });
});
