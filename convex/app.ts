import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isEditorCodeValid } from "./lib/access";
import { geminiUsedThisMonth } from "./aiUsage";
import { geminiConfig, ocrConfig } from "./lib/config";
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
