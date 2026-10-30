import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireEditor } from "./lib/access";
import { geminiConfig } from "./lib/config";
import {
  GEMINI_API_BASE,
  GEMINI_FILE_TYPES,
  GEMINI_MAX_FILE_BYTES,
  GeminiError,
  buildGeminiRequest,
  convertGeminiReceipt,
  geminiHttpError,
  parseGeminiResponse,
  toBase64,
  type GeminiResponse,
} from "./lib/gemini";

const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Reads a receipt with the Gemini API free tier and stores the result as a
 * draft for review. Nothing counts in analytics or alerts until a person
 * approves it on the review screen. Each reading is counted against the
 * app's monthly limit before it is sent.
 */
export const extract = action({
  args: { editorCode: v.string(), receiptId: v.id("receipts") },
  handler: async (ctx, { editorCode, receiptId }) => {
    requireEditor(editorCode);
    const cfg = geminiConfig();
    if (!cfg.enabled) throw new ConvexError("הקריאה החכמה (Gemini) אינה מוגדרת. אפשר להשתמש בקריאה החינמית במכשיר או להזין ידנית.");
    const r = await ctx.runQuery(internal.ocrStore.getForOcr, { receiptId });
    if (!r) throw new ConvexError("הקבלה לא נמצאה");
    if (r.verificationStatus === "verified") throw new ConvexError("קבלה שאושרה אינה נקראת מחדש");
    if (r.ocrStatus === "running") throw new ConvexError("הקריאה כבר מתבצעת");
    // Prefer the downscaled JPEG copy made in the browser; Gemini also reads
    // the original directly (HEIC and PDF included).
    const fileId = r.ocrFileId ?? r.fileId;
    const mimeType = r.ocrFileId ? "image/jpeg" : (r.fileType ?? "");
    if (!fileId) throw new ConvexError("לקבלה זו אין קובץ");
    if (!GEMINI_FILE_TYPES.includes(mimeType)) throw new ConvexError("סוג הקובץ אינו נתמך בקריאה החכמה. אפשר להזין ידנית.");
    const blob = await ctx.storage.get(fileId);
    if (!blob) throw new ConvexError("הקובץ לא נמצא באחסון");
    if (blob.size > GEMINI_MAX_FILE_BYTES) throw new ConvexError("הקובץ גדול מדי לקריאה החכמה");

    await ctx.runMutation(internal.aiUsage.reserveGemini, { limit: cfg.monthlyLimit });
    await ctx.runMutation(internal.ocrStore.markRunning, { receiptId });
    try {
      const body = JSON.stringify(buildGeminiRequest(mimeType, toBase64(new Uint8Array(await blob.arrayBuffer()))));
      let lastError: GeminiError | null = null;
      for (const model of cfg.models) {
        try {
          const res = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (!res.ok) throw geminiHttpError(res.status, await res.text());
          const data = (await res.json()) as GeminiResponse;
          const parsed = parseGeminiResponse(data);
          const converted = convertGeminiReceipt(parsed, new Date().toISOString().slice(0, 10));
          await ctx.runMutation(internal.ocrStore.saveResult, {
            receiptId,
            model: `Gemini · ${data.modelVersion ?? model} (שכבה חינמית)`,
            json: JSON.stringify(parsed),
            rawText: parsed.rawText.slice(0, 20000),
            confidence: converted.confidence,
            header: {
              storeName: converted.storeName?.slice(0, 120),
              purchaseDate: converted.purchaseDate,
              receiptNumber: converted.receiptNumber?.slice(0, 60),
              totalAgorot: converted.totalAgorot,
            },
            headerLowConfidence: converted.headerLowConfidence,
            lines: converted.lines.slice(0, 300).map((l) => ({ ...l, originalDescription: l.originalDescription.slice(0, 200) })),
            usage: {
              inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
              outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
            },
          });
          return { ok: true as const, model: data.modelVersion ?? model, lines: converted.lines.length };
        } catch (e) {
          if (e instanceof GeminiError && e.tryNextModel) {
            lastError = e;
            continue;
          }
          throw e;
        }
      }
      throw lastError ?? new GeminiError("שירות Gemini אינו זמין");
    } catch (e) {
      let message: string;
      if (e instanceof GeminiError) message = e.message;
      else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) message = "הקריאה לקחה יותר מדי זמן. נסו שוב.";
      else message = "לא ניתן היה להתחבר לשירות Gemini";
      await ctx.runMutation(internal.ocrStore.saveError, { receiptId, message });
      throw new ConvexError(message);
    }
  },
});
