import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { confidenceValidator } from "./schema";
import { requireEditor } from "./lib/access";
import { isValidIsoDate } from "./lib/dates";
import { applyOcrResult, ocrHeaderValidator, ocrLineValidator } from "./ocrStore";

export const FREE_OCR_MODEL = "Tesseract.js — חינמי, במכשיר (ניסוי)";

/**
 * Saves a receipt read in the browser with Tesseract.js (free, no external
 * service). The image never leaves the device for reading; only the structured
 * result is stored here, as a draft that a person reviews before approving.
 */
export const saveResult = mutation({
  args: {
    editorCode: v.string(),
    receiptId: v.id("receipts"),
    header: ocrHeaderValidator,
    headerLowConfidence: v.array(v.string()),
    lines: v.array(ocrLineValidator),
    rawText: v.string(),
    confidence: confidenceValidator,
    unrecognized: v.array(v.string()),
    dateText: v.optional(v.string()),
    durationMs: v.number(),
  },
  handler: async (ctx, a) => {
    requireEditor(a.editorCode);
    if (a.lines.length > 300 || a.unrecognized.length > 300) throw new ConvexError("יותר מדי שורות");
    if (a.header.purchaseDate !== undefined && !isValidIsoDate(a.header.purchaseDate)) throw new ConvexError("תאריך לא תקין");
    const whole = (n: number | undefined) => n === undefined || (Number.isInteger(n) && Math.abs(n) < 100_000_000);
    if (!whole(a.header.totalAgorot) || a.lines.some((l) => !whole(l.lineTotalAgorot) || !whole(l.unitPriceAgorot) || !whole(l.discountAgorot) || !Number.isFinite(l.quantity))) {
      throw new ConvexError("סכום לא תקין בתוצאת הקריאה");
    }
    const lines = a.lines.map((l) => ({ ...l, originalDescription: l.originalDescription.slice(0, 200) }));
    await applyOcrResult(ctx, {
      receiptId: a.receiptId,
      model: FREE_OCR_MODEL,
      json: JSON.stringify({
        engine: "tesseract.js",
        unrecognized: a.unrecognized.map((u) => u.slice(0, 200)),
        dateText: a.dateText,
        durationMs: Math.round(a.durationMs),
      }),
      rawText: a.rawText.slice(0, 20000),
      confidence: a.confidence,
      header: {
        ...a.header,
        storeName: a.header.storeName?.slice(0, 120),
        receiptNumber: a.header.receiptNumber?.slice(0, 60),
      },
      headerLowConfidence: a.headerLowConfidence,
      lines,
    });
  },
});
