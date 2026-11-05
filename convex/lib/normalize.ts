// Product-name normalization for Hebrew grocery receipts.
//
// The goal is to *suggest* that two receipt wordings are the same product,
// never to merge them silently. Package sizes, fat percentages and other
// numeric qualifiers must agree before a suggestion is considered strong,
// so "חלב 3%" is never proposed as "חלב 1%".

const NIQQUD_RE = /[֑-ׇ]/g;
const FINAL_LETTERS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

/** Lower-level normalization: strips niqqud, punctuation and final-letter forms. */
export function normalizeText(s: string): string {
  return s
    .replace(NIQQUD_RE, "")
    .replace(/[״"׳'`]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c] ?? c)
    .toLowerCase()
    .replace(/(\d)\s*(%|אחוז)/g, "$1%")
    .replace(/[^\p{L}\p{N}%.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const UNIT_WORDS: Array<[RegExp, string]> = [
  [/^(ליטר|ל|ליט|lt|l)$/, "l"],
  [/^(מל|מ"ל|ml)$/, "ml"],
  [/^(קג|ק"ג|קילו|kg)$/, "kg"],
  [/^(גרמ|גר|ג|g|gr)$/, "g"],
  [/^(יח|יחידות|יחי)$/, "unit"],
];

export type Qualifier = { num: number; kind: "%" | "l" | "ml" | "kg" | "g" | "unit" | "bare" };

/**
 * Extracts numeric qualifiers (fat %, package size, count) so that different
 * sizes or varieties are never treated as the same product.
 */
export function extractQualifiers(name: string): Qualifier[] {
  const t = normalizeText(name);
  const out: Qualifier[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(%|[\p{L}"]+)?/gu;
  for (const m of t.matchAll(re)) {
    const num = Number(m[1]);
    const unitRaw = m[2];
    if (unitRaw === "%") {
      out.push({ num, kind: "%" });
      continue;
    }
    const unit = unitRaw ? UNIT_WORDS.find(([r]) => r.test(unitRaw))?.[1] : undefined;
    out.push({ num, kind: (unit as Qualifier["kind"] | undefined) ?? "bare" });
  }
  return out;
}

/**
 * True when two wordings carry incompatible qualifiers: the same kind of
 * qualifier (e.g. %) with different values, or a bare number on one side
 * that does not appear anywhere on the other side. Missing qualifiers on
 * one side are not a conflict (receipts often omit the size).
 */
export function qualifiersConflict(a: Qualifier[], b: Qualifier[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const kinds = new Set([...a, ...b].map((q) => q.kind).filter((k) => k !== "bare"));
  for (const k of kinds) {
    const av = [...new Set(a.filter((q) => q.kind === k).map((q) => q.num))].sort().join("|");
    const bv = [...new Set(b.filter((q) => q.kind === k).map((q) => q.num))].sort().join("|");
    if (av && bv && av !== bv) return true;
  }
  const aNums = new Set(a.map((q) => q.num));
  const bNums = new Set(b.map((q) => q.num));
  if (a.some((q) => q.kind === "bare" && !bNums.has(q.num))) return true;
  if (b.some((q) => q.kind === "bare" && !aNums.has(q.num))) return true;
  return false;
}

function wordTokens(name: string): string[] {
  return normalizeText(name)
    .split(" ")
    .filter((w) => w.length > 0 && !/\d/.test(w));
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, " ");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient over character bigrams of the non-numeric words. */
function textSimilarity(a: string, b: string): number {
  const ta = wordTokens(a).join(" ");
  const tb = wordTokens(b).join(" ");
  if (ta === tb) return ta.length > 0 ? 1 : 0;
  const ba = bigrams(ta);
  const bb = bigrams(tb);
  let overlap = 0;
  let total = 0;
  for (const [, n] of ba) total += n;
  for (const [, n] of bb) total += n;
  for (const [g, n] of ba) overlap += Math.min(n, bb.get(g) ?? 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

export type MatchCandidate = {
  id: string;
  canonicalName: string;
  aliases: string[];
};

export type MatchSuggestion = {
  id: string;
  canonicalName: string;
  score: number;
  /** "exact": this exact wording was confirmed before. */
  kind: "exact" | "strong" | "weak";
  qualifiersConflict: boolean;
};

/**
 * Ranks known products against a raw receipt description.
 * - "exact": identical normalized wording to the canonical name or a
 *   previously confirmed alias. Safe to pre-select (it was verified before).
 * - "strong"/"weak": similar wording; the user must confirm.
 * A conflict in numeric qualifiers (size, %) caps the score so it can never
 * be "strong".
 */
export function suggestMatches(
  description: string,
  candidates: MatchCandidate[],
  limit = 3,
): MatchSuggestion[] {
  const norm = normalizeText(description);
  const q = extractQualifiers(description);
  const results: MatchSuggestion[] = [];
  for (const c of candidates) {
    const names = [c.canonicalName, ...c.aliases];
    if (names.some((n) => normalizeText(n) === norm)) {
      results.push({ id: c.id, canonicalName: c.canonicalName, score: 1, kind: "exact", qualifiersConflict: false });
      continue;
    }
    let best = 0;
    let conflict = false;
    for (const n of names) {
      const s = textSimilarity(description, n);
      const conflicts = qualifiersConflict(q, extractQualifiers(n));
      // Conflicting sizes/percentages halve the score: still listed so a
      // person can see it, but never "strong".
      const score = conflicts ? s * 0.5 : s;
      if (score > best) {
        best = score;
        conflict = conflicts;
      }
    }
    if (best >= 0.45) {
      results.push({
        id: c.id,
        canonicalName: c.canonicalName,
        score: Math.round(best * 100) / 100,
        kind: best >= 0.75 && !conflict ? "strong" : "weak",
        qualifiersConflict: conflict,
      });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
