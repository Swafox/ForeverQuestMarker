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

/** Creature, object and item IDs from a QuestieDB startedBy or finishedBy field. */
export interface QuestieActors {
  npcs: number[];
  objects: number[];
  items: number[];
}

export interface QuestieQuestFacts {
  name: string;
  questLevel: number | null;
  requiredLevel: number | null;
  /** Who offers the quest (field 2); null when QuestieDB lists nobody. */
  startedBy: QuestieActors | null;
  /** Who completes the quest (field 3); null when QuestieDB lists nobody. */
  finishedBy: QuestieActors | null;
  /** Objective text lines (field 8); null for auto-completing quests. */
  objectivesText: string[] | null;
  /** Item objective IDs (field 10, third list), ascending. */
  objectiveItems: number[];
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

/** A Lua literal as QuestieDB writes it: nil, number, string or table. */
export type LuaValue = null | boolean | number | string | LuaValue[];

/**
 * Parses one Lua literal. Tables become arrays indexed from 0 (Lua index 1);
 * `[n] = value` entries land at index n - 1 and other keyed entries are
 * dropped. Only covers the literal syntax QuestieDB emits.
 */
export function parseLuaLiteral(text: string): LuaValue {
  let pos = 0;
  const fail = (message: string): never => {
    throw new Error(
      `Lua literal: ${message} at ${pos} in ${text.slice(0, 80)}`,
    );
  };
  const skip = () => {
    while (pos < text.length && /\s/.test(text[pos]!)) pos++;
  };
  const value = (): LuaValue => {
    skip();
    const ch = text[pos];
    if (ch === "{") return table();
    if (ch === '"' || ch === "'") return string();
    const word =
      /^(nil|true|false|-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?))/.exec(
        text.slice(pos),
      );
    if (!word) return fail("unexpected character");
    pos += word[0].length;
    if (word[0] === "nil") return null;
    if (word[0] === "true") return true;
    if (word[0] === "false") return false;
    return Number(word[0]);
  };
  const string = (): string => {
    const quote = text[pos++];
    let result = "";
    while (pos < text.length && text[pos] !== quote) {
      if (text[pos] === "\\") {
        const next = text[pos + 1] ?? "";
        result += next === "n" ? "\n" : next;
        pos += 2;
      } else {
        result += text[pos++];
      }
    }
    if (pos >= text.length) fail("unterminated string");
    pos++;
    return result;
  };
  const table = (): LuaValue[] => {
    pos++;
    const result: LuaValue[] = [];
    let index = 0;
    for (;;) {
      skip();
      if (text[pos] === "}") {
        pos++;
        return result;
      }
      if (text[pos] === "[") {
        pos++;
        const key = value();
        skip();
        if (text[pos] !== "]") fail("expected ]");
        pos++;
        skip();
        if (text[pos] !== "=") fail("expected =");
        pos++;
        const entry = value();
        if (typeof key === "number" && Number.isInteger(key) && key >= 1)
          result[key - 1] = entry;
      } else {
        result[index++] = value();
      }
      skip();
      if (text[pos] === "," || text[pos] === ";") pos++;
      else if (text[pos] !== "}") fail("expected , or }");
    }
  };
  const result = value();
  skip();
  if (pos !== text.length) fail("trailing text");
  return result;
}

function idList(value: LuaValue | undefined): number[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<number>();
  for (const entry of value) {
    // Lists hold IDs directly ({288}) or as the first element of a row ({{3421, "text"}}).
    const id = Array.isArray(entry) ? entry[0] : entry;
    if (typeof id === "number" && Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

function actors(field: string | undefined): QuestieActors | null {
  if (!field || field === "nil") return null;
  const value = parseLuaLiteral(field);
  if (!Array.isArray(value)) return null;
  const result = {
    npcs: idList(value[0]),
    objects: idList(value[1]),
    items: idList(value[2]),
  };
  return result.npcs.length + result.objects.length + result.items.length > 0
    ? result
    : null;
}

function textLines(field: string | undefined): string[] | null {
  if (!field || field === "nil") return null;
  const value = parseLuaLiteral(field);
  if (!Array.isArray(value)) return null;
  const lines = value.filter(
    (line): line is string => typeof line === "string",
  );
  return lines.length > 0 ? lines : null;
}

function objectiveItems(field: string | undefined): number[] {
  if (!field || field === "nil") return [];
  const value = parseLuaLiteral(field);
  return Array.isArray(value) ? idList(value[2]) : [];
}

/** Names, levels, givers, finishers and objectives from a QuestieDB `questData` table, keyed by quest ID. */
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
      startedBy: actors(fields[1]),
      finishedBy: actors(fields[2]),
      objectivesText: textLines(fields[7]),
      objectiveItems: objectiveItems(fields[9]),
    });
  }
  return facts;
}
