/**
 * Compact encoding for sets of quest IDs, decoded in-game by Core/Bitset.lua.
 *
 * A set is a list of segments plus a list of loose IDs. A segment covers a
 * contiguous ID range starting at `offset`; each character of `bits` encodes
 * six IDs using the standard base64 alphabet, least significant bit first.
 * Sparse regions are cheaper as loose IDs, so the encoder picks whichever
 * representation is smaller per cluster.
 */

export const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const BITS_PER_CHAR = 6;

export interface Segment {
  offset: number;
  bits: string;
}

export interface EncodedSet {
  count: number;
  segments: Segment[];
  ids: number[];
}

export interface EncodeOptions {
  /** IDs closer than this are grouped into one cluster. */
  maxGap: number;
  /** Approximate source-size overhead of emitting one segment. */
  segmentOverhead: number;
}

const DEFAULT_OPTIONS: EncodeOptions = { maxGap: 64, segmentOverhead: 16 };

export function normalizeIds(input: Iterable<number>): number[] {
  const unique = new Set<number>();
  for (const id of input) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid quest ID: ${id}`);
    }
    unique.add(id);
  }
  return [...unique].sort((a, b) => a - b);
}

export function encodeBits(ids: readonly number[], offset: number): string {
  if (ids.length === 0) return "";
  const last = ids[ids.length - 1]!;
  const span = last - offset + 1;
  const values = new Array<number>(Math.ceil(span / BITS_PER_CHAR)).fill(0);
  for (const id of ids) {
    const index = id - offset;
    if (index < 0)
      throw new Error(`ID ${id} is below segment offset ${offset}`);
    const charIndex = Math.floor(index / BITS_PER_CHAR);
    values[charIndex]! |= 1 << (index % BITS_PER_CHAR);
  }
  return values.map((value) => ALPHABET[value]).join("");
}

function clusterIds(ids: readonly number[], maxGap: number): number[][] {
  const clusters: number[][] = [];
  let current: number[] = [];
  for (const id of ids) {
    const previous = current[current.length - 1];
    if (previous !== undefined && id - previous > maxGap) {
      clusters.push(current);
      current = [];
    }
    current.push(id);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function sparseCost(ids: readonly number[]): number {
  return ids.reduce((sum, id) => sum + String(id).length + 2, 0);
}

export function encodeSet(
  input: Iterable<number>,
  options: Partial<EncodeOptions> = {},
): EncodedSet {
  const { maxGap, segmentOverhead } = { ...DEFAULT_OPTIONS, ...options };
  const ids = normalizeIds(input);
  const segments: Segment[] = [];
  const loose: number[] = [];

  for (const cluster of clusterIds(ids, maxGap)) {
    const offset = cluster[0]!;
    const span = cluster[cluster.length - 1]! - offset + 1;
    const segmentCost = Math.ceil(span / BITS_PER_CHAR) + segmentOverhead;
    if (segmentCost < sparseCost(cluster)) {
      segments.push({ offset, bits: encodeBits(cluster, offset) });
    } else {
      loose.push(...cluster);
    }
  }

  return { count: ids.length, segments, ids: loose };
}

/** Reference decoder mirroring Core/Bitset.lua, used to verify the encoder. */
export function setHas(set: EncodedSet, id: number): boolean {
  if (set.ids.includes(id)) return true;
  for (const segment of set.segments) {
    const index = id - segment.offset;
    if (index < 0) continue;
    const charIndex = Math.floor(index / BITS_PER_CHAR);
    if (charIndex >= segment.bits.length) continue;
    const value = ALPHABET.indexOf(segment.bits[charIndex]!);
    if ((value >> (index % BITS_PER_CHAR)) & 1) return true;
  }
  return false;
}

export function decodeSet(set: EncodedSet): number[] {
  const out = new Set<number>(set.ids);
  for (const segment of set.segments) {
    for (let charIndex = 0; charIndex < segment.bits.length; charIndex++) {
      const value = ALPHABET.indexOf(segment.bits[charIndex]!);
      for (let bit = 0; bit < BITS_PER_CHAR; bit++) {
        if ((value >> bit) & 1)
          out.add(segment.offset + charIndex * BITS_PER_CHAR + bit);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}
