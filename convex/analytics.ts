import { v } from "convex/values";
import { query } from "./_generated/server";
import { datasetValidator } from "./schema";
import { requireDatasetRead } from "./lib/access";
import { monthlyGrid, productHistory } from "./lib/analytics";
import { loadFacts } from "./lib/facts";

/** Years that have verified purchases, newest first. */
export const years = query({
  args: { dataset: datasetValidator, editorCode: v.optional(v.string()) },
  handler: async (ctx, { editorCode, dataset }) => {
    requireDatasetRead(dataset, editorCode);
    const { receipts } = await loadFacts(ctx, dataset);
    return [...new Set(receipts.map((r) => Number(r.date.slice(0, 4))))].sort((a, b) => b - a);
  },
});

/** Products × 12 months: purchase occasions (distinct receipts), quantities and line appearances. */
export const monthlyFrequency = query({
  args: { dataset: datasetValidator, editorCode: v.optional(v.string()), year: v.number() },
  handler: async (ctx, { editorCode, dataset, year }) => {
    requireDatasetRead(dataset, editorCode);
    const { occasions, products } = await loadFacts(ctx, dataset);
    return monthlyGrid(occasions, products, year);
  },
});

export const productDetail = query({
  args: { dataset: datasetValidator, editorCode: v.optional(v.string()), productId: v.id("products") },
  handler: async (ctx, { editorCode, dataset, productId }) => {
    requireDatasetRead(dataset, editorCode);
    const product = await ctx.db.get(productId);
    if (!product || product.dataset !== dataset) return null;
    if (product.mergedIntoId) return { mergedIntoId: product.mergedIntoId };
    const facts = await loadFacts(ctx, dataset);
    const history = productHistory(facts.occasions, productId, facts.firstMonth, facts.lastMonth);
    const expectation = await ctx.db
      .query("productExpectations")
      .withIndex("by_dataset_product", (q) => q.eq("dataset", dataset).eq("productId", productId))
      .first();
    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_dataset_status", (q) => q.eq("dataset", dataset))
      .filter((q) => q.eq(q.field("productId"), productId))
      .collect();
    return {
      product: {
        _id: product._id,
        canonicalName: product.canonicalName,
        aliases: product.aliases,
        category: product.category,
        unit: product.unit,
        packageSize: product.packageSize,
        packageUnit: product.packageUnit,
        expectedUse: product.expectedUse,
        notes: product.notes,
      },
      expectation: expectation
        ? {
            usualQuantity: expectation.usualQuantity,
            usualUnit: expectation.usualUnit,
            expectedIntervalDays: expectation.expectedIntervalDays,
            maxPerMonth: expectation.maxPerMonth,
            minIntervalDays: expectation.minIntervalDays,
            quantityMin: expectation.quantityMin,
            quantityMax: expectation.quantityMax,
            notes: expectation.notes,
          }
        : null,
      ...history,
      alerts: alerts.map((a) => ({ _id: a._id, type: a.type, status: a.status, severity: a.severity, reason: a.reason, periodStart: a.periodStart })),
    };
  },
});

function inRange(d: string | undefined, from?: string, to?: string) {
  if (!d) return false;
  return (!from || d >= from) && (!to || d <= to);
}

function overlaps(a: { periodStart?: string; periodEnd?: string }, from?: string, to?: string) {
  const s = a.periodStart ?? a.periodEnd;
  const e = a.periodEnd ?? a.periodStart;
  if (!s || !e) return !from && !to;
  return (!from || e >= from) && (!to || s <= to);
}

/** Dashboard numbers for a period (all verified receipts when no period is given). */
export const periodSummary = query({
  args: { dataset: datasetValidator, editorCode: v.optional(v.string()), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { editorCode, dataset, from, to }) => {
    requireDatasetRead(dataset, editorCode);
    const facts = await loadFacts(ctx, dataset);
    const receipts = facts.receipts.filter((r) => inRange(r.date, from, to));
    const occasions = facts.occasions.filter((o) => inRange(o.date, from, to));
    const productName = new Map(facts.products.map((p) => [p.id, p]));
    const months = [...new Set(receipts.map((r) => r.date.slice(0, 7)))].sort();
    const monthKeys = months.length ? monthRangeKeys(months[0], months[months.length - 1]) : [];
    const monthly = monthKeys.map((m) => ({
      month: m,
      occasions: occasions.filter((o) => o.month === m).length,
      receipts: receipts.filter((r) => r.date.startsWith(m)).length,
    }));
    const byProduct = new Map<string, { occasions: number; quantity: number }>();
    for (const o of occasions) {
      const e = byProduct.get(o.productId) ?? { occasions: 0, quantity: 0 };
      e.occasions++;
      e.quantity += o.quantity;
      byProduct.set(o.productId, e);
    }
    const top = [...byProduct.entries()]
      .map(([id, e]) => ({ productId: id, name: productName.get(id)?.name ?? "", unit: productName.get(id)?.unit ?? "unit", occasions: e.occasions, quantity: Math.round(e.quantity * 100) / 100 }))
      .sort((a, b) => b.occasions - a.occasions || a.name.localeCompare(b.name, "he"))
      .slice(0, 8);
    const alerts = await ctx.db.query("alerts").withIndex("by_dataset_status", (q) => q.eq("dataset", dataset)).collect();
    const openInPeriod = alerts.filter((a) => a.status !== "explained" && !a.inactive && overlaps(a, from, to));
    const sev = { high: 0, medium: 1, low: 2 };
    const drafts = facts.receiptDocs.filter((r) => r.verificationStatus === "draft");
    const recent = [...facts.receiptDocs]
      .filter((r) => r.verificationStatus === "verified" && inRange(r.purchaseDate, from, to))
      .sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""))
      .slice(0, 6)
      .map((r) => ({ _id: r._id, purchaseDate: r.purchaseDate, storeName: r.storeName, totalAgorot: r.totalAgorot, itemCount: r.itemCount ?? 0 }));
    const dates = facts.receipts.map((r) => r.date).sort();
    return {
      dataFrom: dates[0] ?? null,
      dataTo: dates[dates.length - 1] ?? null,
      months: [...new Set(dates.map((d) => d.slice(0, 7)))].sort().reverse(),
      receiptCount: receipts.length,
      distinctProducts: byProduct.size,
      purchaseOccasions: occasions.length,
      totalSpendAgorot: receipts.reduce((s, r) => s + (r.totalAgorot ?? r.computedTotalAgorot ?? 0), 0),
      openAlertCount: openInPeriod.length,
      monthly,
      top,
      unusual: openInPeriod
        .sort((a, b) => sev[a.severity] - sev[b.severity] || (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""))
        .slice(0, 6)
        .map((a) => ({ _id: a._id, type: a.type, severity: a.severity, status: a.status, reason: a.reason, basis: a.basis })),
      recent,
      draftCount: drafts.length,
      needsReview: drafts
        .sort((a, b) => b.uploadedAt - a.uploadedAt)
        .slice(0, 5)
        .map((r) => ({ _id: r._id, purchaseDate: r.purchaseDate, storeName: r.storeName, totalAgorot: r.totalAgorot, duplicate: !!r.duplicateOfId && !r.duplicateOverride, lowConfidence: r.ocrConfidence === "low" })),
    };
  },
});

function monthRangeKeys(first: string, last: string) {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  for (let i = 0; i < 240; i++) {
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

function previousPeriod(from: string, to: string) {
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  const len = Math.round((t - f) / 86_400_000) + 1;
  const pTo = new Date(f - 86_400_000).toISOString().slice(0, 10);
  const pFrom = new Date(f - len * 86_400_000).toISOString().slice(0, 10);
  return { pFrom, pTo };
}

/** Data for the Reports screen: monthly summary, comparisons and alerts for a period. */
export const reportData = query({
  args: { dataset: datasetValidator, editorCode: v.optional(v.string()), from: v.string(), to: v.string() },
  handler: async (ctx, { editorCode, dataset, from, to }) => {
    requireDatasetRead(dataset, editorCode);
    const facts = await loadFacts(ctx, dataset);
    const products = new Map(facts.products.map((p) => [p.id, p]));
    const receipts = facts.receipts.filter((r) => inRange(r.date, from, to));
    const occ = facts.occasions.filter((o) => inRange(o.date, from, to));
    const { pFrom, pTo } = previousPeriod(from, to);
    const prevOcc = facts.occasions.filter((o) => inRange(o.date, pFrom, pTo));
    const alerts = await ctx.db.query("alerts").withIndex("by_dataset_status", (q) => q.eq("dataset", dataset)).collect();
    const alertsInPeriod = alerts.filter((a) => overlaps(a, from, to));

    const monthKeys = monthRangeKeys(from.slice(0, 7), to.slice(0, 7));
    const monthlySummary = monthKeys.map((m) => {
      const rs = receipts.filter((r) => r.date.startsWith(m));
      const os = occ.filter((o) => o.month === m);
      return {
        month: m,
        receipts: rs.length,
        occasions: os.length,
        distinctProducts: new Set(os.map((o) => o.productId)).size,
        spendAgorot: rs.reduce((s, r) => s + (r.totalAgorot ?? r.computedTotalAgorot ?? 0), 0),
        alertsOpened: alertsInPeriod.filter((a) => (a.periodEnd ?? a.periodStart ?? "").startsWith(m)).length,
      };
    });

    const agg = (list: typeof occ) => {
      const m = new Map<string, { occasions: number; quantity: number; lines: number }>();
      for (const o of list) {
        const e = m.get(o.productId) ?? { occasions: 0, quantity: 0, lines: 0 };
        e.occasions++;
        e.quantity += o.quantity;
        e.lines += o.lineCount;
        m.set(o.productId, e);
      }
      return m;
    };
    const cur = agg(occ);
    const prev = agg(prevOcc);
    const comparison = [...new Set([...cur.keys(), ...prev.keys()])]
      .map((id) => {
        const c = cur.get(id) ?? { occasions: 0, quantity: 0, lines: 0 };
        const p = prev.get(id) ?? { occasions: 0, quantity: 0, lines: 0 };
        return {
          productId: id,
          name: products.get(id)?.name ?? "",
          unit: products.get(id)?.unit ?? "unit",
          occasions: c.occasions,
          prevOccasions: p.occasions,
          quantity: Math.round(c.quantity * 100) / 100,
          prevQuantity: Math.round(p.quantity * 100) / 100,
          lines: c.lines,
        };
      })
      .sort((a, b) => b.occasions - a.occasions || a.name.localeCompare(b.name, "he"));

    const productName = (id?: string) => (id ? products.get(id)?.name : undefined);
    const alertRow = (a: (typeof alerts)[number]) => ({
      _id: a._id,
      type: a.type,
      severity: a.severity,
      basis: a.basis,
      status: a.status,
      reason: a.reason,
      product: productName(a.productId),
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      notes: a.notes,
      resolvedAt: a.resolvedAt,
      resolvedBy: a.resolvedBy,
      limitedEvidence: a.limitedEvidence,
    });
    return {
      from,
      to,
      previous: { from: pFrom, to: pTo },
      monthlySummary,
      comparison,
      unresolvedAlerts: alertsInPeriod.filter((a) => a.status !== "explained" && !a.inactive).map(alertRow),
      reviewedAlerts: alertsInPeriod.filter((a) => (a.reviewHistory?.length ?? 0) > 0).map(alertRow),
    };
  },
});
