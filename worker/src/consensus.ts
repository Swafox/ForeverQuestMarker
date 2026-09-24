/** Title normalization and majority helpers shared by promotion and change detection. */

export interface Tally {
  value: string;
  count: number;
}

export interface Leader {
  value: string;
  count: number;
  total: number;
}

/** Case- and whitespace-insensitive form used to compare titles. */
export function normalizeTitle(title: string): string {
  return title.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** A share of at least two thirds counts as agreement. */
export function hasAgreement(count: number, total: number): boolean {
  return total > 0 && count * 3 >= total * 2;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The most common value; ties go to the smallest value so results are deterministic. */
export function leader(tallies: readonly Tally[]): Leader | null {
  let best: Tally | null = null;
  let total = 0;
  for (const tally of tallies) {
    if (tally.count <= 0) continue;
    total += tally.count;
    if (
      !best ||
      tally.count > best.count ||
      (tally.count === best.count &&
        compareCodeUnits(tally.value, best.value) < 0)
    ) {
      best = tally;
    }
  }
  return best ? { value: best.value, count: best.count, total } : null;
}

/** Sums tallies that map to the same key. */
export function groupTallies(
  tallies: readonly Tally[],
  keyOf: (value: string) => string,
): Map<string, Tally[]> {
  const groups = new Map<string, Tally[]>();
  for (const tally of tallies) {
    if (tally.count <= 0) continue;
    const key = keyOf(tally.value);
    const group = groups.get(key);
    if (group) group.push(tally);
    else groups.set(key, [tally]);
  }
  return groups;
}

export interface TitleConsensus {
  /** Most common spelling within the leading normalized title. */
  title: string;
  normalized: string;
  /** Reports whose title normalizes to the leading title. */
  reports: number;
  /** All reports in this locale. */
  total: number;
  /** Distinct normalized titles. */
  variants: number;
  agreed: boolean;
}

/** Consensus over the raw titles reported in one locale. */
export function titleConsensus(votes: readonly Tally[]): TitleConsensus | null {
  const groups = groupTallies(votes, normalizeTitle);
  const top = leader(
    [...groups].map(([normalized, group]) => ({
      value: normalized,
      count: group.reduce((sum, tally) => sum + tally.count, 0),
    })),
  );
  if (!top) return null;
  const spelling = leader(groups.get(top.value)!)!;
  return {
    title: spelling.value,
    normalized: top.value,
    reports: top.count,
    total: top.total,
    variants: groups.size,
    agreed: hasAgreement(top.count, top.total),
  };
}
