import { v } from "convex/values";
import { query } from "./_generated/server";
import { datasetValidator } from "./schema";
import { suggestMatches } from "./lib/normalize";

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
