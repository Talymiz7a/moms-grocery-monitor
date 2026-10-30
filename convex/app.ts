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
