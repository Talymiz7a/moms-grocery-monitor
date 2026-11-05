import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { requireEditor } from "./lib/access";
import { geminiApiKey, geminiConfig, type GeminiMode } from "./lib/config";
import {
  GEMINI_API_BASE,
  GEMINI_FILE_TYPES,
  GEMINI_MAX_FILE_BYTES,
  GeminiError,
  attemptTimeoutMs,
  buildGeminiRequest,
  convertGeminiReceipt,
  geminiHttpError,
  parseGeminiResponse,
  toBase64,
  type GeminiResponse,
} from "./lib/gemini";

const modeValidator = v.union(v.literal("fast"), v.literal("careful"));

/**
 * Reads a receipt with the Gemini API free tier and stores the result as a
 * draft for review. Nothing counts in analytics or alerts until a person
 * approves it on the review screen. Each reading is counted against the
 * app's monthly limit before it is sent.
 *
 * "fast" (default) uses Flash-Lite, a few seconds; "careful" uses Flash, which
 * reads product names better but takes a minute or two.
 */
export const extract = action({
  args: { editorCode: v.string(), receiptId: v.id("receipts"), mode: v.optional(modeValidator) },
  handler: async (ctx, { editorCode, receiptId, mode }) => {
    requireEditor(editorCode);
    return readWithGemini(ctx, receiptId, mode ?? "fast");
  },
});

/** Same reading, for checking a receipt from the Convex CLI (admin only). */
export const extractFromCli = internalAction({
  args: { receiptId: v.id("receipts"), mode: v.optional(modeValidator) },
  handler: async (ctx, { receiptId, mode }) => readWithGemini(ctx, receiptId, mode ?? "fast"),
});

/** A reading left "running" this long ago was interrupted and may be retried. */
const STALE_RUNNING_MS = 6 * 60_000;

async function readWithGemini(ctx: ActionCtx, receiptId: Id<"receipts">, mode: GeminiMode) {
  const cfg = geminiConfig(mode);
  if (!cfg.enabled) throw new ConvexError("הקריאה החכמה (Gemini) אינה מוגדרת. אפשר להשתמש בקריאה החינמית במכשיר או להזין ידנית.");
  const r = await ctx.runQuery(internal.ocrStore.getForOcr, { receiptId });
  if (!r) throw new ConvexError("הקבלה לא נמצאה");
  if (r.verificationStatus === "verified") throw new ConvexError("קבלה שאושרה אינה נקראת מחדש");
  if (r.ocrStatus === "running" && Date.now() - r.updatedAt < STALE_RUNNING_MS) throw new ConvexError("הקריאה כבר מתבצעת");
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
    const data64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
    let lastError: GeminiError | null = null;
    for (const model of cfg.models) {
      const startedAt = Date.now();
      try {
        const res = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey()! },
          body: JSON.stringify(buildGeminiRequest(mimeType, data64, model)),
          signal: AbortSignal.timeout(attemptTimeoutMs(model)),
        });
        if (!res.ok) {
          const text = await res.text();
          // Google's own explanation, visible in the Convex logs (no key in it).
          console.warn(`Gemini ${model}: HTTP ${res.status} ${text.slice(0, 600)}`);
          throw geminiHttpError(res.status, text);
        }
        const data = (await res.json()) as GeminiResponse;
        const parsed = parseGeminiResponse(data);
        const converted = convertGeminiReceipt(parsed, new Date().toISOString().slice(0, 10));
        const version = data.modelVersion ?? model;
        console.log(`Gemini ${version}: ${converted.lines.length} lines in ${Date.now() - startedAt} ms`);
        await ctx.runMutation(internal.ocrStore.saveResult, {
          receiptId,
          model: `Gemini · ${version} (שכבה חינמית)`,
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
        return { ok: true as const, model: version, lines: converted.lines.length, ms: Date.now() - startedAt };
      } catch (e) {
        if (e instanceof GeminiError && e.tryNextModel) {
          lastError = e;
          continue;
        }
        if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
          console.warn(`Gemini ${model}: no answer after ${Date.now() - startedAt} ms`);
          lastError = new GeminiError("Gemini לא ענה בזמן. נסו שוב בעוד כמה דקות.", true);
          continue;
        }
        throw e;
      }
    }
    throw lastError ?? new GeminiError("שירות Gemini אינו זמין");
  } catch (e) {
    const message = e instanceof GeminiError ? e.message : "לא ניתן היה להתחבר לשירות Gemini";
    if (!(e instanceof GeminiError)) console.error("Gemini reading failed", e);
    await ctx.runMutation(internal.ocrStore.saveError, { receiptId, message });
    throw new ConvexError(message);
  }
}

/**
 * Admin-only check from the Convex CLI: which Flash models the key can use,
 * and how each one answers on a receipt (timing, token use, a short summary).
 * Nothing is saved; each run counts as one reading against the monthly limit.
 */
export const diagnose = internalAction({
  args: { receiptId: v.id("receipts"), models: v.optional(v.array(v.string())), thinkingBudget: v.optional(v.number()), timeoutMs: v.optional(v.number()) },
  handler: async (ctx, { receiptId, models, thinkingBudget, timeoutMs }) => {
    const cfg = geminiConfig();
    if (!cfg.enabled) return { error: "not configured" };
    const key = geminiApiKey()!;
    const list = await fetch(`${GEMINI_API_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
    const listJson = (await list.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    const available = (listJson.models ?? [])
      .filter((m) => /flash/.test(m.name) && m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
    const r = await ctx.runQuery(internal.ocrStore.getForOcr, { receiptId });
    const fileId = r?.ocrFileId ?? r?.fileId;
    if (!fileId) return { available, error: "no file" };
    const blob = (await ctx.storage.get(fileId))!;
    await ctx.runMutation(internal.aiUsage.reserveGemini, { limit: cfg.monthlyLimit });
    const mimeType = r?.ocrFileId ? "image/jpeg" : (r?.fileType ?? "");
    const data64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
    const attempts = [];
    for (const model of models ?? cfg.models) {
      const request = buildGeminiRequest(mimeType, data64, model);
      if (thinkingBudget !== undefined) (request.generationConfig as Record<string, unknown>).thinkingConfig = { thinkingBudget };
      const t0 = Date.now();
      try {
        const res = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs ?? 280_000),
        });
        const text = await res.text();
        const ms = Date.now() - t0;
        if (!res.ok) {
          attempts.push({ model, ms, status: res.status, body: text.slice(0, 400) });
          continue;
        }
        const data = JSON.parse(text) as GeminiResponse;
        let summary: unknown;
        try {
          const p = parseGeminiResponse(data);
          summary = { store: p.storeName, date: p.purchaseDate, total: p.total, items: p.items.map((i) => `${i.description} | ${i.quantity} ${i.unit ?? ""} x ${i.unitPrice} = ${i.lineTotal}${i.discount ? ` -${i.discount}` : ""} [${i.lineType}/${i.confidence}${i.uncertainFields.length ? " ?" + i.uncertainFields.join(",") : ""}]`) };
        } catch (e) {
          summary = { parseError: e instanceof Error ? e.message : String(e), text: text.slice(0, 300) };
        }
        attempts.push({ model, ms, status: 200, modelVersion: data.modelVersion, finishReason: data.candidates?.[0]?.finishReason, usage: data.usageMetadata, summary });
      } catch (e) {
        attempts.push({ model, ms: Date.now() - t0, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
      }
    }
    return { available, attempts };
  },
});
