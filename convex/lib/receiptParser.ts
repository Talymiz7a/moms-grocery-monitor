// Turns merged OCR lines of an Israeli supermarket receipt into structured
// data. Heuristic and conservative: when something is unclear it is flagged
// for review, never invented. Pure functions, unit-tested.

import { parseDayFirstDate } from "./dates";
import { toAgorot } from "./money";
import type { ConvertedLine } from "./ocrSchema";
import { parseAmount, type MergedLine } from "./ocrMerge";

export type ParsedReceipt = {
  storeName?: string;
  purchaseDate?: string;
  dateText?: string;
  receiptNumber?: string;
  totalAgorot?: number;
  lines: (ConvertedLine & { sourceText: string })[];
  headerLowConfidence: string[];
  /** Lines in the item area that could not be understood (shown for manual entry). */
  unrecognized: string[];
  rawText: string;
  overallConfidence: "high" | "medium" | "low";
};

const HEB = /[א-ת]/;
const DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/;
// OCR sometimes splits a date into two words ("03 09.26"): allow a space as the first separator.
const LOOSE_DATE_RE = /(?<!\d)(\d{1,2})(?:[./-]|\s)(\d{1,2})[./-](\d{4}|\d{2})(?!\d)/;
const TOTAL_RE = /(לתשלום|סה["״']?כ|סהכ|סך הכל|total)/i;
const ITEM_COUNT_RE = /(פריטים|פריט|מס['׳]? פריטים)/;
const DISCOUNT_RE = /(הנחה|הנחת|מבצע|קופון|הטבה)/;
const RETURN_RE = /(החזרה|החזר|זיכוי)/;
const DEPOSIT_RE = /(פיקדון|פקדון)/;
const HEADER_RE = /(תאריך|שעה|קופה|קופאי|טל[:.]|ע\.?מ|ח\.?פ|עוסק|חשבונית|קבלה|סניף|כתובת|www|http)/;
const FOOTER_RE = /(מע["״']?מ|אשראי|ויזה|מזומן|עודף|כרטיס|שולם|תשלום ב|נקודות|מועדון חברים|תודה|להתראות|יתרה)/;
const KG_RE = /(ק["״']?ג|קג|קילו|kg)/i;
const UNIT_WORD_RE = /(יח['׳]?|יחידות|ית['׳]?)/;
// "X" between quantity and unit price is often read as Hebrew aleph or "*".
const TIMES_RE = /\s(?:[xX×*]|א)\s/;

function round(n: number, d: number) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

/** Recognizes a quantity line such as "2 יח' X 6.90" or "1.235 ק"ג X 7.90". */
export function parseQuantityLine(text: string): { quantity: number; unitPrice: number; weighed: boolean } | null {
  const t = ` ${text.replace(/,/g, ".")} `;
  if (!TIMES_RE.test(t) && !(UNIT_WORD_RE.test(t) || KG_RE.test(t))) return null;
  const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
  if (nums.length < 2) return null;
  const weighed = KG_RE.test(t);
  // Unit price: the number with exactly two decimals; quantity: another number.
  const priceIdx = nums.findIndex((n) => /^\d+\.\d{2}$/.test(n));
  if (priceIdx === -1) return null;
  const others = nums.filter((_, i) => i !== priceIdx);
  let qtyText = others.find((n) => /^\d+\.\d{1,3}$/.test(n)) ?? others[0];
  // A weight split by OCR into "1" and "235" (in either order) is re-joined.
  const whole = others.find((n) => /^\d$/.test(n));
  const frac = others.find((n) => /^\d{3}$/.test(n));
  let weighedGuess = weighed;
  if (!others.some((n) => n.includes(".")) && whole !== undefined && frac !== undefined) {
    qtyText = `${whole}.${frac}`;
    weighedGuess = true;
  }
  const quantity = Number(qtyText);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 200) return null;
  return { quantity, unitPrice: Number(nums[priceIdx]), weighed: weighedGuess };
}

function cleanDescription(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[^א-ת\dA-Za-z]+|[^א-ת\dA-Za-z%'"׳״)]+$/g, "")
    .trim();
}

/** Latin junk in a Hebrew receipt line usually means a misread Hebrew word. */
function looksGarbled(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const heb = (text.match(/[א-ת]/g) ?? []).length;
  return latin >= 3 && latin > heb / 2;
}

export function parseReceipt(lines: MergedLine[], rawText = lines.map((l) => l.raw).join("\n")): ParsedReceipt {
  const headerLow: string[] = [];
  const unrecognized: string[] = [];

  // --- Date: prefer a line that mentions "תאריך", otherwise the first valid date.
  let purchaseDate: string | undefined;
  let dateText: string | undefined;
  const dateLines = [...lines].sort((a, b) => Number(/תאריך/.test(b.raw)) - Number(/תאריך/.test(a.raw)));
  outer: for (const l of dateLines) {
    for (const [re, src, strict] of [[DATE_RE, l.raw, true], [DATE_RE, l.numericText, true], [LOOSE_DATE_RE, l.numericText, false]] as const) {
      const m = re.exec(src);
      if (!m) continue;
      const iso = parseDayFirstDate(`${m[1]}/${m[2]}/${m[3]}`);
      if (!iso) continue;
      const year = Number(iso.slice(0, 4));
      if (year < 2015 || year > new Date().getFullYear() + 1) continue;
      purchaseDate = iso;
      dateText = m[0];
      if (!strict || l.conf < 70) headerLow.push("purchaseDate");
      break outer;
    }
  }
  if (!purchaseDate) headerLow.push("purchaseDate");

  // --- Store: first Hebrew line at the top that is not a header field.
  const storeLine = lines.slice(0, 4).find((l) => HEB.test(l.text) && !HEADER_RE.test(l.raw) && l.amounts.length === 0);
  const storeName = storeLine ? cleanDescription(storeLine.text) : undefined;
  if (!storeName || (storeLine && storeLine.conf < 70)) headerLow.push("storeName");

  // --- Receipt number: digits after "קבלה" / "חשבונית" / "מס'".
  let receiptNumber: string | undefined;
  for (const l of lines.slice(0, 10)) {
    if (!/(קבלה|חשבונית|מס['׳]?\s)/.test(l.raw)) continue;
    const m = l.raw.match(/\b\d{2,3}-\d{3,8}\b|\b\d{4,10}\b/g)?.filter((x) => !DATE_RE.test(x));
    if (m?.length) {
      receiptNumber = m[m.length - 1];
      break;
    }
  }

  // --- Total: "לתשלום" wins over a generic "סה"כ"; item-count lines are ignored.
  let totalIdx = -1;
  let totalAgorot: number | undefined;
  const totalCandidates = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => TOTAL_RE.test(l.raw) && !ITEM_COUNT_RE.test(l.raw));
  const best = totalCandidates.find(({ l }) => /לתשלום/.test(l.raw)) ?? totalCandidates[0];
  if (best) {
    totalIdx = best.i;
    const amt = [...best.l.amounts].sort((a, b) => b.conf - a.conf)[0];
    if (amt) {
      totalAgorot = toAgorot(Math.abs(amt.value));
      if (amt.conf < 70) headerLow.push("total");
    } else headerLow.push("total");
  } else headerLow.push("total");

  // --- Item area: after the header, before the total (or payment lines).
  const firstItemIdx = lines.findIndex(
    (l, i) => i > 0 && l.amounts.length > 0 && HEB.test(l.text) && !HEADER_RE.test(l.raw) && !TOTAL_RE.test(l.raw),
  );
  // Layout where the first product's name has no amount (its quantity line carries it).
  let startIdx = firstItemIdx;
  if (firstItemIdx > 1) {
    const prev = lines[firstItemIdx - 1];
    if (HEB.test(prev.text) && prev.amounts.length === 0 && !HEADER_RE.test(prev.raw) && prev !== storeLine) startIdx = firstItemIdx - 1;
  }
  const endIdx = totalIdx >= 0 ? totalIdx : lines.findIndex((l, i) => i > firstItemIdx && FOOTER_RE.test(l.raw));
  const region = firstItemIdx >= 0 ? lines.slice(startIdx, endIdx >= 0 ? endIdx : lines.length) : [];

  const items: ParsedReceipt["lines"] = [];
  const hasQty = new Set<number>();
  const amountConfidence = new Map<ParsedReceipt["lines"][number], number>();
  // Two layouts exist: the quantity line under the description (no amount on
  // it), or a description without amount followed by a quantity line that
  // carries the line total. Both are handled; anything else is listed as
  // unrecognized instead of guessed.
  let pendingDesc: MergedLine | null = null;
  let pendingQty: { q: NonNullable<ReturnType<typeof parseQuantityLine>>; total: number; conf: number } | null = null;

  const attachQty = (idx: number, q: NonNullable<ReturnType<typeof parseQuantityLine>>, conf: number) => {
    const it = items[idx];
    hasQty.add(idx);
    const low = new Set(it.lowConfidenceFields);
    it.unit = q.weighed ? "kg" : "unit";
    it.unitPriceAgorot = toAgorot(q.unitPrice);
    const expected = q.quantity * q.unitPrice;
    const total = it.lineTotalAgorot / 100;
    const reproduces = (qty: number, price: number) => Math.abs(Math.round(qty * price * 100) / 100 - total) < 0.005;
    if (Math.abs(expected - total) <= 0.02) {
      it.quantity = q.quantity;
    } else if (q.unitPrice > 0 && total > 0) {
      // The printed line total (clean price column) is trusted. Either the
      // quantity or the unit price was misread: keep the correction that
      // reproduces the total exactly, and flag the corrected field.
      const derivedQty = total / q.unitPrice;
      // Weighed items keep three decimals; counted items snap to a whole number only when it reproduces the total.
      const whole = Math.round(derivedQty);
      const qtyCandidate = !q.weighed && whole > 0 && reproduces(whole, q.unitPrice) ? whole : round(derivedQty, 3);
      const priceCandidate = round(total / q.quantity, 2);
      const qtyWorks = qtyCandidate > 0 && reproduces(qtyCandidate, q.unitPrice);
      const priceWorks = priceCandidate > 0 && reproduces(q.quantity, priceCandidate);
      // A weight read with three decimals is more trustworthy than a whole number.
      const preferPrice = priceWorks && (!qtyWorks || !Number.isInteger(q.quantity));
      if (preferPrice) {
        it.quantity = q.quantity;
        it.unitPriceAgorot = toAgorot(priceCandidate);
        low.add("unitPrice");
      } else {
        it.quantity = qtyCandidate;
        low.add("quantity");
      }
    } else {
      it.quantity = q.quantity;
      low.add("quantity");
    }
    // Fractional quantities are weights.
    if (!Number.isInteger(it.quantity)) it.unit = "kg";
    if (conf < 70) low.add("quantity");
    it.lowConfidenceFields = [...low];
    it.confidence = low.size >= 2 ? "low" : low.size === 1 ? "medium" : it.confidence;
  };
  const flushDesc = () => {
    if (pendingDesc) unrecognized.push(pendingDesc.raw);
    pendingDesc = null;
  };

  for (const l of region) {
    const text = cleanDescription(l.text);
    if (!text && l.amounts.length === 0) continue;
    if (FOOTER_RE.test(l.raw) || ITEM_COUNT_RE.test(l.raw) || TOTAL_RE.test(l.raw)) continue;
    const amount = [...l.amounts].sort((a, b) => b.conf - a.conf)[0];
    // Quantity lines contain only numbers and short unit words; misread unit
    // words still leave just a few Hebrew letters.
    const hebLetters = (s: string) => (s.replace(UNIT_WORD_RE, "").replace(KG_RE, "").replace(/(^|\s)א(\s|$)/g, " ").match(/[\u05D0-\u05EA]/g) ?? []).length;
    const qText = parseQuantityLine(l.text);
    // The raw line also contains the line total from the price column: remove it
    // so it is not mistaken for the unit price.
    const rawNoAmounts = l.amounts.reduce((acc, a) => acc.replace(a.text, " "), l.raw);
    const qRaw = parseQuantityLine(rawNoAmounts);
    const q = qRaw && (!qText || hebLetters(l.raw) < hebLetters(l.text)) ? qRaw : qText ?? qRaw;
    const isQtyLine = q !== null && Math.min(hebLetters(l.text), hebLetters(l.raw)) <= 3 && !(amount && hebLetters(l.text) > 3);

    if (isQtyLine) {
      if (amount && pendingDesc) {
        items.push(makeItem(cleanDescription(pendingDesc.text), amount.value, amount.conf, pendingDesc));
        attachQty(items.length - 1, q!, Math.min(l.conf, amount.conf));
        pendingDesc = null;
      } else if (amount) {
        pendingQty = { q: q!, total: amount.value, conf: Math.min(l.conf, amount.conf) };
      } else if (pendingDesc) {
        // The amount on this quantity line was not read: compute it from
        // quantity × unit price and flag it for checking.
        const computed = Math.round(q!.quantity * q!.unitPrice * 100) / 100;
        items.push(makeItem(cleanDescription(pendingDesc.text), computed, 0, pendingDesc));
        attachQty(items.length - 1, q!, l.conf);
        pendingDesc = null;
      } else if (items.length && items[items.length - 1].lineType === "item" && !hasQty.has(items.length - 1)) {
        attachQty(items.length - 1, q!, l.conf);
      } else unrecognized.push(l.raw);
      continue;
    }
    if (!amount) {
      if (!HEB.test(text)) continue;
      if (pendingQty) {
        items.push(makeItem(text, pendingQty.total, pendingQty.conf, l));
        attachQty(items.length - 1, pendingQty.q, pendingQty.conf);
        pendingQty = null;
      } else {
        flushDesc();
        pendingDesc = l;
      }
      continue;
    }
    if (!HEB.test(text)) {
      unrecognized.push(l.raw);
      continue;
    }
    flushDesc();
    pendingQty = null;
    items.push(makeItem(text, amount.value, amount.conf, l));
  }
  flushDesc();

  function makeItem(desc: string, value: number, amountConf: number, l: MergedLine) {
    const low = new Set<string>();
    let lineType: ConvertedLine["lineType"] = "item";
    let total = value;
    if (DEPOSIT_RE.test(desc)) lineType = "deposit";
    else if (RETURN_RE.test(desc) && value < 0) lineType = "return";
    else if (DISCOUNT_RE.test(desc) || value < 0) {
      lineType = "discount";
      total = -Math.abs(value);
    }
    const descConf = l.tokens.length ? Math.min(...l.tokens.filter((t) => HEB.test(t.text)).map((t) => t.conf), 100) : 0;
    if (descConf < 60 || looksGarbled(desc)) low.add("description");
    // Amounts confirmed by two OCR passes get ≥ 90; a single-pass reading below 85 is checked.
    if (amountConf < 85) low.add("lineTotal");
    const confidence: ConvertedLine["confidence"] = low.size >= 2 ? "low" : low.size === 1 ? "medium" : "high";
    const item = {
      originalDescription: desc,
      lineType,
      quantity: lineType === "item" ? 1 : lineType === "return" ? -1 : 1,
      unit: "unit" as const,
      unitPriceAgorot: lineType === "item" ? toAgorot(Math.abs(total)) : undefined,
      lineTotalAgorot: toAgorot(total),
      confidence,
      lowConfidenceFields: [...low],
      sourceText: l.raw,
    };
    amountConfidence.set(item, amountConf);
    return item;
  }

  // When the lines do not add up to the printed total, every amount that was
  // not read identically and confidently is a suspect: flag it for checking.
  if (totalAgorot !== undefined && items.length) {
    const sum = items.reduce((s, i) => s + i.lineTotalAgorot - (i.discountAgorot ?? 0), 0);
    if (Math.abs(sum - totalAgorot) > 1) {
      for (const it of items) {
        if ((amountConfidence.get(it) ?? 0) >= 95) continue;
        const low = new Set(it.lowConfidenceFields);
        low.add("lineTotal");
        it.lowConfidenceFields = [...low];
        it.confidence = low.size >= 2 ? "low" : "medium";
      }
    }
  }

  // A single item price defaults to quantity 1 × price; mark single-item
  // unit prices as derived only when a quantity line was never seen.
  const lowCount = items.filter((i) => i.confidence === "low").length;
  const overall: ParsedReceipt["overallConfidence"] =
    items.length === 0 || headerLow.includes("total") || lowCount > items.length / 3 ? "low" : lowCount > 0 || headerLow.length ? "medium" : "high";

  return {
    storeName,
    purchaseDate,
    dateText,
    receiptNumber,
    totalAgorot,
    lines: items,
    headerLowConfidence: [...new Set(headerLow)],
    unrecognized,
    rawText,
    overallConfidence: overall,
  };
}

// Re-exported for the UI.
export { parseAmount };
