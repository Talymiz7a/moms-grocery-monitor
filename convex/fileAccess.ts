import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const fileForReceipt = internalQuery({
  args: { receiptId: v.string() },
  handler: async (ctx, { receiptId }) => {
    const id = ctx.db.normalizeId("receipts", receiptId);
    if (!id) return null;
    const r = await ctx.db.get(id);
    if (!r?.fileId) return null;
    return { fileId: r.fileId, fileType: r.fileType };
  },
});
