import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { normalizeText } from "./normalize";
import type { Dataset } from "./receiptOps";

/**
 * Returns a lookup of previously confirmed wordings (canonical names and
 * aliases) to product IDs. Only exact matches of confirmed wording are
 * applied automatically; anything else stays unmatched for a person to
 * confirm.
 */
export async function confirmedWordingIndex(ctx: QueryCtx, dataset: Dataset) {
  const products = await ctx.db
    .query("products")
    .withIndex("by_dataset", (q) => q.eq("dataset", dataset))
    .collect();
  const index = new Map<string, Id<"products">>();
  for (const p of products) {
    if (p.mergedIntoId) continue;
    for (const name of [p.canonicalName, ...p.aliases]) {
      const key = normalizeText(name);
      // A wording claimed by two products is ambiguous: never auto-match it.
      if (index.has(key) && index.get(key) !== p._id) index.set(key, "" as Id<"products">);
      else index.set(key, p._id);
    }
  }
  return (description: string): Id<"products"> | undefined => {
    const id = index.get(normalizeText(description));
    return id ? id : undefined;
  };
}
