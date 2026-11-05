import { ConvexError, v } from "convex/values";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { usageMonth } from "./lib/gemini";

export async function geminiUsedThisMonth(ctx: QueryCtx, now = Date.now()) {
  const row = await ctx.db
    .query("aiUsage")
    .withIndex("by_provider_month", (q) => q.eq("provider", "gemini").eq("month", usageMonth(now)))
    .unique();
  return row?.count ?? 0;
}

/**
 * Counts one Gemini reading against the monthly limit, before the request is
 * sent. Refuses when the limit is reached. Failed readings still count, so
 * the limit can never be exceeded.
 */
export const reserveGemini = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const month = usageMonth(now);
    const row = await ctx.db
      .query("aiUsage")
      .withIndex("by_provider_month", (q) => q.eq("provider", "gemini").eq("month", month))
      .unique();
    const used = row?.count ?? 0;
    if (used >= limit) {
      throw new ConvexError(`הגעתם למגבלה של ${limit} קריאות Gemini בחודש. אפשר להשתמש בקריאה החינמית במכשיר או להזין את הקבלה ידנית.`);
    }
    if (row) await ctx.db.patch(row._id, { count: used + 1, updatedAt: now });
    else await ctx.db.insert("aiUsage", { provider: "gemini", month, count: 1, updatedAt: now });
    return { used: used + 1 };
  },
});
