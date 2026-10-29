import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { datasetValidator } from "./schema";
import { EDITOR_ACTOR, requireEditor } from "./lib/access";
import { detectAnomalies, hashEvidence, SENSITIVITY, type Sensitivity } from "./lib/anomalies";
import { loadFacts } from "./lib/facts";
import { cleanText, writeAudit, type Dataset } from "./lib/receiptOps";
import { scheduleRecompute } from "./lib/recompute";

const statusValidator = v.union(v.literal("pending"), v.literal("explained"), v.literal("investigate"));

export async function getSensitivity(ctx: QueryCtx, dataset: Dataset): Promise<Sensitivity> {
  const s = await ctx.db.query("settings").withIndex("by_dataset", (q) => q.eq("dataset", dataset)).first();
  return s?.alertSensitivity ?? "medium";
}

/**
 * Recomputes alert candidates for a dataset and reconciles them with stored
 * alerts:
 * - new candidates become "pending";
 * - open alerts get their evidence refreshed;
 * - an alert marked "explained" stays closed unless its evidence changed
 *   (then it is reopened, with a note);
 * - alerts whose evidence disappeared are removed if never reviewed, or kept
 *   as inactive history if a person already reviewed them.
 */
export async function recomputeAlerts(ctx: MutationCtx, dataset: Dataset) {
  const facts = await loadFacts(ctx, dataset);
  const expectations = await ctx.db.query("productExpectations").withIndex("by_dataset_product", (q) => q.eq("dataset", dataset)).collect();
  const sensitivity = await getSensitivity(ctx, dataset);
  const candidates = detectAnomalies({
    occasions: facts.occasions,
    products: facts.productDocs.filter((p) => !p.mergedIntoId).map((p) => ({ id: p._id, name: p.canonicalName, unit: p.unit, expectedUse: p.expectedUse })),
    expectations: expectations.map((e) => ({
      productId: e.productId,
      maxPerMonth: e.maxPerMonth,
      minIntervalDays: e.minIntervalDays,
      quantityMin: e.quantityMin,
      quantityMax: e.quantityMax,
    })),
    receipts: facts.receiptDocs.map((r) => ({
      id: r._id,
      date: r.purchaseDate,
      storeName: r.storeName,
      totalAgorot: r.totalAgorot,
      computedTotalAgorot: r.reconciliation?.computedTotalAgorot,
      itemCount: r.itemCount ?? 0,
      verified: r.verificationStatus === "verified",
      duplicateOfId: r.duplicateOfId,
      duplicateReason: r.duplicateReason,
      duplicateOverride: r.duplicateOverride,
    })),
    sensitivity,
  });
  const existing = await ctx.db.query("alerts").withIndex("by_dataset_status", (q) => q.eq("dataset", dataset)).collect();
  const byKey = new Map(existing.map((a) => [a.dedupeKey, a]));
  const now = Date.now();
  const seen = new Set<string>();
  let created = 0;
  let reopened = 0;
  for (const c of candidates) {
    seen.add(c.dedupeKey);
    const evidenceHash = hashEvidence(c.evidenceKey);
    const fields = {
      type: c.type,
      basis: c.basis,
      productId: c.productId as Id<"products"> | undefined,
      receiptIds: c.receiptIds as Id<"receipts">[],
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      reason: c.reason,
      evidenceJson: JSON.stringify(c.evidence),
      limitedEvidence: c.limitedEvidence,
      severity: c.severity,
    };
    const prev = byKey.get(c.dedupeKey);
    if (!prev) {
      await ctx.db.insert("alerts", { dataset, ...fields, evidenceHash, detectedAt: now, status: "pending", dedupeKey: c.dedupeKey });
      created++;
      continue;
    }
    if (prev.status === "explained" && prev.evidenceHash === evidenceHash && !prev.inactive) continue;
    if (prev.status === "explained" && (prev.evidenceHash !== evidenceHash || prev.inactive)) {
      await ctx.db.patch(prev._id, {
        ...fields,
        evidenceHash,
        inactive: false,
        status: "pending",
        reopenedAt: now,
        reviewHistory: [...(prev.reviewHistory ?? []), { at: now, actor: "מערכת", status: "pending", notes: "נפתח מחדש: הראיות השתנו מאז הבדיקה" }],
      });
      await writeAudit(ctx, { dataset, actor: "מערכת", action: "alert.reopen", entityType: "alert", entityId: prev._id, summary: `התראה נפתחה מחדש עקב ראיות חדשות: ${c.reason}` });
      reopened++;
      continue;
    }
    await ctx.db.patch(prev._id, { ...fields, evidenceHash, inactive: false });
  }
  for (const a of existing) {
    if (seen.has(a.dedupeKey)) continue;
    if (a.status === "pending" && !(a.reviewHistory?.length)) await ctx.db.delete(a._id);
    else if (!a.inactive) await ctx.db.patch(a._id, { inactive: true });
  }
  return { candidates: candidates.length, created, reopened };
}

export const recompute = internalMutation({
  args: { dataset: datasetValidator },
  handler: async (ctx, { dataset }) => recomputeAlerts(ctx, dataset),
});

async function receiptBrief(ctx: QueryCtx, ids: Id<"receipts">[]) {
  const out = [];
  for (const id of ids) {
    const r = await ctx.db.get(id);
    out.push(r ? { _id: r._id, purchaseDate: r.purchaseDate, storeName: r.storeName, totalAgorot: r.totalAgorot, hasFile: !!r.fileId } : { _id: id, missing: true as const });
  }
  return out;
}

export const list = query({
  args: {
    dataset: datasetValidator,
    status: v.optional(v.union(v.literal("open"), v.literal("pending"), v.literal("investigate"), v.literal("explained"), v.literal("all"))),
    type: v.optional(v.string()),
    severity: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, { dataset, status = "open", type, severity, from, to }) => {
    const all = await ctx.db.query("alerts").withIndex("by_dataset_status", (q) => q.eq("dataset", dataset)).collect();
    const products = new Map(
      (await ctx.db.query("products").withIndex("by_dataset", (q) => q.eq("dataset", dataset)).collect()).map((p) => [p._id as string, p.canonicalName]),
    );
    const filtered = all.filter((a) => {
      if (status === "open" && (a.status === "explained" || a.inactive)) return false;
      if (status !== "open" && status !== "all" && a.status !== status) return false;
      if (type && a.type !== type) return false;
      if (severity && a.severity !== severity) return false;
      const d = a.periodEnd ?? a.periodStart;
      if (from && (!d || d < from)) return false;
      if (to && (!a.periodStart || a.periodStart > to)) return false;
      return true;
    });
    const sevRank = { high: 0, medium: 1, low: 2 };
    filtered.sort(
      (a, b) =>
        Number(a.status === "explained") - Number(b.status === "explained") ||
        sevRank[a.severity] - sevRank[b.severity] ||
        (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""),
    );
    const out = [];
    for (const a of filtered.slice(0, 300)) {
      out.push({
        _id: a._id,
        type: a.type,
        basis: a.basis,
        productId: a.productId,
        productName: a.productId ? products.get(a.productId) : undefined,
        receipts: await receiptBrief(ctx, a.receiptIds),
        detectedAt: a.detectedAt,
        periodStart: a.periodStart,
        periodEnd: a.periodEnd,
        reason: a.reason,
        evidence: JSON.parse(a.evidenceJson) as Record<string, unknown>,
        limitedEvidence: a.limitedEvidence,
        severity: a.severity,
        status: a.status,
        notes: a.notes,
        resolvedAt: a.resolvedAt,
        resolvedBy: a.resolvedBy,
        inactive: a.inactive ?? false,
        reopenedAt: a.reopenedAt,
        reviewHistory: a.reviewHistory ?? [],
      });
    }
    return { total: filtered.length, alerts: out };
  },
});

export const counts = query({
  args: { dataset: datasetValidator },
  handler: async (ctx, { dataset }) => {
    const all = await ctx.db.query("alerts").withIndex("by_dataset_status", (q) => q.eq("dataset", dataset)).collect();
    const open = all.filter((a) => a.status !== "explained" && !a.inactive);
    return {
      pending: open.filter((a) => a.status === "pending").length,
      investigate: open.filter((a) => a.status === "investigate").length,
      explained: all.filter((a) => a.status === "explained").length,
      high: open.filter((a) => a.severity === "high").length,
    };
  },
});

export const review = mutation({
  args: { editorCode: v.string(), alertId: v.id("alerts"), status: statusValidator, notes: v.optional(v.string()) },
  handler: async (ctx, { editorCode, alertId, status, notes }) => {
    requireEditor(editorCode);
    const a = await ctx.db.get(alertId);
    if (!a) throw new ConvexError("ההתראה לא נמצאה");
    const now = Date.now();
    const cleanNotes = cleanText(notes, 2000);
    if (status === "explained" && !cleanNotes) throw new ConvexError("יש לכתוב הסבר קצר לפני סימון 'נבדק והוסבר'");
    await ctx.db.patch(alertId, {
      status,
      notes: cleanNotes,
      resolvedAt: status === "explained" ? now : undefined,
      resolvedBy: status === "pending" ? undefined : EDITOR_ACTOR,
      reviewHistory: [...(a.reviewHistory ?? []), { at: now, actor: EDITOR_ACTOR, status, notes: cleanNotes }],
    });
    const label = { pending: "ממתין לבדיקה", explained: "נבדק והוסבר", investigate: "נדרש בירור נוסף" }[status];
    await writeAudit(ctx, { dataset: a.dataset, actor: EDITOR_ACTOR, action: "alert.review", entityType: "alert", entityId: alertId, summary: `${label}: ${a.reason}`, details: { notes: cleanNotes } });
  },
});

export const settings = query({
  args: { dataset: datasetValidator },
  handler: async (ctx, { dataset }) => {
    const sensitivity = await getSensitivity(ctx, dataset);
    return { sensitivity, options: Object.entries(SENSITIVITY).map(([k, s]) => ({ key: k as Sensitivity, label: s.label })) };
  },
});

export const setSensitivity = mutation({
  args: { editorCode: v.string(), dataset: datasetValidator, sensitivity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")) },
  handler: async (ctx, { editorCode, dataset, sensitivity }) => {
    requireEditor(editorCode);
    const s = await ctx.db.query("settings").withIndex("by_dataset", (q) => q.eq("dataset", dataset)).first();
    if (s) await ctx.db.patch(s._id, { alertSensitivity: sensitivity, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { dataset, alertSensitivity: sensitivity, updatedAt: Date.now() });
    await writeAudit(ctx, { dataset, actor: EDITOR_ACTOR, action: "rule.sensitivity", entityType: "rule", summary: `רגישות ההתראות שונתה ל: ${SENSITIVITY[sensitivity].label}` });
    await scheduleRecompute(ctx, dataset);
  },
});

export type AlertDoc = Doc<"alerts">;
