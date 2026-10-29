import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { datasetValidator, expectedUseValidator, unitValidator } from "./schema";
import { EDITOR_ACTOR, requireEditor } from "./lib/access";
import { extractQualifiers, normalizeText, qualifiersConflict, suggestMatches } from "./lib/normalize";
import { cleanText, writeAudit } from "./lib/receiptOps";
import { scheduleRecompute } from "./lib/recompute";

export const list = query({
  args: { dataset: datasetValidator },
  handler: async (ctx, { dataset }) => {
    const all = await ctx.db
      .query("products")
      .withIndex("by_dataset", (q) => q.eq("dataset", dataset))
      .collect();
    return all
      .filter((p) => !p.mergedIntoId)
      .map((p) => ({
        _id: p._id,
        canonicalName: p.canonicalName,
        aliases: p.aliases,
        category: p.category,
        unit: p.unit,
        expectedUse: p.expectedUse,
      }))
      .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName, "he"));
  },
});

/** Suggests product matches for raw receipt descriptions. Suggestions only — a person confirms. */
export const suggest = query({
  args: { dataset: datasetValidator, descriptions: v.array(v.string()) },
  handler: async (ctx, { dataset, descriptions }) => {
    const all = await ctx.db
      .query("products")
      .withIndex("by_dataset", (q) => q.eq("dataset", dataset))
      .collect();
    const candidates = all
      .filter((p) => !p.mergedIntoId)
      .map((p) => ({ id: p._id as string, canonicalName: p.canonicalName, aliases: p.aliases }));
    return descriptions.slice(0, 300).map((d) => suggestMatches(d, candidates));
  },
});

/** Products with their expected-use category and manual expectations (Settings). */
export const listWithExpectations = query({
  args: { dataset: datasetValidator },
  handler: async (ctx, { dataset }) => {
    const all = await ctx.db.query("products").withIndex("by_dataset", (q) => q.eq("dataset", dataset)).collect();
    const exps = await ctx.db.query("productExpectations").withIndex("by_dataset_product", (q) => q.eq("dataset", dataset)).collect();
    const expBy = new Map(exps.map((e) => [e.productId as string, e]));
    return all
      .filter((p) => !p.mergedIntoId)
      .map((p) => {
        const e = expBy.get(p._id);
        return {
          _id: p._id,
          canonicalName: p.canonicalName,
          aliases: p.aliases,
          category: p.category,
          unit: p.unit,
          packageSize: p.packageSize,
          packageUnit: p.packageUnit,
          expectedUse: p.expectedUse,
          notes: p.notes,
          expectation: e
            ? {
                usualQuantity: e.usualQuantity,
                usualUnit: e.usualUnit,
                expectedIntervalDays: e.expectedIntervalDays,
                maxPerMonth: e.maxPerMonth,
                minIntervalDays: e.minIntervalDays,
                quantityMin: e.quantityMin,
                quantityMax: e.quantityMax,
                notes: e.notes,
                updatedAt: e.updatedAt,
                updatedBy: e.updatedBy,
              }
            : null,
        };
      })
      .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "", "he") || a.canonicalName.localeCompare(b.canonicalName, "he"));
  },
});

const positive = (n: number | undefined, label: string) => {
  if (n !== undefined && (!Number.isFinite(n) || n <= 0 || n > 100000)) throw new ConvexError(`${label}: ערך לא תקין`);
};

export const updateProduct = mutation({
  args: {
    editorCode: v.string(),
    productId: v.id("products"),
    canonicalName: v.string(),
    category: v.optional(v.string()),
    unit: unitValidator,
    packageSize: v.optional(v.number()),
    packageUnit: v.optional(unitValidator),
    expectedUse: expectedUseValidator,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { editorCode, productId, ...f }) => {
    requireEditor(editorCode);
    const p = await ctx.db.get(productId);
    if (!p) throw new ConvexError("המוצר לא נמצא");
    const name = cleanText(f.canonicalName, 120);
    if (!name) throw new ConvexError("יש להזין שם מוצר");
    positive(f.packageSize, "גודל אריזה");
    const clash = await ctx.db.query("products").withIndex("by_dataset_name", (q) => q.eq("dataset", p.dataset).eq("canonicalName", name)).first();
    if (clash && clash._id !== productId) throw new ConvexError("כבר קיים מוצר בשם זה — אפשר למזג אליו");
    const before = { canonicalName: p.canonicalName, category: p.category, unit: p.unit, packageSize: p.packageSize, packageUnit: p.packageUnit, expectedUse: p.expectedUse, notes: p.notes };
    const after = { canonicalName: name, category: cleanText(f.category, 60), unit: f.unit, packageSize: f.packageSize, packageUnit: f.packageSize ? f.packageUnit : undefined, expectedUse: f.expectedUse, notes: cleanText(f.notes, 500) };
    await ctx.db.patch(productId, { ...after, aliases: p.aliases.includes(name) ? p.aliases : [...p.aliases, name], updatedAt: Date.now() });
    await writeAudit(ctx, { dataset: p.dataset, actor: EDITOR_ACTOR, action: "product.update", entityType: "product", entityId: productId, summary: `עודכן מוצר: ${name}`, details: { before, after } });
    await scheduleRecompute(ctx, p.dataset);
  },
});

/** Sets (or clears, with `expectation: null`) the manual expectation for a product. */
export const setExpectation = mutation({
  args: {
    editorCode: v.string(),
    productId: v.id("products"),
    expectation: v.union(
      v.null(),
      v.object({
        usualQuantity: v.optional(v.number()),
        usualUnit: v.optional(unitValidator),
        expectedIntervalDays: v.optional(v.number()),
        maxPerMonth: v.optional(v.number()),
        minIntervalDays: v.optional(v.number()),
        quantityMin: v.optional(v.number()),
        quantityMax: v.optional(v.number()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { editorCode, productId, expectation }) => {
    requireEditor(editorCode);
    const p = await ctx.db.get(productId);
    if (!p) throw new ConvexError("המוצר לא נמצא");
    const existing = await ctx.db.query("productExpectations").withIndex("by_dataset_product", (q) => q.eq("dataset", p.dataset).eq("productId", productId)).first();
    if (expectation === null) {
      if (existing) await ctx.db.delete(existing._id);
      await writeAudit(ctx, { dataset: p.dataset, actor: EDITOR_ACTOR, action: "rule.clear", entityType: "rule", entityId: productId, summary: `הוסרה הציפייה הידנית למוצר: ${p.canonicalName}` });
      await scheduleRecompute(ctx, p.dataset);
      return;
    }
    positive(expectation.usualQuantity, "כמות רגילה");
    positive(expectation.expectedIntervalDays, "מרווח צפוי");
    positive(expectation.maxPerMonth, "מקסימום בחודש");
    positive(expectation.minIntervalDays, "מרווח מינימלי");
    positive(expectation.quantityMin, "כמות מינימלית");
    positive(expectation.quantityMax, "כמות מקסימלית");
    if (expectation.quantityMin && expectation.quantityMax && expectation.quantityMin > expectation.quantityMax) throw new ConvexError("טווח הכמות אינו תקין");
    const doc = { ...expectation, notes: cleanText(expectation.notes, 500), updatedAt: Date.now(), updatedBy: EDITOR_ACTOR };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("productExpectations", { dataset: p.dataset, productId, ...doc });
    await writeAudit(ctx, {
      dataset: p.dataset,
      actor: EDITOR_ACTOR,
      action: "rule.set",
      entityType: "rule",
      entityId: productId,
      summary: `עודכנה ציפייה ידנית למוצר: ${p.canonicalName}`,
      details: { before: existing ?? null, after: doc },
    });
    await scheduleRecompute(ctx, p.dataset);
  },
});

/** Merges `sourceId` into `targetId`: lines, wordings and history move to the target. */
export const merge = mutation({
  args: { editorCode: v.string(), sourceId: v.id("products"), targetId: v.id("products") },
  handler: async (ctx, { editorCode, sourceId, targetId }) => {
    requireEditor(editorCode);
    if (sourceId === targetId) throw new ConvexError("יש לבחור שני מוצרים שונים");
    const [src, tgt] = [await ctx.db.get(sourceId), await ctx.db.get(targetId)];
    if (!src || !tgt || src.dataset !== tgt.dataset || src.mergedIntoId || tgt.mergedIntoId) throw new ConvexError("המוצרים לא נמצאו");
    const items = await ctx.db.query("receiptItems").withIndex("by_dataset_product_date", (q) => q.eq("dataset", src.dataset).eq("productId", sourceId)).collect();
    for (const it of items) await ctx.db.patch(it._id, { productId: targetId });
    const aliases = [...tgt.aliases];
    for (const a of src.aliases) if (!aliases.some((x) => normalizeText(x) === normalizeText(a))) aliases.push(a);
    await ctx.db.patch(targetId, { aliases, updatedAt: Date.now() });
    await ctx.db.patch(sourceId, { mergedIntoId: targetId, updatedAt: Date.now() });
    const exp = await ctx.db.query("productExpectations").withIndex("by_dataset_product", (q) => q.eq("dataset", src.dataset).eq("productId", sourceId)).first();
    if (exp) await ctx.db.delete(exp._id);
    await writeAudit(ctx, {
      dataset: src.dataset,
      actor: EDITOR_ACTOR,
      action: "product.merge",
      entityType: "product",
      entityId: targetId,
      summary: `מוזג "${src.canonicalName}" אל "${tgt.canonicalName}" (${items.length} שורות)`,
      details: { sourceId, targetId, movedItemIds: items.map((i) => i._id), sourceAliases: src.aliases },
    });
    await scheduleRecompute(ctx, src.dataset);
    return { moved: items.length };
  },
});

/** Warns before merging products whose sizes or percentages differ. */
export const mergeCheck = query({
  args: { sourceId: v.id("products"), targetId: v.id("products") },
  handler: async (ctx, { sourceId, targetId }) => {
    const [a, b] = [await ctx.db.get(sourceId), await ctx.db.get(targetId)];
    if (!a || !b) return null;
    return {
      conflict: qualifiersConflict(extractQualifiers(a.canonicalName), extractQualifiers(b.canonicalName)),
      unitDiffers: a.unit !== b.unit,
    };
  },
});

/** Splits one receipt wording off into a new product, moving the lines that used it. */
export const splitAlias = mutation({
  args: { editorCode: v.string(), productId: v.id("products"), alias: v.string(), newName: v.string() },
  handler: async (ctx, { editorCode, productId, alias, newName }) => {
    requireEditor(editorCode);
    const p = await ctx.db.get(productId);
    if (!p) throw new ConvexError("המוצר לא נמצא");
    const name = cleanText(newName, 120);
    if (!name) throw new ConvexError("יש להזין שם למוצר החדש");
    const norm = normalizeText(alias);
    if (!p.aliases.some((a) => normalizeText(a) === norm)) throw new ConvexError("הניסוח לא נמצא במוצר");
    if (normalizeText(p.canonicalName) === norm) throw new ConvexError("לא ניתן לפצל את השם הראשי של המוצר — שנו קודם את שמו");
    const clash = await ctx.db.query("products").withIndex("by_dataset_name", (q) => q.eq("dataset", p.dataset).eq("canonicalName", name)).first();
    if (clash) throw new ConvexError("כבר קיים מוצר בשם זה");
    const now = Date.now();
    const newId: Id<"products"> = await ctx.db.insert("products", {
      dataset: p.dataset,
      canonicalName: name,
      aliases: [...new Set([name, alias])],
      category: p.category,
      unit: p.unit,
      expectedUse: p.expectedUse,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(productId, { aliases: p.aliases.filter((a) => normalizeText(a) !== norm), updatedAt: now });
    const items = await ctx.db.query("receiptItems").withIndex("by_dataset_product_date", (q) => q.eq("dataset", p.dataset).eq("productId", productId)).collect();
    const moved = items.filter((i) => normalizeText(i.originalDescription) === norm);
    for (const it of moved) await ctx.db.patch(it._id, { productId: newId });
    await writeAudit(ctx, {
      dataset: p.dataset,
      actor: EDITOR_ACTOR,
      action: "product.split",
      entityType: "product",
      entityId: newId,
      summary: `פוצל הניסוח "${alias}" מ"${p.canonicalName}" למוצר חדש "${name}" (${moved.length} שורות)`,
      details: { fromProductId: productId, movedItemIds: moved.map((i) => i._id) },
    });
    await scheduleRecompute(ctx, p.dataset);
    return { newProductId: newId, moved: moved.length };
  },
});
