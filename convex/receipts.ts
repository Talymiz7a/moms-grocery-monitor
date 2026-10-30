import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { datasetValidator } from "./schema";
import { EDITOR_ACTOR, requireDatasetRead, requireEditor } from "./lib/access";
import { isValidIsoDate } from "./lib/dates";
import { normalizeText } from "./lib/normalize";
import { reconcile } from "./lib/reconcile";
import {
  cleanText,
  findDuplicate,
  isWholeAgorot,
  reviewHeaderValidator,
  reviewLineValidator,
  writeAudit,
  type ReviewLine,
} from "./lib/receiptOps";
import { scheduleRecompute } from "./lib/recompute";

function receiptSummary(r: Doc<"receipts">) {
  return {
    _id: r._id,
    purchaseDate: r.purchaseDate,
    storeName: r.storeName,
    receiptNumber: r.receiptNumber,
    totalAgorot: r.totalAgorot,
    itemCount: r.itemCount ?? 0,
    verificationStatus: r.verificationStatus,
    ocrStatus: r.ocrStatus,
    ocrConfidence: r.ocrConfidence,
    reconciliationStatus: r.reconciliation?.status,
    differenceAgorot: r.reconciliation?.differenceAgorot ?? null,
    hasFile: r.fileId !== undefined,
    duplicateSuspected: r.duplicateOfId !== undefined && !r.duplicateOverride,
    uploadedAt: r.uploadedAt,
  };
}

export const list = query({
  args: {
    dataset: datasetValidator,
    editorCode: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    filter: v.optional(v.union(v.literal("all"), v.literal("draft"), v.literal("verified"), v.literal("issues"))),
  },
  handler: async (ctx, { editorCode, dataset, from, to, filter }) => {
    requireDatasetRead(dataset, editorCode);
    const dated = await ctx.db
      .query("receipts")
      .withIndex("by_dataset_date", (q) => {
        const base = q.eq("dataset", dataset);
        if (from && to) return base.gte("purchaseDate", from).lte("purchaseDate", to);
        if (from) return base.gte("purchaseDate", from);
        if (to) return base.lte("purchaseDate", to);
        return base;
      })
      .collect();
    // Receipts without a date only match when no date range is applied (the
    // range bounds exclude them); they are then listed first so they are
    // never silently hidden.
    const f = filter ?? "all";
    const out = dated
      .map(receiptSummary)
      .filter((r) => {
        if (f === "draft") return r.verificationStatus === "draft";
        if (f === "verified") return r.verificationStatus === "verified";
        if (f === "issues")
          return (
            r.verificationStatus === "draft" ||
            r.duplicateSuspected ||
            r.reconciliationStatus === "mismatch" ||
            r.reconciliationStatus === "no_total" ||
            !r.purchaseDate
          );
        return true;
      });
    out.sort((a, b) => {
      if (!a.purchaseDate && b.purchaseDate) return -1;
      if (a.purchaseDate && !b.purchaseDate) return 1;
      const byDate = (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? "");
      return byDate !== 0 ? byDate : b.uploadedAt - a.uploadedAt;
    });
    return out;
  },
});

export const get = query({
  args: { receiptId: v.id("receipts"), editorCode: v.optional(v.string()) },
  handler: async (ctx, { receiptId, editorCode }) => {
    const receipt = await ctx.db.get(receiptId);
    if (!receipt) return null;
    requireDatasetRead(receipt.dataset, editorCode);
    const items = await ctx.db
      .query("receiptItems")
      .withIndex("by_receipt", (q) => q.eq("receiptId", receiptId))
      .collect();
    const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is Id<"products"> => !!x))];
    const products = new Map<string, Doc<"products">>();
    for (const id of productIds) {
      const p = await ctx.db.get(id);
      if (p) products.set(id, p);
    }
    const duplicateOf = receipt.duplicateOfId ? await ctx.db.get(receipt.duplicateOfId) : null;
    const audit = await ctx.db
      .query("auditLog")
      .withIndex("by_dataset_entity", (q) =>
        q.eq("dataset", receipt.dataset).eq("entityType", "receipt").eq("entityId", receiptId),
      )
      .order("desc")
      .take(50);
    const { ocrJson, ...rest } = receipt;
    // Lines the free in-browser reader could not understand, for manual entry.
    let ocrUnrecognized: string[] = [];
    try {
      const parsed = ocrJson ? (JSON.parse(ocrJson) as { unrecognized?: unknown }) : null;
      if (parsed && Array.isArray(parsed.unrecognized)) ocrUnrecognized = parsed.unrecognized.filter((x): x is string => typeof x === "string");
    } catch {
      // Older or non-JSON OCR payloads simply have no unrecognized list.
    }
    return {
      receipt: rest,
      ocrUnrecognized,
      items: items.map((i) => ({
        ...i,
        productName: i.productId ? products.get(i.productId)?.canonicalName : undefined,
      })),
      duplicateOf: duplicateOf
        ? { _id: duplicateOf._id, purchaseDate: duplicateOf.purchaseDate, storeName: duplicateOf.storeName, totalAgorot: duplicateOf.totalAgorot }
        : null,
      audit: audit.map((a) => ({ _id: a._id, at: a.at, actor: a.actor, action: a.action, summary: a.summary })),
    };
  },
});

export const dashboardSummary = query({
  args: { dataset: datasetValidator, editorCode: v.optional(v.string()) },
  handler: async (ctx, { editorCode, dataset }) => {
    requireDatasetRead(dataset, editorCode);
    const receipts = await ctx.db
      .query("receipts")
      .withIndex("by_dataset_date", (q) => q.eq("dataset", dataset))
      .collect();
    const verified = receipts.filter((r) => r.verificationStatus === "verified");
    const verifiedIds = new Set(verified.map((r) => r._id));
    const items = await ctx.db
      .query("receiptItems")
      .withIndex("by_dataset_date", (q) => q.eq("dataset", dataset))
      .collect();
    const occasions = new Set<string>();
    const products = new Set<string>();
    for (const it of items) {
      if (!verifiedIds.has(it.receiptId) || it.lineType !== "item" || it.matchStatus !== "confirmed" || !it.productId) continue;
      if (it.quantity <= 0) continue;
      occasions.add(`${it.receiptId}:${it.productId}`);
      products.add(it.productId);
    }
    const totalSpend = verified.reduce((s, r) => s + (r.totalAgorot ?? r.reconciliation?.computedTotalAgorot ?? 0), 0);
    const dates = verified.map((r) => r.purchaseDate).filter((d): d is string => !!d).sort();
    const openAlerts = await ctx.db
      .query("alerts")
      .withIndex("by_dataset_status", (q) => q.eq("dataset", dataset).eq("status", "pending"))
      .collect();
    const sorted = [...receipts].sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));
    return {
      receiptCount: verified.length,
      distinctProducts: products.size,
      purchaseOccasions: occasions.size,
      totalSpendAgorot: totalSpend,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      draftCount: receipts.filter((r) => r.verificationStatus === "draft").length,
      mismatchCount: verified.filter((r) => r.reconciliation?.status === "mismatch").length,
      missingTotalCount: verified.filter((r) => r.reconciliation?.status === "no_total").length,
      duplicateCount: receipts.filter((r) => r.duplicateOfId && !r.duplicateOverride).length,
      openAlertCount: openAlerts.length,
      recent: sorted.filter((r) => r.verificationStatus === "verified").slice(0, 6).map(receiptSummary),
      needsReview: receipts
        .filter((r) => r.verificationStatus === "draft")
        .sort((a, b) => b.uploadedAt - a.uploadedAt)
        .slice(0, 6)
        .map(receiptSummary),
    };
  },
});

async function resolveProduct(
  ctx: MutationCtx,
  dataset: Doc<"receipts">["dataset"],
  line: ReviewLine,
): Promise<Id<"products"> | undefined> {
  const now = Date.now();
  const choice = line.product;
  if (choice.kind === "none") return undefined;
  if (choice.kind === "existing") {
    const p = await ctx.db.get(choice.productId);
    if (!p || p.dataset !== dataset) throw new ConvexError("מוצר לא נמצא");
    const target = p.mergedIntoId ? await ctx.db.get(p.mergedIntoId) : p;
    if (!target) throw new ConvexError("מוצר לא נמצא");
    const norm = normalizeText(line.originalDescription);
    if (!target.aliases.some((a) => normalizeText(a) === norm)) {
      await ctx.db.patch(target._id, { aliases: [...target.aliases, line.originalDescription.trim()], updatedAt: now });
    }
    return target._id;
  }
  const name = cleanText(choice.canonicalName, 120);
  if (!name) throw new ConvexError("יש להזין שם מוצר");
  const existing = await ctx.db
    .query("products")
    .withIndex("by_dataset_name", (q) => q.eq("dataset", dataset).eq("canonicalName", name))
    .first();
  if (existing) {
    const norm = normalizeText(line.originalDescription);
    if (!existing.aliases.some((a) => normalizeText(a) === norm)) {
      await ctx.db.patch(existing._id, { aliases: [...existing.aliases, line.originalDescription.trim()], updatedAt: now });
    }
    return existing._id;
  }
  const id = await ctx.db.insert("products", {
    dataset,
    canonicalName: name,
    aliases: [...new Set([name, line.originalDescription.trim()])],
    unit: choice.unit,
    expectedUse: "occasional",
    createdAt: now,
    updatedAt: now,
  });
  await writeAudit(ctx, {
    dataset,
    actor: EDITOR_ACTOR,
    action: "product.create",
    entityType: "product",
    entityId: id,
    summary: `נוצר מוצר חדש: ${name}`,
  });
  return id;
}

export const saveReview = mutation({
  args: {
    editorCode: v.string(),
    receiptId: v.id("receipts"),
    header: reviewHeaderValidator,
    lines: v.array(reviewLineValidator),
    finalize: v.boolean(),
  },
  handler: async (ctx, { editorCode, receiptId, header, lines, finalize }) => {
    requireEditor(editorCode);
    const receipt = await ctx.db.get(receiptId);
    if (!receipt) throw new ConvexError("הקבלה לא נמצאה");
    if (lines.length > 300) throw new ConvexError("יותר מדי שורות בקבלה");

    // Validation — reject impossible values instead of silently fixing them.
    if (header.purchaseDate !== undefined && !isValidIsoDate(header.purchaseDate)) {
      throw new ConvexError("תאריך הקנייה אינו תקין");
    }
    if (!isWholeAgorot(header.totalAgorot)) throw new ConvexError("הסכום הכולל אינו תקין");
    lines.forEach((l, i) => {
      if (!cleanText(l.originalDescription)) throw new ConvexError(`שורה ${i + 1}: חסר תיאור`);
      if (!Number.isFinite(l.quantity) || l.quantity === 0) throw new ConvexError(`שורה ${i + 1}: כמות לא תקינה`);
      if (!isWholeAgorot(l.lineTotalAgorot) || !isWholeAgorot(l.unitPriceAgorot) || !isWholeAgorot(l.discountAgorot)) {
        throw new ConvexError(`שורה ${i + 1}: סכום לא תקין`);
      }
      if (l.discountAgorot !== undefined && l.discountAgorot < 0) throw new ConvexError(`שורה ${i + 1}: הנחה חייבת להיות חיובית`);
    });

    const now = Date.now();
    const storeName = cleanText(header.storeName, 120);
    const receiptNumber = cleanText(header.receiptNumber, 60);
    const purchaseDate = header.purchaseDate;

    // Replace item lines.
    const oldItems = await ctx.db
      .query("receiptItems")
      .withIndex("by_receipt", (q) => q.eq("receiptId", receiptId))
      .collect();
    for (const it of oldItems) await ctx.db.delete(it._id);
    let correctedCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const productId = l.lineType === "discount" ? undefined : await resolveProduct(ctx, receipt.dataset, l);
      if (l.corrected) correctedCount++;
      await ctx.db.insert("receiptItems", {
        dataset: receipt.dataset,
        receiptId,
        purchaseDate,
        lineIndex: i,
        productId,
        matchStatus: productId ? "confirmed" : "unmatched",
        originalDescription: l.originalDescription.trim(),
        lineType: l.lineType,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceAgorot: l.unitPriceAgorot,
        lineTotalAgorot: l.lineTotalAgorot,
        discountAgorot: l.discountAgorot,
        confidence: l.confidence,
        lowConfidenceFields: l.lowConfidenceFields,
        corrected: l.corrected,
      });
    }

    const rec = reconcile(lines, header.totalAgorot);
    const { lineChecks: _lineChecks, ...reconciliation } = rec;

    const duplicate = receipt.duplicateOverride
      ? null
      : await findDuplicate(ctx, receipt.dataset, {
          excludeId: receiptId,
          sha256: receipt.fileSha256,
          receiptNumber,
          storeName,
          purchaseDate,
          totalAgorot: header.totalAgorot,
          itemCount: lines.length,
        });
    if (finalize && duplicate) {
      throw new ConvexError(
        `לא ניתן לאשר: ${duplicate.reason}. יש לסמן "אינה כפולה" אם זו קנייה נפרדת, או למחוק את הכפילות.`,
      );
    }

    const dateSource: Doc<"receipts">["purchaseDateSource"] = !purchaseDate
      ? "missing"
      : receipt.purchaseDateSource === "ocr" && receipt.purchaseDate === purchaseDate
        ? "ocr"
        : "manual";

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const compare = (field: string, from: unknown, to: unknown) => {
      if (from !== to) changes[field] = { from: from ?? null, to: to ?? null };
    };
    compare("storeName", receipt.storeName, storeName);
    compare("purchaseDate", receipt.purchaseDate, purchaseDate);
    compare("receiptNumber", receipt.receiptNumber, receiptNumber);
    compare("totalAgorot", receipt.totalAgorot, header.totalAgorot);

    await ctx.db.patch(receiptId, {
      storeName,
      purchaseDate,
      purchaseDateSource: dateSource,
      receiptNumber,
      totalAgorot: header.totalAgorot,
      shopper: cleanText(header.shopper, 80),
      notes: cleanText(header.notes, 1000),
      reconciliation,
      itemCount: lines.length,
      verificationStatus: finalize ? "verified" : "draft",
      ocrStatus: receipt.ocrStatus === "not_run" ? "manual" : receipt.ocrStatus,
      duplicateOfId: duplicate?.id,
      duplicateReason: duplicate?.reason,
      updatedAt: now,
    });

    await writeAudit(ctx, {
      dataset: receipt.dataset,
      actor: EDITOR_ACTOR,
      action: finalize ? "receipt.verify" : "receipt.saveDraft",
      entityType: "receipt",
      entityId: receiptId,
      summary:
        (finalize ? "הקבלה נבדקה ואושרה" : "הקבלה נשמרה כטיוטה") +
        ` · ${lines.length} שורות` +
        (correctedCount ? ` · ${correctedCount} תוקנו ידנית` : "") +
        (Object.keys(changes).length ? ` · שונו: ${Object.keys(changes).length} שדות כותרת` : ""),
      details: { changes, previousLineCount: oldItems.length, lineCount: lines.length, correctedCount },
    });
    await scheduleRecompute(ctx, receipt.dataset);

    return { reconciliation: rec, duplicate };
  },
});

export const setDuplicateOverride = mutation({
  args: { editorCode: v.string(), receiptId: v.id("receipts"), notDuplicate: v.boolean() },
  handler: async (ctx, { editorCode, receiptId, notDuplicate }) => {
    requireEditor(editorCode);
    const receipt = await ctx.db.get(receiptId);
    if (!receipt) throw new ConvexError("הקבלה לא נמצאה");
    await ctx.db.patch(receiptId, { duplicateOverride: notDuplicate, updatedAt: Date.now() });
    await writeAudit(ctx, {
      dataset: receipt.dataset,
      actor: EDITOR_ACTOR,
      action: "receipt.duplicateOverride",
      entityType: "receipt",
      entityId: receiptId,
      summary: notDuplicate ? "סומנה ידנית: אינה קבלה כפולה" : "בוטל הסימון הידני של \"אינה כפולה\"",
    });
    await scheduleRecompute(ctx, receipt.dataset);
  },
});

export const remove = mutation({
  args: { editorCode: v.string(), receiptId: v.id("receipts") },
  handler: async (ctx, { editorCode, receiptId }) => {
    requireEditor(editorCode);
    const receipt = await ctx.db.get(receiptId);
    if (!receipt) throw new ConvexError("הקבלה לא נמצאה");
    const items = await ctx.db
      .query("receiptItems")
      .withIndex("by_receipt", (q) => q.eq("receiptId", receiptId))
      .collect();
    for (const it of items) await ctx.db.delete(it._id);
    // Keep the file if another receipt still points at the same stored file.
    if (receipt.fileId) {
      const fileId = receipt.fileId;
      const sharing = await ctx.db
        .query("receipts")
        .withIndex("by_dataset_sha", (q) => q.eq("dataset", receipt.dataset).eq("fileSha256", receipt.fileSha256))
        .collect();
      if (!sharing.some((r) => r._id !== receiptId && r.fileId === fileId)) await ctx.storage.delete(fileId);
    }
    // Receipts that were flagged as duplicates of this one lose the flag.
    const flagged = await ctx.db
      .query("receipts")
      .withIndex("by_dataset_date", (q) => q.eq("dataset", receipt.dataset))
      .filter((q) => q.eq(q.field("duplicateOfId"), receiptId))
      .collect();
    for (const r of flagged) await ctx.db.patch(r._id, { duplicateOfId: undefined, duplicateReason: undefined });
    await ctx.db.delete(receiptId);
    const { ocrJson: _omit, ...snapshot } = receipt;
    await writeAudit(ctx, {
      dataset: receipt.dataset,
      actor: EDITOR_ACTOR,
      action: "receipt.delete",
      entityType: "receipt",
      entityId: receiptId,
      summary: `נמחקה קבלה: ${receipt.storeName ?? "ללא חנות"} ${receipt.purchaseDate ?? ""}`.trim(),
      details: { receipt: snapshot, items: items.map(({ _id, _creationTime, ...rest }) => rest) },
    });
    await scheduleRecompute(ctx, receipt.dataset);
  },
});

/**
 * Date search: receipts in a date range with their lines (product, quantity,
 * price) and any alerts that cite them.
 */
export const itemsInRange = query({
  args: { dataset: datasetValidator, editorCode: v.optional(v.string()), from: v.string(), to: v.string() },
  handler: async (ctx, { editorCode, dataset, from, to }) => {
    requireDatasetRead(dataset, editorCode);
    const receipts = await ctx.db
      .query("receipts")
      .withIndex("by_dataset_date", (q) => q.eq("dataset", dataset).gte("purchaseDate", from).lte("purchaseDate", to))
      .collect();
    if (receipts.length > 400) throw new ConvexError("הטווח גדול מדי — בחרו טווח קצר יותר");
    const products = new Map(
      (await ctx.db.query("products").withIndex("by_dataset", (q) => q.eq("dataset", dataset)).collect()).map((p) => [p._id as string, p.canonicalName]),
    );
    const alerts = await ctx.db.query("alerts").withIndex("by_dataset_status", (q) => q.eq("dataset", dataset)).collect();
    const out = [];
    for (const r of receipts.sort((a, b) => (a.purchaseDate ?? "").localeCompare(b.purchaseDate ?? ""))) {
      const items = await ctx.db
        .query("receiptItems")
        .withIndex("by_receipt", (q) => q.eq("receiptId", r._id))
        .collect();
      out.push({
        ...receiptSummary(r),
        items: items.map((i) => ({
          _id: i._id,
          originalDescription: i.originalDescription,
          productId: i.productId,
          productName: i.productId ? products.get(i.productId) : undefined,
          lineType: i.lineType,
          quantity: i.quantity,
          unit: i.unit,
          unitPriceAgorot: i.unitPriceAgorot,
          lineTotalAgorot: i.lineTotalAgorot,
          discountAgorot: i.discountAgorot,
        })),
        alerts: alerts
          .filter((a) => a.receiptIds.includes(r._id))
          .map((a) => ({ _id: a._id, type: a.type, status: a.status, severity: a.severity, reason: a.reason })),
      });
    }
    return out;
  },
});
