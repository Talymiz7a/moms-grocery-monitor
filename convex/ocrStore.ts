import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { confidenceValidator, lineTypeValidator, unitValidator } from "./schema";
import { EDITOR_ACTOR } from "./lib/access";
import { confirmedWordingIndex } from "./lib/productMatch";
import { reconcile } from "./lib/reconcile";
import { findDuplicate, writeAudit } from "./lib/receiptOps";
import { scheduleRecompute } from "./lib/recompute";

export const getForOcr = internalQuery({
  args: { receiptId: v.id("receipts") },
  handler: async (ctx, { receiptId }) => {
    const r = await ctx.db.get(receiptId);
    if (!r) return null;
    return {
      fileId: r.fileId,
      fileType: r.fileType,
      ocrFileId: r.ocrFileId,
      ocrStatus: r.ocrStatus,
      verificationStatus: r.verificationStatus,
    };
  },
});

export const markRunning = internalMutation({
  args: { receiptId: v.id("receipts") },
  handler: async (ctx, { receiptId }) => {
    const r = await ctx.db.get(receiptId);
    if (!r) throw new ConvexError("הקבלה לא נמצאה");
    if (r.verificationStatus === "verified") throw new ConvexError("קבלה שאושרה אינה נקראת מחדש");
    await ctx.db.patch(receiptId, { ocrStatus: "running", ocrError: undefined, updatedAt: Date.now() });
  },
});

export const saveError = internalMutation({
  args: { receiptId: v.id("receipts"), message: v.string() },
  handler: async (ctx, { receiptId, message }) => {
    const r = await ctx.db.get(receiptId);
    if (!r) return;
    await ctx.db.patch(receiptId, { ocrStatus: "failed", ocrError: message.slice(0, 500), updatedAt: Date.now() });
    await writeAudit(ctx, {
      dataset: r.dataset,
      actor: EDITOR_ACTOR,
      action: "receipt.ocrFailed",
      entityType: "receipt",
      entityId: receiptId,
      summary: `הקריאה האוטומטית נכשלה: ${message.slice(0, 120)}`,
    });
  },
});

export const saveResult = internalMutation({
  args: {
    receiptId: v.id("receipts"),
    model: v.string(),
    json: v.string(),
    rawText: v.string(),
    confidence: confidenceValidator,
    header: v.object({
      storeName: v.optional(v.string()),
      purchaseDate: v.optional(v.string()),
      receiptNumber: v.optional(v.string()),
      totalAgorot: v.optional(v.number()),
    }),
    headerLowConfidence: v.array(v.string()),
    lines: v.array(
      v.object({
        originalDescription: v.string(),
        lineType: lineTypeValidator,
        quantity: v.number(),
        unit: unitValidator,
        unitPriceAgorot: v.optional(v.number()),
        lineTotalAgorot: v.number(),
        discountAgorot: v.optional(v.number()),
        confidence: confidenceValidator,
        lowConfidenceFields: v.array(v.string()),
      }),
    ),
    usage: v.object({ inputTokens: v.number(), outputTokens: v.number() }),
  },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.receiptId);
    if (!r) throw new ConvexError("הקבלה לא נמצאה");
    if (r.verificationStatus === "verified") throw new ConvexError("קבלה שאושרה אינה נקראת מחדש");
    const old = await ctx.db
      .query("receiptItems")
      .withIndex("by_receipt", (q) => q.eq("receiptId", args.receiptId))
      .collect();
    for (const it of old) await ctx.db.delete(it._id);

    const match = await confirmedWordingIndex(ctx, r.dataset);
    for (let i = 0; i < args.lines.length; i++) {
      const l = args.lines[i];
      const productId = l.lineType === "discount" ? undefined : match(l.originalDescription);
      await ctx.db.insert("receiptItems", {
        dataset: r.dataset,
        receiptId: args.receiptId,
        purchaseDate: args.header.purchaseDate,
        lineIndex: i,
        productId,
        matchStatus: productId ? "confirmed" : "unmatched",
        ...l,
        quantity: l.quantity === 0 ? 1 : l.quantity,
        corrected: false,
      });
    }
    const { lineChecks: _c, ...reconciliation } = reconcile(args.lines, args.header.totalAgorot);
    const duplicate = r.duplicateOfId
      ? { id: r.duplicateOfId, reason: r.duplicateReason ?? "" }
      : await findDuplicate(ctx, r.dataset, {
          excludeId: args.receiptId,
          receiptNumber: args.header.receiptNumber,
          storeName: args.header.storeName,
          purchaseDate: args.header.purchaseDate,
          totalAgorot: args.header.totalAgorot,
          itemCount: args.lines.length,
        });
    await ctx.db.patch(args.receiptId, {
      ...args.header,
      purchaseDateSource: args.header.purchaseDate ? "ocr" : "missing",
      ocrStatus: "done",
      ocrModel: args.model,
      ocrJson: args.json,
      ocrRawText: args.rawText,
      ocrConfidence: args.confidence,
      headerLowConfidence: args.headerLowConfidence,
      reconciliation,
      itemCount: args.lines.length,
      duplicateOfId: duplicate?.id,
      duplicateReason: duplicate?.reason,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      dataset: r.dataset,
      actor: EDITOR_ACTOR,
      action: "receipt.ocr",
      entityType: "receipt",
      entityId: args.receiptId,
      summary: `קריאה אוטומטית הושלמה · ${args.lines.length} שורות · ודאות ${args.confidence === "high" ? "גבוהה" : args.confidence === "medium" ? "בינונית" : "נמוכה"}`,
      details: { model: args.model, usage: args.usage },
    });
    await scheduleRecompute(ctx, r.dataset);
  },
});
