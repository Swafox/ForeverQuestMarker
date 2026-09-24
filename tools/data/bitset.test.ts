import { describe, expect, test } from "bun:test";
import {
  ALPHABET,
  decodeSet,
  encodeBits,
  encodeSet,
  normalizeIds,
  setHas,
} from "./bitset";

describe("encodeBits", () => {
  test("packs six IDs per character, least significant bit first", () => {
    expect(encodeBits([10], 10)).toBe(ALPHABET.charAt(1));
    expect(encodeBits([15], 10)).toBe(ALPHABET.charAt(32));
    expect(encodeBits([10, 11, 12, 13, 14, 15], 10)).toBe("/");
    expect(encodeBits([16], 10)).toBe("AB");
  });

  test("rejects IDs below the offset", () => {
    expect(() => encodeBits([5], 10)).toThrow();
  });
});

describe("normalizeIds", () => {
  test("sorts and deduplicates", () => {
    expect(normalizeIds([5, 3, 5, 1])).toEqual([1, 3, 5]);
  });

  test("rejects non-positive or fractional IDs", () => {
    expect(() => normalizeIds([0])).toThrow();
    expect(() => normalizeIds([1.5])).toThrow();
  });
});

describe("encodeSet", () => {
  test("uses loose IDs for sparse input and segments for dense input", () => {
    const sparse = encodeSet([100, 5000, 90000]);
    expect(sparse.segments).toHaveLength(0);
    expect(sparse.ids).toEqual([100, 5000, 90000]);

    const dense = encodeSet(
      Array.from({ length: 300 }, (_, i) => 1000 + i * 2),
    );
    expect(dense.segments).toHaveLength(1);
    expect(dense.ids).toHaveLength(0);
  });

  test("round-trips mixed input exactly", () => {
    const ids = [
      ...Array.from({ length: 500 }, (_, i) => 2 + i * 3),
      65593,
      65597,
      ...Array.from({ length: 200 }, (_, i) => 92000 + i),
      99234,
    ];
    const encoded = encodeSet(ids);
    expect(encoded.count).toBe(ids.length);
    expect(decodeSet(encoded)).toEqual(normalizeIds(ids));
    for (const id of ids) expect(setHas(encoded, id)).toBe(true);
    for (const id of [1, 3, 4, 65594, 91999, 92200, 99233, 99235]) {
      expect(setHas(encoded, id)).toBe(false);
    }
  });

  test("handles an empty set", () => {
    expect(encodeSet([])).toEqual({ count: 0, segments: [], ids: [] });
  });
});
