// Merges several Tesseract passes over the same receipt image into visual
// lines. Each pass is good at something different:
//   heb  – Hebrew product words (but mangles numbers)
//   mix  – Hebrew + English: the most complete line structure and inline
//          numbers such as "3%" or "250"
//   num  – English with a digits-only whitelist: clean prices in the price column
// Pure functions, no browser APIs, so they can be unit-tested.

export type OcrWord = { text: string; conf: number; x0: number; x1: number; y0: number; y1: number };
export type OcrLine = { words: OcrWord[]; conf: number; x0: number; x1: number; y0: number; y1: number };
export type OcrPass = { lines: OcrLine[] };

export type Amount = { value: number; text: string; conf: number; x0: number };
export type MergedLine = {
  y: number;
  /** Words of the description area, right-to-left reading order. */
  tokens: OcrWord[];
  /** Description text in reading order. */
  text: string;
  /** Amounts found in the price column (left side of the receipt). */
  amounts: Amount[];
  /** Whole line as read by the mixed pass (for raw text and header parsing). */
  raw: string;
  /** The same words in left-to-right order, plus the digits pass — numbers such as dates read naturally here. */
  numericText: string;
  conf: number;
};

const HEB = /[א-ת]/;
export const AMOUNT_RE = /^(-?)(\d{1,4})[.,](\d{2})(-?)$/;

export function parseAmount(text: string): number | null {
  const t = text.replace(/[₪\s]/g, "").replace(/^[^\d-]+|[^\d-]+$/g, "");
  const m = AMOUNT_RE.exec(t);
  if (!m) return null;
  const v = Number(`${m[2]}.${m[3]}`);
  return m[1] === "-" || m[4] === "-" ? -v : v;
}

const centerY = (l: { y0: number; y1: number }) => (l.y0 + l.y1) / 2;

function matchLine(anchor: OcrLine, pass: OcrPass | undefined): OcrLine | undefined {
  if (!pass) return undefined;
  const c = centerY(anchor);
  const h = Math.max(8, anchor.y1 - anchor.y0);
  let best: OcrLine | undefined;
  let bestD = Infinity;
  for (const l of pass.lines) {
    const d = Math.abs(centerY(l) - c);
    if (d < bestD && d <= h * 0.6) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

function overlap(a: OcrWord, b: OcrWord) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  return w <= 0 ? 0 : w / Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
}

// Tesseract inserts invisible direction marks around mixed Hebrew/Latin text.
const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
function cleanPass(p: OcrPass | undefined): OcrPass | undefined {
  if (!p) return p;
  return {
    lines: p.lines.map((l) => ({
      ...l,
      words: l.words.map((w) => ({ ...w, text: w.text.replace(BIDI_MARKS, "").trim() })).filter((w) => w.text.length > 0),
    })),
  };
}

export function mergePasses(input: { heb?: OcrPass; mix: OcrPass; num?: OcrPass }): MergedLine[] {
  const passes = { heb: cleanPass(input.heb), mix: cleanPass(input.mix)!, num: cleanPass(input.num) };
  const all = passes.mix.lines.flatMap((l) => l.words);
  if (all.length === 0) return [];
  const minX = Math.min(...all.map((w) => w.x0));
  const maxX = Math.max(...all.map((w) => w.x1));
  // Israeli receipts print the description on the right and the amount on the left.
  const priceColMax = minX + 0.36 * (maxX - minX);
  const inPriceCol = (w: OcrWord) => w.x1 <= priceColMax + 0.04 * (maxX - minX);

  const lines = [...passes.mix.lines].sort((a, b) => a.y0 - b.y0);
  return lines.map((anchor) => {
    const heb = matchLine(anchor, passes.heb);
    const num = matchLine(anchor, passes.num);

    // Amounts: prefer the digits-only pass, then the mixed pass.
    const amounts: Amount[] = [];
    const fromNum = (num?.words ?? []).filter(inPriceCol).map((w) => ({ w, v: parseAmount(w.text) })).filter((x) => x.v !== null);
    const fromMix = anchor.words.filter(inPriceCol).map((w) => ({ w, v: parseAmount(w.text) })).filter((x) => x.v !== null);
    for (const { w, v } of fromNum.length ? fromNum : fromMix) {
      // When both passes agree the reading is more certain.
      const agrees = fromMix.some((m) => m.v === v);
      amounts.push({ value: v!, text: w.text, conf: agrees ? Math.max(w.conf, 90) : w.conf, x0: w.x0 });
    }
    if (fromNum.length && fromMix.length && !fromNum.some((n) => fromMix.some((m) => m.v === n.v))) {
      // The passes disagree: keep the mixed reading as an alternative with low confidence.
      for (const { w, v } of fromMix) amounts.push({ value: v!, text: w.text, conf: Math.min(w.conf, 40), x0: w.x0 });
    }

    // Description tokens: Hebrew words from the Hebrew pass, everything else from the mixed pass.
    // Digits in the price column that are not a clean amount are fragments of a
    // misread price, not part of the product name.
    const descMix = anchor.words.filter((w) => !inPriceCol(w) || HEB.test(w.text));
    const hebWords = (heb?.words ?? []).filter((w) => HEB.test(w.text) && !inPriceCol(w));
    const tokens: OcrWord[] = [];
    if (hebWords.length) {
      tokens.push(...hebWords);
      for (const w of descMix) {
        if (HEB.test(w.text)) continue; // Hebrew comes from the Hebrew pass
        if (hebWords.some((h) => overlap(h, w) > 0.5)) continue;
        tokens.push(w);
      }
    } else tokens.push(...descMix);
    tokens.sort((a, b) => b.x1 - a.x1);
    const text = tokens.map((t) => t.text).join(" ").replace(/\s+/g, " ").trim();
    const raw = [...anchor.words].sort((a, b) => b.x1 - a.x1).map((w) => w.text).join(" ");
    const ltr = (ws: OcrWord[]) => [...ws].sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(" ");
    const numericText = `${ltr(anchor.words)} | ${ltr(num?.words ?? [])}`;
    const confs = [...tokens.map((t) => t.conf), ...amounts.map((a) => a.conf)];
    return {
      y: anchor.y0,
      tokens,
      text,
      amounts: amounts.sort((a, b) => a.x0 - b.x0),
      raw,
      numericText,
      conf: confs.length ? Math.round(confs.reduce((s, c) => s + c, 0) / confs.length) : anchor.conf,
    };
  });
}
