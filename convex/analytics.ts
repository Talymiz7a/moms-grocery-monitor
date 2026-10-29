import { v } from "convex/values";
import { query } from "./_generated/server";
import { datasetValidator } from "./schema";
import { monthlyGrid, productHistory } from "./lib/analytics";
import { loadFacts } from "./lib/facts";

/** Years that have verified purchases, newest first. */
export const years = query({
  args: { dataset: datasetValidator },
  handler: async (ctx, { dataset }) => {
    const { receipts } = await loadFacts(ctx, dataset);
    return [...new Set(receipts.map((r) => Number(r.date.slice(0, 4))))].sort((a, b) => b - a);
  },
});

/** Products × 12 months: purchase occasions (distinct receipts), quantities and line appearances. */
export const monthlyFrequency = query({
  args: { dataset: datasetValidator, year: v.number() },
  handler: async (ctx, { dataset, year }) => {
    const { occasions, products } = await loadFacts(ctx, dataset);
    return monthlyGrid(occasions, products, year);
  },
});

export const productDetail = query({
  args: { dataset: datasetValidator, productId: v.id("products") },
  handler: async (ctx, { dataset, productId }) => {
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
