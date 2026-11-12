import { describe, expect, test } from "bun:test";
import {
  hashNormalized,
  normalizeObjectives,
  questieObjectivesHash,
} from "./objectivesHash";

describe("objectives hash", () => {
  test("matches the vectors the addon's specs assert", () => {
    expect(hashNormalized("kill10koboldvermin")).toBe("42300a10");
    expect(hashNormalized("a")).toBe("00000061");
    expect(hashNormalized("z".repeat(500))).toBe("6bbdcd86");
  });

  test("keeps only lowercase letters and digits", () => {
    expect(normalizeObjectives("Kill 10 Kobold Vermin.\n\nReturn!")).toBe(
      "kill10koboldverminreturn",
    );
  });

  test("drops name, class and race placeholders", () => {
    expect(normalizeObjectives("Bring it to $N, the $C $r.")).toBe(
      "bringittothe",
    );
  });

  test("hashes QuestieDB lines joined without separators", () => {
    expect(questieObjectivesHash(["Kill 10 ", "Kobold Vermin."])).toBe(
      "42300a10",
    );
  });

  test("has no baseline for gendered or empty text", () => {
    expect(questieObjectivesHash(["Hello, young $gman:woman;."])).toBeNull();
    expect(questieObjectivesHash(["..."])).toBeNull();
    expect(questieObjectivesHash([])).toBeNull();
  });
});
