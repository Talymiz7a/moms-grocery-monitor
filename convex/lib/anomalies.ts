// Transparent, configurable anomaly detection.
//
// Every candidate alert carries a plain-Hebrew explanation, the evidence it
// was based on (dates, quantities, receipts) and the baseline it was compared
// with. Three kinds of basis are kept apart:
//   - "rule":        a threshold the family configured (expected shopping list)
//   - "statistical": unusual compared with this product's own history
//   - "notice":      informational (e.g. a product bought for the first time)
// Historical comparisons are only made when there is enough prior data;
// otherwise no statistical alert is raised and rule alerts are marked as
// "limited evidence". An alert is never an accusation: it asks a person to look.

import { formatIsoDate, HEBREW_MONTHS } from "./dates";
import { median, type Occasion } from "./analytics";

export type Sensitivity = "low" | "medium" | "high";
export type AlertType =
  | "excessive_frequency"
  | "large_quantity"
  | "close_interval"
  | "new_product"
  | "not_expected"
  | "duplicate_receipt"
  | "high_total";

/** How far from the usual pattern something must be before it is flagged. */
export const SENSITIVITY: Record<
  Sensitivity,
  { k: number; freqRatio: number; qtyMult: number; intervalFrac: number; rareShare: number; totalK: number; label: string }
> = {
  low: { k: 3, freqRatio: 2, qtyMult: 3, intervalFrac: 0.2, rareShare: 0.05, totalK: 3.5, label: "נמוכה (רק חריגות בולטות)" },
  medium: { k: 2, freqRatio: 1.5, qtyMult: 2, intervalFrac: 0.3, rareShare: 0.1, totalK: 2.5, label: "בינונית" },
  high: { k: 1.5, freqRatio: 1.3, qtyMult: 1.5, intervalFrac: 0.4, rareShare: 0.15, totalK: 2, label: "גבוהה (מתריע מוקדם יותר)" },
};

/** Minimum history before a statistical comparison is made. */
export const MIN_HISTORY = { months: 3, occasions: 5, intervals: 5, receipts: 8, newProductWarmupDays: 30 };

export type ProductInfo = { id: string; name: string; unit: string; expectedUse: "expected" | "occasional" | "not_expected" | "manual_review" };
export type ExpectationInfo = {
  productId: string;
  maxPerMonth?: number;
  minIntervalDays?: number;
  quantityMin?: number;
  quantityMax?: number;
};
export type ReceiptInfo = {
  id: string;
  date?: string;
  storeName?: string;
  totalAgorot?: number;
  computedTotalAgorot?: number;
  itemCount: number;
  verified: boolean;
  duplicateOfId?: string;
  duplicateReason?: string;
  duplicateOverride?: boolean;
};

export type AlertCandidate = {
  type: AlertType;
  basis: "rule" | "statistical" | "notice";
  productId?: string;
  receiptIds: string[];
  periodStart?: string;
  periodEnd?: string;
  reason: string;
  evidence: Record<string, unknown>;
  /** Only the facts that define the event; used to decide whether to reopen. */
  evidenceKey: string;
  limitedEvidence: boolean;
  severity: "low" | "medium" | "high";
  dedupeKey: string;
};

const monthName = (key: string) => `${HEBREW_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const times = (n: number) => (n === 1 ? "פעם אחת" : n === 2 ? "פעמיים" : `${n} פעמים`);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const fmtQty = (n: number) => n.toLocaleString("he-IL", { maximumFractionDigits: 2 });
const UNIT: Record<string, string> = { unit: "יח'", kg: 'ק"ג', g: "גרם", l: "ליטר", ml: 'מ"ל', pack: "אריזות" };

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  for (let i = 0; i < 600; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= last) break;
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function meanSd(xs: number[]) {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  return { mean, sd };
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function detectAnomalies(input: {
  occasions: Occasion[];
  products: ProductInfo[];
  expectations: ExpectationInfo[];
  receipts: ReceiptInfo[];
  sensitivity: Sensitivity;
}): AlertCandidate[] {
  const { occasions, products, expectations, receipts, sensitivity } = input;
  const S = SENSITIVITY[sensitivity];
  const out: AlertCandidate[] = [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const expByProduct = new Map(expectations.map((e) => [e.productId, e]));
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const datedVerified = receipts.filter((r) => r.verified && r.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const datasetFirst = datedVerified[0]?.date;
  const datasetLastMonth = datedVerified[datedVerified.length - 1]?.date?.slice(0, 7);
  const store = (id: string) => receiptById.get(id)?.storeName ?? "";

  const byProduct = new Map<string, Occasion[]>();
  for (const o of occasions) {
    const list = byProduct.get(o.productId);
    if (list) list.push(o);
    else byProduct.set(o.productId, [o]);
  }

  for (const [productId, own] of byProduct) {
    const p = productById.get(productId);
    if (!p) continue;
    const exp = expByProduct.get(productId);
    const unit = UNIT[p.unit] ?? "";

    // (1) Excessive frequency per month.
    const firstMonth = own[0].month;
    const months = datasetLastMonth ? monthsBetween(firstMonth, datasetLastMonth) : [];
    const countBy = new Map<string, Occasion[]>();
    for (const o of own) countBy.set(o.month, [...(countBy.get(o.month) ?? []), o]);
    months.forEach((month, i) => {
      const os = countBy.get(month) ?? [];
      const count = os.length;
      if (count === 0) return;
      const prior = months.slice(0, i).map((m) => countBy.get(m)?.length ?? 0);
      const enough = prior.length >= MIN_HISTORY.months;
      const stats = enough ? meanSd(prior) : null;
      const threshold = stats ? stats.mean + S.k * Math.max(stats.sd, 0.5) : null;
      const statHit =
        stats !== null && threshold !== null && count > threshold && count >= stats.mean + 2 && count >= stats.mean * S.freqRatio;
      const ruleHit = exp?.maxPerMonth !== undefined && count > exp.maxPerMonth;
      if (!statHit && !ruleHit) return;
      const baselineText = stats ? `בחודשים הקודמים: ממוצע ${round(stats.mean, 1)} בחודש (${prior.length} חודשים)` : "אין מספיק חודשים קודמים להשוואה";
      out.push({
        type: "excessive_frequency",
        basis: ruleHit ? "rule" : "statistical",
        productId,
        receiptIds: os.map((o) => o.receiptId),
        periodStart: `${month}-01`,
        periodEnd: os[os.length - 1].date,
        reason: ruleHit
          ? `${p.name}: נקנה ${times(count)} ב${monthName(month)} — מעל המקסימום שהוגדר (${exp!.maxPerMonth} בחודש)`
          : `${p.name}: נקנה ${times(count)} ב${monthName(month)} — יותר מהרגיל (${baselineText})`,
        evidence: {
          month,
          count,
          dates: os.map((o) => o.date),
          quantities: os.map((o) => o.quantity),
          unit: p.unit,
          baseline: stats ? { meanPerMonth: round(stats.mean, 2), sd: round(stats.sd, 2), priorMonths: prior.length, threshold: round(threshold!, 2) } : null,
          rule: ruleHit ? { maxPerMonth: exp!.maxPerMonth } : null,
          explanation: baselineText,
        },
        evidenceKey: `${count}|${os.map((o) => o.receiptId).sort().join(",")}`,
        limitedEvidence: !enough,
        severity: ruleHit && count >= 2 * exp!.maxPerMonth! ? "high" : "medium",
        dedupeKey: `excessive_frequency:${productId}:${month}`,
      });
    });

    // (2) Unusually large quantity and (3) purchases unusually close together.
    own.forEach((o, i) => {
      const prior = own.slice(0, i);
      // Large quantity
      const priorQty = prior.map((x) => x.quantity);
      const enoughQ = priorQty.length >= MIN_HISTORY.occasions;
      const med = enoughQ ? median(priorQty)! : null;
      const statQ = med !== null && med > 0 && o.quantity >= med * S.qtyMult && o.quantity > Math.max(...priorQty);
      const ruleQ = exp?.quantityMax !== undefined && o.quantity > exp.quantityMax;
      if (statQ || ruleQ) {
        const baselineText = med !== null ? `בדרך כלל ${fmtQty(med)} ${unit} בקנייה (חציון של ${priorQty.length} רכישות)` : "אין מספיק רכישות קודמות להשוואה";
        out.push({
          type: "large_quantity",
          basis: ruleQ ? "rule" : "statistical",
          productId,
          receiptIds: [o.receiptId],
          periodStart: o.date,
          periodEnd: o.date,
          reason: ruleQ
            ? `${p.name}: ${fmtQty(o.quantity)} ${unit} בקנייה אחת (${formatIsoDate(o.date)}) — מעל הטווח שהוגדר (עד ${exp!.quantityMax})`
            : `${p.name}: ${fmtQty(o.quantity)} ${unit} בקנייה אחת (${formatIsoDate(o.date)}) — ${baselineText}`,
          evidence: {
            date: o.date,
            store: store(o.receiptId),
            quantity: o.quantity,
            unit: p.unit,
            lineCount: o.lineCount,
            baseline: med !== null ? { medianQuantity: med, priorOccasions: priorQty.length, maxPrior: Math.max(...priorQty), multiplier: S.qtyMult } : null,
            rule: ruleQ ? { quantityMax: exp!.quantityMax } : null,
            explanation: baselineText,
          },
          evidenceKey: `${o.receiptId}|${o.quantity}`,
          limitedEvidence: !enoughQ,
          severity: ruleQ && o.quantity >= 2 * exp!.quantityMax! ? "high" : "medium",
          dedupeKey: `large_quantity:${o.receiptId}:${productId}`,
        });
      }

      // Close interval
      if (i === 0) return;
      const prev = own[i - 1];
      const days = daysBetween(prev.date, o.date);
      const priorIntervals = prior.slice(1).map((x, j) => daysBetween(prior[j].date, x.date));
      const enoughI = priorIntervals.length >= MIN_HISTORY.intervals;
      const medI = enoughI ? median(priorIntervals)! : null;
      // Statistical: much shorter than usual AND such short gaps are rare in this product's own history.
      const shortShare = enoughI ? priorIntervals.filter((d) => d <= days).length / priorIntervals.length : 1;
      const statI = medI !== null && medI >= 3 && days < medI * S.intervalFrac && shortShare < S.rareShare;
      const ruleI = exp?.minIntervalDays !== undefined && days < exp.minIntervalDays;
      if (!statI && !ruleI) return;
      const baselineText = medI !== null ? `בדרך כלל ${medI} ימים בין רכישות (חציון)` : "אין מספיק רכישות קודמות להשוואה";
      out.push({
        type: "close_interval",
        basis: ruleI ? "rule" : "statistical",
        productId,
        receiptIds: [prev.receiptId, o.receiptId],
        periodStart: prev.date,
        periodEnd: o.date,
        reason:
          (days === 0
            ? `${p.name}: נקנה פעמיים באותו יום (${formatIsoDate(o.date)}) בשתי קבלות שונות`
            : `${p.name}: נקנה שוב אחרי ${days} ימים בלבד (${formatIsoDate(prev.date)} ← ${formatIsoDate(o.date)})`) +
          (ruleI ? ` — פחות מהמרווח המינימלי שהוגדר (${exp!.minIntervalDays} ימים)` : ` — ${baselineText}`),
        evidence: {
          previousDate: prev.date,
          date: o.date,
          days,
          previousQuantity: prev.quantity,
          quantity: o.quantity,
          unit: p.unit,
          stores: [store(prev.receiptId), store(o.receiptId)],
          baseline: medI !== null ? { medianIntervalDays: medI, priorIntervals: priorIntervals.length, fraction: S.intervalFrac, shareAsShort: round(shortShare, 2) } : null,
          rule: ruleI ? { minIntervalDays: exp!.minIntervalDays } : null,
          explanation: baselineText,
        },
        evidenceKey: `${prev.receiptId}|${o.receiptId}|${days}`,
        limitedEvidence: !enoughI,
        severity: "medium",
        dedupeKey: `close_interval:${o.receiptId}:${productId}`,
      });
    });

    // (4) New product (after a warm-up period, so the first weeks of data are not all "new").
    const first = own[0];
    if (datasetFirst && daysBetween(datasetFirst, first.date) > MIN_HISTORY.newProductWarmupDays) {
      out.push({
        type: "new_product",
        basis: "notice",
        productId,
        receiptIds: [first.receiptId],
        periodStart: first.date,
        periodEnd: first.date,
        reason: `מוצר חדש: ${p.name} נקנה לראשונה ב-${formatIsoDate(first.date)}`,
        evidence: {
          firstDate: first.date,
          quantity: first.quantity,
          unit: p.unit,
          store: store(first.receiptId),
          laterOccasions: own.length - 1,
          explanation: `לא נקנה לפני כן מאז תחילת הנתונים (${formatIsoDate(datasetFirst)}). מספר רכישות מאז: ${own.length - 1}.`,
        },
        evidenceKey: first.receiptId,
        limitedEvidence: true,
        severity: "low",
        dedupeKey: `new_product:${productId}`,
      });
    }

    // (5) Products not normally expected for her / marked for manual review.
    if (p.expectedUse === "not_expected" || p.expectedUse === "manual_review") {
      for (const [month, os] of countBy) {
        out.push({
          type: "not_expected",
          basis: "rule",
          productId,
          receiptIds: os.map((o) => o.receiptId),
          periodStart: os[0].date,
          periodEnd: os[os.length - 1].date,
          reason:
            p.expectedUse === "not_expected"
              ? `${p.name} — מסומן כמוצר שבדרך כלל אינו צפוי עבורה; נקנה ${times(os.length)} ב${monthName(month)}`
              : `${p.name} — מסומן לבדיקה ידנית; נקנה ${times(os.length)} ב${monthName(month)}`,
          evidence: {
            month,
            dates: os.map((o) => o.date),
            quantities: os.map((o) => o.quantity),
            unit: p.unit,
            stores: os.map((o) => store(o.receiptId)),
            expectedUse: p.expectedUse,
            explanation: "הסיווג נקבע ידנית ברשימת הקניות הצפויה. אין בכך הסקה לגבי השימוש במוצר.",
          },
          evidenceKey: os.map((o) => `${o.receiptId}:${o.quantity}`).sort().join(","),
          limitedEvidence: false,
          severity: p.expectedUse === "not_expected" ? "medium" : "low",
          dedupeKey: `not_expected:${productId}:${month}`,
        });
      }
    }
  }

  // (6) Possible duplicate receipts (until a person overrides).
  for (const r of receipts) {
    if (!r.duplicateOfId || r.duplicateOverride) continue;
    const orig = receiptById.get(r.duplicateOfId);
    out.push({
      type: "duplicate_receipt",
      basis: "rule",
      receiptIds: [r.id, r.duplicateOfId],
      periodStart: r.date,
      periodEnd: r.date,
      reason: `קבלה שייתכן שהיא כפולה: ${r.storeName ?? "חנות לא ידועה"} ${r.date ? formatIsoDate(r.date) : ""} — ${r.duplicateReason ?? ""}`.trim(),
      evidence: {
        reason: r.duplicateReason,
        receipt: { date: r.date, store: r.storeName, totalAgorot: r.totalAgorot, itemCount: r.itemCount },
        original: orig ? { date: orig.date, store: orig.storeName, totalAgorot: orig.totalAgorot, itemCount: orig.itemCount } : null,
        explanation: "הקבלה לא תיספר עד שיאושר שאינה כפולה. ניתן לסמן 'אינה כפולה' או למחוק אותה.",
      },
      evidenceKey: `${r.id}|${r.duplicateOfId}`,
      limitedEvidence: false,
      severity: "medium",
      dedupeKey: `duplicate_receipt:${r.id}`,
    });
  }

  // (7) Unusually high receipt totals, read together with basket size.
  datedVerified.forEach((r, i) => {
    const total = r.totalAgorot ?? r.computedTotalAgorot;
    if (total === undefined) return;
    // Compare only with the same store's earlier receipts: a weekly shop and a
    // small top-up are different kinds of purchase. Without enough history at
    // that store, no comparison is made.
    const prior = datedVerified
      .slice(0, i)
      .filter((x) => (x.totalAgorot ?? x.computedTotalAgorot) !== undefined && x.storeName && x.storeName === r.storeName);
    const scope = "בחנות זו";
    if (prior.length < MIN_HISTORY.receipts) return;
    const totals = prior.map((x) => (x.totalAgorot ?? x.computedTotalAgorot)!);
    const med = median(totals)!;
    const mad = Math.max(median(totals.map((t) => Math.abs(t - med)))!, 1000);
    const threshold = med + S.totalK * 1.4826 * mad;
    if (total <= threshold) return;
    const counts = prior.map((x) => x.itemCount).sort((a, b) => a - b);
    const p90 = counts[Math.floor(0.9 * (counts.length - 1))];
    const medCount = median(counts)!;
    const largeBasket = r.itemCount > p90;
    const perItem = r.itemCount ? total / r.itemCount : total;
    const medPerItem = median(prior.map((x) => ((x.totalAgorot ?? x.computedTotalAgorot)! / Math.max(x.itemCount, 1))))!;
    const ils = (a: number) => `₪${(a / 100).toFixed(2)}`;
    out.push({
      type: "high_total",
      basis: "statistical",
      receiptIds: [r.id],
      periodStart: r.date,
      periodEnd: r.date,
      reason:
        `סכום קבלה גבוה: ${ils(total)} ב${r.storeName ?? "חנות"} (${formatIsoDate(r.date)}) — הסכום הרגיל ${scope} ${ils(med)}` +
        (largeBasket ? `; גם הסל גדול מהרגיל (${r.itemCount} שורות לעומת ${medCount})` : `; מספר השורות רגיל (${r.itemCount} לעומת ${medCount})`),
      evidence: {
        date: r.date,
        store: r.storeName,
        totalAgorot: total,
        itemCount: r.itemCount,
        baseline: { scope, medianTotalAgorot: med, thresholdAgorot: Math.round(threshold), priorReceipts: prior.length, medianItemCount: medCount, p90ItemCount: p90, medianPerItemAgorot: Math.round(medPerItem), perItemAgorot: Math.round(perItem) },
        explanation: largeBasket ? "הסכום הגבוה מוסבר לפחות בחלקו בסל גדול." : "הסכום גבוה בלי שהסל גדול במיוחד — כדאי לבדוק אילו פריטים יקרים במיוחד.",
      },
      evidenceKey: `${r.id}|${total}|${r.itemCount}`,
      limitedEvidence: false,
      severity: largeBasket ? "low" : "medium",
      dedupeKey: `high_total:${r.id}`,
    });
  });

  return out;
}

/** Small stable hash for comparing evidence between runs. */
export function hashEvidence(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
