// Receipt reading with the Gemini API (free tier): the request body, the JSON
// layout the model must answer in, and checks on the answer. The answer uses
// the same structure as the Claude reader (OcrReceiptSchema), so it is stored
// and reviewed exactly the same way.

import { OCR_SYSTEM_PROMPT, OcrReceiptSchema, convertOcr, type OcrReceipt } from "./ocrSchema";
import { reconcile } from "./reconcile";

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini accepts these inline (HEIC from the iPad included). */
export const GEMINI_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
/** Inline requests are limited to 20 MB after base64 encoding. */
export const GEMINI_MAX_FILE_BYTES = 14 * 1024 * 1024;

const nullableNumber = (description?: string) => ({ type: "NUMBER", nullable: true, ...(description ? { description } : {}) });

const ITEM_FIELDS = ["description", "quantity", "unit", "unitPrice", "lineTotal", "discount", "lineType", "confidence", "uncertainFields"];
const RECEIPT_FIELDS = ["rawText", "storeName", "purchaseDate", "receiptNumber", "items", "total", "uncertainHeaderFields", "overallConfidence", "notes"];

/** OcrReceiptSchema in the OpenAPI form Gemini's responseSchema expects. */
export const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    rawText: { type: "STRING", description: "Line-by-line transcription of the whole receipt in reading order" },
    storeName: { type: "STRING", nullable: true },
    purchaseDate: { type: "STRING", nullable: true, description: "Date as printed, day first (DD/MM/YYYY)" },
    receiptNumber: { type: "STRING", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING", description: "Item text exactly as printed" },
          quantity: nullableNumber("Units or weight; negative for returns"),
          unit: { type: "STRING", enum: ["unit", "kg", "g", "l", "ml", "pack"], nullable: true },
          unitPrice: nullableNumber("Price per unit in ILS"),
          lineTotal: nullableNumber("Line amount in ILS as printed; negative for discounts/returns"),
          discount: nullableNumber("Positive ILS discount printed for this specific line"),
          lineType: { type: "STRING", enum: ["item", "discount", "return", "deposit"] },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
          uncertainFields: { type: "ARRAY", items: { type: "STRING", enum: ["description", "quantity", "unitPrice", "lineTotal", "discount"] } },
        },
        required: ITEM_FIELDS,
        propertyOrdering: ITEM_FIELDS,
      },
    },
    total: nullableNumber("Grand total to pay in ILS as printed"),
    uncertainHeaderFields: { type: "ARRAY", items: { type: "STRING", enum: ["storeName", "purchaseDate", "receiptNumber", "total"] } },
    overallConfidence: { type: "STRING", enum: ["high", "medium", "low"] },
    notes: { type: "STRING", nullable: true, description: "Problems such as blur, cut-off parts or unreadable areas" },
  },
  required: RECEIPT_FIELDS,
  propertyOrdering: RECEIPT_FIELDS,
};

export const GEMINI_PROMPT = `${OCR_SYSTEM_PROMPT}

Israeli supermarket receipts:
- Write Hebrew text in normal reading order (never reversed), keeping abbreviations such as ק"ג, יח', גר', ליט' as printed.
- A quantity line such as "2 X 5.90" or "1.235 ק"ג X 12.90" belongs to the item next to it: put it in that item's quantity and unitPrice; do not create a separate line for it.
- Lines such as הנחה, מבצע, הנחת מועדון, קופון are discounts. פיקדון is a deposit line.
- Skip lines that are not purchases: subtotal (סה"כ ביניים), VAT (מע"מ), payment method, change (עודף), card details, loyalty points, savings summaries (חסכת), cashier and branch details.
- total is the final amount to pay (סה"כ לתשלום) after all discounts.
- In rawText, replace payment card numbers, customer names and phone numbers with ***.`;

/** Request body for models/{model}:generateContent. */
export function buildGeminiRequest(mimeType: string, base64Data: string) {
  return {
    systemInstruction: { parts: [{ text: GEMINI_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType, data: base64Data } }, { text: "Read this grocery receipt." }],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 32768,
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };
}

type GeminiPart = { text?: string; thought?: boolean };
export type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
};

/** A failure the reader can explain to the person; `tryNextModel` moves on to the next model. */
export class GeminiError extends Error {
  constructor(message: string, readonly tryNextModel = false) {
    super(message);
  }
}

/** Interprets an HTTP error from the Gemini API. */
export function geminiHttpError(status: number, body: string): GeminiError {
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(body)) return new GeminiError("מפתח ה-Gemini אינו תקין. בדקו את GEMINI_API_KEY בהגדרות Convex.");
  if (status === 400 && /location is not supported|FAILED_PRECONDITION/i.test(body)) return new GeminiError("השכבה החינמית של Gemini אינה זמינה לבקשה זו.");
  if (status === 401 || status === 403) return new GeminiError("אין הרשאה לשירות Gemini עם המפתח הזה.");
  if (status === 404) return new GeminiError("המודל אינו זמין", true);
  if (status === 429) return new GeminiError("הגעתם למגבלת השימוש החינמי של Google. נסו שוב מאוחר יותר, או השתמשו בקריאה החינמית במכשיר.", true);
  if (status >= 500) return new GeminiError("שירות Gemini עמוס או לא זמין כרגע. נסו שוב בעוד כמה דקות.", true);
  return new GeminiError(`שגיאת שירות Gemini (${status})`);
}

function toNumber(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const n = Number(v.replace(/[₪,\s]/g, ""));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** Fills in fields the model left out and turns numeric strings into numbers. */
function normalize(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : [];
  return {
    storeName: r.storeName ?? null,
    purchaseDate: r.purchaseDate ?? null,
    receiptNumber: r.receiptNumber == null ? null : String(r.receiptNumber),
    total: toNumber(r.total ?? null),
    overallConfidence: r.overallConfidence ?? "low",
    uncertainHeaderFields: r.uncertainHeaderFields ?? [],
    rawText: r.rawText ?? "",
    notes: r.notes ?? null,
    items: items.map((it: Record<string, unknown>) => ({
      description: it.description ?? "",
      quantity: toNumber(it.quantity ?? null),
      unit: it.unit ?? null,
      unitPrice: toNumber(it.unitPrice ?? null),
      lineTotal: toNumber(it.lineTotal ?? null),
      discount: toNumber(it.discount ?? null),
      lineType: it.lineType ?? "item",
      confidence: it.confidence ?? "low",
      uncertainFields: it.uncertainFields ?? [],
    })),
  };
}

/** Extracts and validates the receipt JSON from a generateContent response. */
export function parseGeminiResponse(res: GeminiResponse): OcrReceipt {
  if (res.promptFeedback?.blockReason) throw new GeminiError("Gemini סירב לקרוא את הקובץ");
  const candidate = res.candidates?.[0];
  if (!candidate) throw new GeminiError("לא התקבלה תשובה מ-Gemini", true);
  if (candidate.finishReason === "MAX_TOKENS") throw new GeminiError("הקבלה ארוכה מדי לקריאה אחת");
  if (candidate.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason)) {
    throw new GeminiError(`Gemini הפסיק את הקריאה (${candidate.finishReason})`);
  }
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, "");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GeminiError("התשובה מ-Gemini אינה בפורמט תקין", true);
  }
  const parsed = OcrReceiptSchema.safeParse(normalize(json));
  if (!parsed.success) throw new GeminiError("התשובה מ-Gemini חסרה שדות נדרשים", true);
  return parsed.data;
}

const lowerConfidence = (c: "high" | "medium" | "low"): "medium" | "low" => (c === "high" ? "medium" : "low");

/**
 * Converts the answer into app lines and adds the app's own checks on top of
 * the model's: lines whose quantity × unit price does not give the line total,
 * dates in the future, and a total that the lines do not add up to are all
 * flagged for review. Values are never changed.
 */
export function convertGeminiReceipt(ocr: OcrReceipt, todayIso: string) {
  const converted = convertOcr(ocr);
  const rec = reconcile(converted.lines, converted.totalAgorot);
  for (const check of rec.lineChecks) {
    const line = converted.lines[check.index];
    line.lowConfidenceFields = [...new Set([...line.lowConfidenceFields, "quantity", "unitPrice", "lineTotal"])];
    line.confidence = lowerConfidence(line.confidence);
  }
  const headerLow = new Set(converted.headerLowConfidence);
  if (converted.purchaseDate && converted.purchaseDate > todayIso) headerLow.add("purchaseDate");
  if (rec.status === "mismatch") headerLow.add("total");
  let confidence = ocr.overallConfidence;
  if (rec.status === "mismatch" || rec.lineChecks.length > 0 || headerLow.size > 0) {
    confidence = confidence === "high" ? "medium" : confidence;
  }
  return { ...converted, headerLowConfidence: [...headerLow], confidence };
}

/** Base64 for a file's bytes, without Node's Buffer. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** "YYYY-MM" in UTC, used for the monthly limit. */
export function usageMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}
