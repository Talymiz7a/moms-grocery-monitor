// Purchase analytics on plain data (no database access), so every rule is
// unit-testable.
//
// Definitions (from the specification):
// - Purchase frequency / occasion: the number of DISTINCT receipts that
//   contain a product. Six units on one receipt, or several lines of the same
//   product on one receipt, are ONE purchase occasion.
// - Quantity: summed units, in the product's own unit. Incompatible units are
//   never added together; they are reported separately.
// - Line appearances: the number of receipt lines.
// Only verified receipts with a purchase date and lines whose product identity
// was confirmed are counted.

export type Unit = "unit" | "kg" | "g" | "l" | "ml" | "pack";

export type FactReceipt = {
  id: string;
  date: string; // ISO
  storeName?: string;
  totalAgorot?: number;
  computedTotalAgorot?: number;
  itemCount: number;
};

export type FactItem = {
  receiptId: string;
  productId: string;
  lineType: "item" | "discount" | "return" | "deposit";
  quantity: number;
  unit: Unit;
  unitPriceAgorot?: number;
  lineTotalAgorot: number;
  discountAgorot?: number;
};

export type FactProduct = {
  id: string;
  name: string;
  unit: Unit;
  packageSize?: number;
  packageUnit?: Unit;
  category?: string;
};

export type Occasion = {
  receiptId: string;
  productId: string;
  date: string;
  month: string; // YYYY-MM
  storeName?: string;
  /** Net quantity in the product's unit (purchases minus same-receipt returns). */
  quantity: number;
  /** Lines whose unit could not be converted to the product's unit. */
  incompatibleLines: number;
  lineCount: number;
  /** Net amount paid for this product on this receipt (line totals minus line discounts). */
  spendAgorot: number;
  /** Net price per product unit, when it can be computed. */
  unitPriceAgorot: number | null;
  /** Price per kg / litre / single item, for comparing package sizes. */
  standardPrice: { agorot: number; per: "kg" | "l" | "unit" } | null;
};

const CONVERSIONS: Record<string, number> = {
  "g>kg": 0.001,
  "kg>g": 1000,
  "ml>l": 0.001,
  "l>ml": 1000,
};

/** Converts a quantity between units. Returns null when no reliable conversion exists. */
export function convertQuantity(q: number, from: Unit, to: Unit): number | null {
  if (from === to) return q;
  const f = CONVERSIONS[`${from}>${to}`];
  return f === undefined ? null : q * f;
}

/** Price per kg / litre / item for a product unit price, using the package size. */
export function standardPrice(product: FactProduct, unitPriceAgorot: number): Occasion["standardPrice"] {
  if (product.unit === "kg") return { agorot: unitPriceAgorot, per: "kg" };
  if (product.unit === "g") return { agorot: unitPriceAgorot * 1000, per: "kg" };
  if (product.unit === "l") return { agorot: unitPriceAgorot, per: "l" };
  if (product.unit === "ml") return { agorot: unitPriceAgorot * 1000, per: "l" };
  if (!product.packageSize || !product.packageUnit) return null;
  const size = product.packageSize;
  switch (product.packageUnit) {
    case "kg":
      return { agorot: unitPriceAgorot / size, per: "kg" };
    case "g":
      return { agorot: (unitPriceAgorot / size) * 1000, per: "kg" };
    case "l":
      return { agorot: unitPriceAgorot / size, per: "l" };
    case "ml":
      return { agorot: (unitPriceAgorot / size) * 1000, per: "l" };
    case "unit":
      return { agorot: unitPriceAgorot / size, per: "unit" };
    default:
      return null;
  }
}

/** Groups confirmed item lines into purchase occasions (one per receipt × product). */
export function buildOccasions(receipts: FactReceipt[], items: FactItem[], products: FactProduct[]): Occasion[] {
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, FactItem[]>();
  for (const it of items) {
    if (it.lineType !== "item" && it.lineType !== "return") continue;
    if (!receiptById.has(it.receiptId) || !productById.has(it.productId)) continue;
    const key = `${it.receiptId}|${it.productId}`;
    const g = groups.get(key);
    if (g) g.push(it);
    else groups.set(key, [it]);
  }
  const out: Occasion[] = [];
  for (const [key, lines] of groups) {
    const [receiptId, productId] = key.split("|");
    const r = receiptById.get(receiptId)!;
    const p = productById.get(productId)!;
    let quantity = 0;
    let incompatible = 0;
    let spend = 0;
    let purchasedLines = 0;
    for (const l of lines) {
      const q = convertQuantity(l.quantity, l.unit, p.unit);
      if (q === null) incompatible++;
      else quantity += q;
      spend += l.lineTotalAgorot - (l.discountAgorot ?? 0);
      if (l.lineType === "item") purchasedLines++;
    }
    // A product only returned (never bought) on this receipt is not a purchase occasion.
    if (purchasedLines === 0 || quantity <= 0) continue;
    const unitPrice = incompatible === 0 && quantity > 0 ? Math.round(spend / quantity) : null;
    out.push({
      receiptId,
      productId,
      date: r.date,
      month: r.date.slice(0, 7),
      storeName: r.storeName,
      quantity: Math.round(quantity * 1000) / 1000,
      incompatibleLines: incompatible,
      lineCount: lines.filter((l) => l.lineType === "item").length,
      spendAgorot: spend,
      unitPriceAgorot: unitPrice,
      standardPrice: unitPrice === null ? null : standardPrice(p, unitPrice),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.receiptId.localeCompare(b.receiptId));
}

export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/** Products × 12 months grid of purchase occasions (and quantities) for a year. */
export function monthlyGrid(occasions: Occasion[], products: FactProduct[], year: number) {
  const months = monthsOfYear(year);
  const idx = new Map(months.map((m, i) => [m, i]));
  const rows = new Map<string, { occasions: number[]; quantity: number[]; lines: number[] }>();
  for (const o of occasions) {
    const i = idx.get(o.month);
    if (i === undefined) continue;
    let row = rows.get(o.productId);
    if (!row) {
      row = { occasions: Array(12).fill(0), quantity: Array(12).fill(0), lines: Array(12).fill(0) };
      rows.set(o.productId, row);
    }
    row.occasions[i] += 1;
    row.quantity[i] += o.quantity;
    row.lines[i] += o.lineCount;
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  return [...rows.entries()]
    .map(([productId, r]) => {
      const p = productById.get(productId)!;
      return {
        productId,
        name: p.name,
        unit: p.unit,
        occasions: r.occasions,
        quantity: r.quantity.map((q) => Math.round(q * 1000) / 1000),
        lines: r.lines,
        totalOccasions: r.occasions.reduce((s, n) => s + n, 0),
      };
    })
    .sort((a, b) => b.totalOccasions - a.totalOccasions || a.name.localeCompare(b.name, "he"));
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Month keys from `first` to `last` inclusive ("2026-06" … "2026-10"). */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const endKey = last.slice(0, 7);
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= endKey) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * History for one product: every purchase occasion, days between consecutive
 * purchases, and month-by-month statistics compared with the average of the
 * preceding months (up to three).
 * `datasetFirstMonth`/`datasetLastMonth` bound the months shown, so months with
 * no purchase appear as zero rather than being skipped.
 */
export function productHistory(
  occasions: Occasion[],
  productId: string,
  datasetFirstMonth: string | null,
  datasetLastMonth: string | null,
) {
  const own = occasions.filter((o) => o.productId === productId);
  const withIntervals = own.map((o, i) => ({
    ...o,
    daysSincePrevious: i === 0 ? null : daysBetween(own[i - 1].date, o.date),
  }));
  const intervals = withIntervals.map((o) => o.daysSincePrevious).filter((d): d is number => d !== null);
  const months =
    datasetFirstMonth && datasetLastMonth ? monthRange(datasetFirstMonth, datasetLastMonth) : [...new Set(own.map((o) => o.month))];
  const monthly = months.map((month) => {
    const os = own.filter((o) => o.month === month);
    const prices = os.map((o) => o.unitPriceAgorot).filter((p): p is number => p !== null);
    return {
      month,
      occasions: os.length,
      quantity: Math.round(os.reduce((s, o) => s + o.quantity, 0) * 1000) / 1000,
      spendAgorot: os.reduce((s, o) => s + o.spendAgorot, 0),
      avgUnitPriceAgorot: prices.length ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : null,
    };
  });
  const firstPurchaseMonth = own[0]?.month;
  const monthlyWithComparison = monthly.map((m, i) => {
    // Compare only with months since the product was first bought.
    const prior = monthly.slice(Math.max(0, i - 3), i).filter((p) => firstPurchaseMonth !== undefined && p.month >= firstPurchaseMonth);
    if (prior.length === 0) return { ...m, priorAvgOccasions: null, priorAvgQuantity: null, priorMonths: 0 };
    return {
      ...m,
      priorAvgOccasions: Math.round((prior.reduce((s, p) => s + p.occasions, 0) / prior.length) * 10) / 10,
      priorAvgQuantity: Math.round((prior.reduce((s, p) => s + p.quantity, 0) / prior.length) * 100) / 100,
      priorMonths: prior.length,
    };
  });
  return {
    occasions: withIntervals,
    monthly: monthlyWithComparison,
    summary: {
      totalOccasions: own.length,
      totalQuantity: Math.round(own.reduce((s, o) => s + o.quantity, 0) * 1000) / 1000,
      totalLines: own.reduce((s, o) => s + o.lineCount, 0),
      totalSpendAgorot: own.reduce((s, o) => s + o.spendAgorot, 0),
      firstDate: own[0]?.date ?? null,
      lastDate: own[own.length - 1]?.date ?? null,
      medianIntervalDays: median(intervals),
      minIntervalDays: intervals.length ? Math.min(...intervals) : null,
      incompatibleLines: own.reduce((s, o) => s + o.incompatibleLines, 0),
    },
  };
}
