/**
 * Parsers for the upstream data files. They read only quest IDs (and, for
 * offline change detection, names and levels); no quest text is redistributed.
 */

const ENTRY_START = /^\s*\[(\d+)\]\s*=\s*\{/gm;

/** IDs of every entry in a QuestieDB `questData` table (`[id] = {...}` rows). */
export function parseQuestieQuestIds(source: string): number[] {
  const ids: number[] = [];
  for (const match of source.matchAll(ENTRY_START)) {
    ids.push(Number(match[1]));
  }
  if (ids.length === 0) {
    throw new Error(
      "No quest entries found; the QuestieDB format may have changed",
    );
  }
  return ids;
}

/**
 * IDs of correction entries that define a quest name. Corrections for existing
 * quests are ignored by the caller; entries that are absent from the base
 * table are full quest additions (for example Classic Era-only quests).
 */
export function parseCorrectionAdditions(source: string): number[] {
  const starts = [...source.matchAll(ENTRY_START)];
  const ids: number[] = [];
  starts.forEach((match, index) => {
    const bodyStart = match.index! + match[0].length;
    const bodyEnd =
      index + 1 < starts.length ? starts[index + 1]!.index! : source.length;
    if (source.slice(bodyStart, bodyEnd).includes("[questKeys.name]")) {
      ids.push(Number(match[1]));
    }
  });
  return ids;
}

/** Quest IDs from a wago.tools DB2 CSV export (first column is `ID`). */
export function parseDb2CsvIds(csv: string, label: string): number[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines.shift();
  if (!header || header.split(",")[0] !== "ID") {
    throw new Error(
      `${label}: unexpected CSV header ${JSON.stringify(header?.slice(0, 80))}`,
    );
  }
  const ids = lines.map((line) => Number(line.split(",")[0]));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error(`${label}: CSV contains a non-numeric ID`);
  }
  if (ids.length < 1000) {
    throw new Error(
      `${label}: only ${ids.length} rows; the export is probably incomplete`,
    );
  }
  return ids;
}

export interface QuestieQuestFacts {
  name: string;
  questLevel: number | null;
  requiredLevel: number | null;
}

/**
 * Splits the top-level fields of a Lua table constructor body, respecting
 * nested tables and string literals. Only handles the subset of Lua literal
 * syntax that QuestieDB emits (strings, numbers, nil, nested tables).
 */
export function splitTopLevelFields(body: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += body[++i] ?? "";
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "{") {
      depth++;
      current += ch;
    } else if (ch === "}") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) fields.push(current.trim());
  return fields;
}

function unquoteLuaString(literal: string): string {
  const inner = literal.slice(1, -1);
  return inner.replace(/\\(.)/g, (_match, ch: string) =>
    ch === "n" ? "\n" : ch,
  );
}

function parseIntField(field: string | undefined): number | null {
  if (!field || field === "nil") return null;
  const value = Number(field);
  return Number.isInteger(value) ? value : null;
}

/** Names and levels from a QuestieDB `questData` table, keyed by quest ID. */
export function parseQuestieQuestFacts(
  source: string,
): Map<number, QuestieQuestFacts> {
  const facts = new Map<number, QuestieQuestFacts>();
  for (const line of source.split(/\r?\n/)) {
    const match = /^\[(\d+)\]\s*=\s*\{(.*)\},?\s*$/.exec(line);
    if (!match) continue;
    const fields = splitTopLevelFields(match[2]!);
    const nameField = fields[0];
    if (!nameField || !/^["']/.test(nameField)) continue;
    facts.set(Number(match[1]), {
      name: unquoteLuaString(nameField),
      requiredLevel: parseIntField(fields[3]),
      questLevel: parseIntField(fields[4]),
    });
  }
  return facts;
}
