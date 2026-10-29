"use node";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireEditor } from "./lib/access";
import { ocrConfig } from "./lib/config";
import { OCR_SYSTEM_PROMPT, OcrReceiptSchema, convertOcr } from "./lib/ocrSchema";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

/**
 * Reads a receipt with Claude and stores the result as a draft for review.
 * This is a paid API call: it only runs when OCR_ENABLED=true and
 * ANTHROPIC_API_KEY are configured in the Convex environment.
 */
export const extract = action({
  args: { editorCode: v.string(), receiptId: v.id("receipts") },
  handler: async (ctx, { editorCode, receiptId }) => {
    requireEditor(editorCode);
    const cfg = ocrConfig();
    if (!cfg.enabled) throw new ConvexError("הקריאה האוטומטית כבויה. אפשר להזין את פרטי הקבלה ידנית.");
    const r = await ctx.runQuery(internal.ocrStore.getForOcr, { receiptId });
    if (!r) throw new ConvexError("הקבלה לא נמצאה");
    if (r.ocrStatus === "running") throw new ConvexError("הקריאה כבר מתבצעת");
    const fileId = r.ocrFileId ?? r.fileId;
    const fileType = r.ocrFileId ? "image/jpeg" : (r.fileType ?? "");
    if (!fileId) throw new ConvexError("לקבלה זו אין קובץ");

    await ctx.runMutation(internal.ocrStore.markRunning, { receiptId });
    try {
      const blob = await ctx.storage.get(fileId);
      if (!blob) throw new Error("הקובץ לא נמצא באחסון");
      const data = Buffer.from(await blob.arrayBuffer()).toString("base64");
      let block: Anthropic.Beta.BetaContentBlockParam;
      if (fileType === "application/pdf") {
        if (blob.size > MAX_PDF_BYTES) throw new Error("קובץ ה-PDF גדול מדי לקריאה אוטומטית");
        block = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
      } else if ((IMAGE_TYPES as readonly string[]).includes(fileType)) {
        if (blob.size > MAX_IMAGE_BYTES) throw new Error("התמונה גדולה מדי לקריאה אוטומטית");
        block = {
          type: "image",
          source: { type: "base64", media_type: fileType as (typeof IMAGE_TYPES)[number], data },
        };
      } else {
        throw new Error("סוג הקובץ אינו נתמך לקריאה אוטומטית (למשל HEIC). אפשר להזין ידנית.");
      }

      const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the Convex environment
      const supportsFallback = !cfg.model.startsWith("claude-haiku");
      const response = await client.beta.messages.parse({
        model: cfg.model,
        max_tokens: 16000,
        ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        output_config: { effort: "medium", format: betaZodOutputFormat(OcrReceiptSchema) },
        system: OCR_SYSTEM_PROMPT,
        messages: [{ role: "user", content: [block, { type: "text", text: "Read this grocery receipt." }] }],
      });
      if (response.stop_reason === "refusal") throw new Error("המודל סירב לקרוא את הקובץ");
      if (response.stop_reason === "max_tokens") throw new Error("הקבלה ארוכה מדי לקריאה אחת");
      const parsed = response.parsed_output;
      if (!parsed) throw new Error("לא התקבלה תשובה תקינה מהקריאה האוטומטית");
      const converted = convertOcr(parsed);
      await ctx.runMutation(internal.ocrStore.saveResult, {
        receiptId,
        model: response.model,
        json: JSON.stringify(parsed),
        rawText: parsed.rawText,
        confidence: parsed.overallConfidence,
        header: {
          storeName: converted.storeName,
          purchaseDate: converted.purchaseDate,
          receiptNumber: converted.receiptNumber,
          totalAgorot: converted.totalAgorot,
        },
        headerLowConfidence: converted.headerLowConfidence,
        lines: converted.lines,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      });
      return { ok: true as const };
    } catch (e) {
      let message: string;
      if (e instanceof Anthropic.AuthenticationError) message = "מפתח ה-API אינו תקין";
      else if (e instanceof Anthropic.RateLimitError) message = "יותר מדי בקשות — נסו שוב בעוד דקה";
      else if (e instanceof Anthropic.APIError) message = `שגיאת שירות הקריאה (${e.status ?? "?"})`;
      else message = e instanceof Error ? e.message : "שגיאה לא צפויה";
      await ctx.runMutation(internal.ocrStore.saveError, { receiptId, message });
      throw new ConvexError(message);
    }
  },
});
