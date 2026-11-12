/**
 * Fingerprint of a quest's objective text, shared with the addon
 * (Core/Recorder.lua computes the same hash in game). Only letters and digits
 * count, so punctuation, spacing and line breaks never change it.
 */

/** Largest prime below 2^32; h * 257 + 255 stays exact in a double. */
const MODULUS = 4294967291;
const MULTIPLIER = 257;

/** Lowercased letters and digits of QuestieDB objective text, without $ placeholders. */
export function normalizeObjectives(text: string): string {
  return text
    .toLowerCase()
    .replace(/\$g[^;]*;/gi, "")
    .replace(/\$[ncr]/gi, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Hash of an already normalized string ([a-z0-9]*), as 8 lowercase hex digits. */
export function hashNormalized(normalized: string): string {
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * MULTIPLIER + normalized.charCodeAt(i)) % MODULUS;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The hash players would report for QuestieDB's objective lines, or null when
 * there is nothing to compare: no text, or a gendered $g placeholder whose
 * in-game form depends on the character.
 */
export function questieObjectivesHash(lines: readonly string[]): string | null {
  const text = lines.join("");
  if (/\$g/i.test(text)) return null;
  const normalized = normalizeObjectives(text);
  return normalized.length === 0 ? null : hashNormalized(normalized);
}
