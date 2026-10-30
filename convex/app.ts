import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { isEditorCodeValid } from "./lib/access";
import { geminiUsedThisMonth } from "./aiUsage";
import { geminiApiKey, geminiConfig, ocrConfig } from "./lib/config";
import { fileLinkSecret } from "./lib/fileLinks";

/** Server configuration the UI needs (never returns secrets). */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const ocr = ocrConfig();
    const gemini = geminiConfig();
    return {
      editingConfigured: !!process.env.EDITOR_CODE && process.env.EDITOR_CODE.length >= 8,
      fileLinksConfigured: fileLinkSecret() !== null,
      ocrEnabled: ocr.enabled,
      ocrModel: ocr.model,
      gemini: {
        enabled: gemini.enabled,
        monthlyLimit: gemini.monthlyLimit,
        usedThisMonth: await geminiUsedThisMonth(ctx),
      },
    };
  },
});

export const verifyEditorCode = mutation({
  args: { code: v.string() },
  handler: async (_ctx, { code }) => {
    return { valid: isEditorCodeValid(code) };
  },
});

/**
 * Configuration check for the Gemini reader, run from the CLI
 * (`npx convex run --prod app:geminiDiagnostics`). Reports variable names and
 * the key's shape only — never its value.
 */
export const geminiDiagnostics = internalQuery({
  args: {},
  handler: async () => {
    const key = geminiApiKey();
    const raw = process.env.GEMINI_API_KEY;
    return {
      relatedVariableNames: Object.keys(process.env).filter((n) => /GEMINI|GOOGLE|GENAI/i.test(n)).sort(),
      keySet: !!key,
      keyHadSpacesOrQuotes: !!raw && raw !== key,
      keyLength: key?.length ?? 0,
      keyLooksLikeGoogleKey: !!key && /^AIza[0-9A-Za-z_-]{30,}$/.test(key),
      switchedOff: process.env.GEMINI_OCR_ENABLED?.trim().toLowerCase() === "false",
      enabled: geminiConfig().enabled,
    };
  },
});

/**
 * Diagnostic for receipt reading, run from the CLI
 * (`npx convex run --prod app:recentReadings`): the latest receipts with their
 * reading results, for comparing against the original image.
 */
export const recentReadings = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("receipts").order("desc").take(Math.min(limit ?? 3, 10));
    return Promise.all(
      rows.map(async (r) => ({
        id: r._id,
        dataset: r.dataset,
        uploadedAt: new Date(r.uploadedAt).toISOString(),
        fileType: r.fileType,
        hasOcrCopy: !!r.ocrFileId,
        fileUrl: r.fileId ? await ctx.storage.getUrl(r.fileId) : null,
        ocrCopyUrl: r.ocrFileId ? await ctx.storage.getUrl(r.ocrFileId) : null,
        ocrStatus: r.ocrStatus,
        ocrModel: r.ocrModel,
        ocrError: r.ocrError,
        ocrConfidence: r.ocrConfidence,
        verificationStatus: r.verificationStatus,
        header: { storeName: r.storeName, purchaseDate: r.purchaseDate, totalAgorot: r.totalAgorot },
        reconciliation: r.reconciliation,
        ocrJson: r.ocrJson,
      })),
    );
  },
});
