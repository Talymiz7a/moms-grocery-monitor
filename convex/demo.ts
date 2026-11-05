import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { confidenceValidator, lineTypeValidator, unitValidator, expectedUseValidator } from "./schema";
import { requireEditor } from "./lib/access";
import { generateDemoData, receiptText } from "./lib/demoData";
import { reconcile } from "./lib/reconcile";
import { renderReceiptSvg } from "./lib/receiptSvg";
import { writeAudit } from "./lib/receiptOps";
import { recomputeAlerts } from "./alerts";
import { DEMO_EXPECTATIONS, DEMO_REVIEWS } from "./lib/demoData";

const DEMO_TABLES: TableNames[] = ["receiptItems", "alerts", "productExpectations", "settings", "auditLog", "products", "receipts"];

/** Deletes one batch of demo records. Real data is never touched. */
export const clearBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;
    for (const table of DEMO_TABLES) {
      const docs = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field("dataset"), "demo"))
        .take(400 - deleted);
      for (const d of docs) {
        if (table === "receipts") {
          const r = d as unknown as { fileId?: Id<"_storage">; ocrFileId?: Id<"_storage"> };
          for (const f of [r.fileId, r.ocrFileId]) {
            if (f && (await ctx.db.system.get(f))) await ctx.storage.delete(f);
          }
        }
        await ctx.db.delete(d._id);
        deleted++;
      }
      if (deleted >= 400) return { done: false };
    }
    return { done: true };
  },
});

export const insertProducts = internalMutation({
  args: {
    products: v.array(
      v.object({
        key: v.string(),
        canonicalName: v.string(),
        aliases: v.array(v.string()),
        category: v.string(),
        unit: unitValidator,
        packageSize: v.optional(v.number()),
        packageUnit: v.optional(unitValidator),
        expectedUse: expectedUseValidator,
      }),
    ),
  },
  handler: async (ctx, { products }) => {
    const now = Date.now();
    const ids: Record<string, Id<"products">> = {};
    for (const { key, ...p } of products) {
      ids[key] = await ctx.db.insert("products", { dataset: "demo", ...p, createdAt: now, updatedAt: now });
    }
    return ids;
  },
});

const demoLineValidator = v.object({
  description: v.string(),
  productId: v.optional(v.id("products")),
  lineType: lineTypeValidator,
  quantity: v.number(),
  unit: unitValidator,
  unitPriceAgorot: v.optional(v.number()),
  lineTotalAgorot: v.number(),
  discountAgorot: v.optional(v.number()),
  confidence: confidenceValidator,
  lowConfidenceFields: v.array(v.string()),
});

export const insertReceipts = internalMutation({
  args: {
    receipts: v.array(
      v.object({
        key: v.string(),
        storeName: v.string(),
        purchaseDate: v.optional(v.string()),
        receiptNumber: v.optional(v.string()),
        totalAgorot: v.optional(v.number()),
        fileId: v.id("_storage"),
        verificationStatus: v.union(v.literal("draft"), v.literal("verified")),
        ocrConfidence: confidenceValidator,
        ocrRawText: v.string(),
        shopper: v.optional(v.string()),
        notes: v.optional(v.string()),
        duplicateOfKey: v.optional(v.string()),
        duplicateReason: v.optional(v.string()),
        uploadedAt: v.number(),
        lines: v.array(demoLineValidator),
      }),
    ),
  },
  handler: async (ctx, { receipts }) => {
    const ids = new Map<string, Id<"receipts">>();
    for (const r of receipts) {
      const meta = await ctx.db.system.get(r.fileId);
      const { lineChecks: _c, ...reconciliation } = reconcile(r.lines, r.totalAgorot);
      const id = await ctx.db.insert("receipts", {
        dataset: "demo",
        purchaseDate: r.purchaseDate,
        purchaseDateSource: r.purchaseDate ? "ocr" : "missing",
        storeName: r.storeName,
        receiptNumber: r.receiptNumber,
        totalAgorot: r.totalAgorot,
        fileId: r.fileId,
        fileName: `${r.key}.svg`,
        fileType: "image/svg+xml",
        fileSha256: meta?.sha256,
        ocrStatus: "done",
        ocrModel: "הדגמה (ללא קריאה אמיתית)",
        ocrRawText: r.ocrRawText,
        ocrConfidence: r.ocrConfidence,
        headerLowConfidence: r.purchaseDate ? [] : ["purchaseDate", "receiptNumber"],
        verificationStatus: r.verificationStatus,
        reconciliation,
        itemCount: r.lines.length,
        duplicateOfId: r.duplicateOfKey ? ids.get(r.duplicateOfKey) : undefined,
        duplicateReason: r.duplicateReason,
        shopper: r.shopper,
        notes: r.notes,
        uploadedAt: r.uploadedAt,
        updatedAt: r.uploadedAt,
        createdBy: "נתוני הדגמה",
      });
      ids.set(r.key, id);
      for (let i = 0; i < r.lines.length; i++) {
        const { description, ...l } = r.lines[i];
        await ctx.db.insert("receiptItems", {
          dataset: "demo",
          receiptId: id,
          purchaseDate: r.purchaseDate,
          lineIndex: i,
          matchStatus: l.productId ? "confirmed" : "unmatched",
          originalDescription: description,
          ...l,
          corrected: false,
        });
      }
    }
    await writeAudit(ctx, {
      dataset: "demo",
      actor: "מערכת",
      action: "demo.seed",
      entityType: "demo",
      summary: `נטענו נתוני הדגמה: ${receipts.length} קבלות`,
    });
    return receipts.length;
  },
});

export const demoReceiptCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const first = await ctx.db
      .query("receipts")
      .withIndex("by_dataset_date", (q) => q.eq("dataset", "demo"))
      .first();
    return first ? 1 : 0;
  },
});

async function seedDemo(ctx: ActionCtx): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const { done } = await ctx.runMutation(internal.demo.clearBatch, {});
    if (done) break;
  }
  const { products, receipts } = generateDemoData();
  const productIds: Record<string, Id<"products">> = await ctx.runMutation(internal.demo.insertProducts, {
    products: products.map(({ priceAgorot: _p, ...p }) => p),
  });

  const fileIds = new Map<string, Id<"_storage">>();
  const payload = [];
  for (const r of receipts) {
    // An exact re-upload stores the identical bytes again, so the storage
    // fingerprint (SHA-256) matches the original — as it would in real use.
    const source = r.sameFileAs ? receipts.find((x) => x.key === r.sameFileAs)! : r;
    const svg = renderReceiptSvg(source);
    const fileId = await ctx.storage.store(new Blob([svg], { type: "image/svg+xml" }));
    fileIds.set(r.key, fileId);
    const uploaded = r.purchaseDate ? Date.parse(`${r.purchaseDate}T18:30:00+03:00`) : Date.parse("2026-10-28T18:30:00+03:00");
    payload.push({
      key: r.key,
      storeName: r.store.name,
      purchaseDate: r.purchaseDate,
      receiptNumber: r.receiptNumber,
      totalAgorot: r.totalAgorot,
      fileId,
      verificationStatus: r.verificationStatus,
      ocrConfidence: r.ocrConfidence,
      ocrRawText: receiptText(source).join("\n"),
      shopper: r.shopper,
      notes: r.notes,
      duplicateOfKey: r.duplicateOfKey,
      duplicateReason: r.duplicateReason,
      uploadedAt: uploaded + (r.duplicateOfKey ? 86_400_000 : 0),
      lines: r.lines.map((l) => ({
        description: l.description,
        productId: l.productKey && l.matchStatus === "confirmed" ? productIds[l.productKey] : undefined,
        lineType: l.lineType,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceAgorot: l.unitPriceAgorot,
        lineTotalAgorot: l.lineTotalAgorot,
        discountAgorot: l.discountAgorot,
        confidence: l.confidence,
        lowConfidenceFields: l.lowConfidenceFields,
      })),
    });
  }
  // Originals must be inserted before the receipts that point at them.
  payload.sort((a, b) => Number(!!a.duplicateOfKey) - Number(!!b.duplicateOfKey));
  const count: number = await ctx.runMutation(internal.demo.insertReceipts, { receipts: payload });
  await ctx.runMutation(internal.demo.seedRulesAndAlerts, { productIds });
  return count;
}

/** Demo expected-shopping rules, alert sensitivity, detected alerts and a few sample reviews. */
export const seedRulesAndAlerts = internalMutation({
  args: { productIds: v.record(v.string(), v.id("products")) },
  handler: async (ctx, { productIds }) => {
    const now = Date.now();
    await ctx.db.insert("settings", { dataset: "demo", alertSensitivity: "medium", updatedAt: now });
    for (const e of DEMO_EXPECTATIONS) {
      const productId = productIds[e.productKey];
      if (!productId) continue;
      const { productKey: _k, ...rule } = e;
      await ctx.db.insert("productExpectations", { dataset: "demo", productId, ...rule, updatedAt: now, updatedBy: "נתוני הדגמה" });
    }
    await recomputeAlerts(ctx, "demo");
    // Sample reviews so the review history can be seen in the demo.
    const alerts = await ctx.db.query("alerts").withIndex("by_dataset_status", (q) => q.eq("dataset", "demo")).collect();
    for (const r of DEMO_REVIEWS) {
      const a = alerts.find((x) => x.type === r.type && x.productId === productIds[r.productKey] && (!r.month || x.periodStart?.startsWith(r.month)));
      if (!a) continue;
      await ctx.db.patch(a._id, {
        status: r.status,
        notes: r.notes,
        resolvedAt: r.status === "explained" ? now : undefined,
        resolvedBy: "נתוני הדגמה",
        reviewHistory: [{ at: now, actor: "נתוני הדגמה", status: r.status, notes: r.notes }],
      });
    }
  },
});

/** Run from the CLI: `npx convex run demo:seed`. Replaces demo data only. */
export const seed = internalAction({
  args: {},
  handler: async (ctx): Promise<{ receipts: number }> => ({ receipts: await seedDemo(ctx) }),
});

/** Seeds demo data only if none exists (used after deployments). */
export const seedIfEmpty = internalAction({
  args: {},
  handler: async (ctx): Promise<{ seeded: boolean; receipts?: number }> => {
    const existing: number = await ctx.runQuery(internal.demo.demoReceiptCount, {});
    if (existing > 0) return { seeded: false };
    return { seeded: true, receipts: await seedDemo(ctx) };
  },
});

/** Resets demo data from the Settings screen (editor only). */
export const reset = action({
  args: { editorCode: v.string() },
  handler: async (ctx, { editorCode }): Promise<{ receipts: number }> => {
    requireEditor(editorCode);
    return { receipts: await seedDemo(ctx) };
  },
});
