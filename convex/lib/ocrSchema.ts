// Structured output requested from Claude when reading a receipt, plus the
// conversion into the app's own line format. Values the model cannot read
// must come back as null — never guessed.

import { z } from "zod";
import { parseDayFirstDate } from "./dates";
import { toAgorot } from "./money";

export const OcrItemSchema = z.object({
  description: z.string().describe("Item text exactly as printed, in the original language and spelling"),
  quantity: z.number().nullable().describe("Units or weight; negative for returns"),
  unit: z.enum(["unit", "kg", "g", "l", "ml", "pack"]).nullable(),
  unitPrice: z.number().nullable().describe("Price per unit in ILS"),
  lineTotal: z.number().nullable().describe("Line amount in ILS as printed; negative for discounts/returns"),
  discount: z.number().nullable().describe("Positive ILS discount printed for this specific line"),
  lineType: z.enum(["item", "discount", "return", "deposit"]),
  confidence: z.enum(["high", "medium", "low"]),
  uncertainFields: z.array(z.enum(["description", "quantity", "unitPrice", "lineTotal", "discount"])),
});

export const OcrReceiptSchema = z.object({
  storeName: z.string().nullable(),
  purchaseDate: z.string().nullable().describe("Date as printed, day first (DD/MM/YYYY)"),
  receiptNumber: z.string().nullable(),
  total: z.number().nullable().describe("Grand total to pay in ILS as printed"),
  items: z.array(OcrItemSchema),
  overallConfidence: z.enum(["high", "medium", "low"]),
  uncertainHeaderFields: z.array(z.enum(["storeName", "purchaseDate", "receiptNumber", "total"])),
  rawText: z.string().describe("Full receipt text transcription, line by line"),
  notes: z.string().nullable().describe("Problems such as blur, cut-off parts or unreadable areas"),
});

export type OcrReceipt = z.infer<typeof OcrReceiptSchema>;

export const OCR_SYSTEM_PROMPT = `You read Israeli grocery receipts (mostly Hebrew, sometimes mixed with English) and return their contents as structured data.

Rules:
- Copy item descriptions exactly as printed, including abbreviations. Do not translate or "fix" them.
- Never invent values. If a value is unreadable, cut off or absent, return null and list the field in uncertainFields (or uncertainHeaderFields).
- Mark confidence "low" for any line you had to partially guess.
- Dates in Israel are day-first. Return purchaseDate exactly as printed in DD/MM/YYYY form.
- Amounts are in ILS. Discount and return lines have negative lineTotal. A discount printed under an item that applies only to that item goes in that item's discount field as a positive number instead of a separate line.
- Weighed produce: quantity is the weight and unit is "kg".
- Do not reconcile or adjust amounts to make them add up; report what is printed.
- rawText is a faithful line-by-line transcription of the whole receipt.`;

export type ConvertedLine = {
  originalDescription: string;
  lineType: "item" | "discount" | "return" | "deposit";
  quantity: number;
  unit: "unit" | "kg" | "g" | "l" | "ml" | "pack";
  unitPriceAgorot?: number;
  lineTotalAgorot: number;
  discountAgorot?: number;
  confidence: "high" | "medium" | "low";
  lowConfidenceFields: string[];
};

/** Converts the model output into app lines. Missing numbers are flagged, not filled in. */
export function convertOcr(ocr: OcrReceipt) {
  const lines: ConvertedLine[] = ocr.items.map((it) => {
    const low = new Set<string>(it.uncertainFields);
    if (it.quantity == null) low.add("quantity");
    if (it.lineTotal == null) low.add("lineTotal");
    const hasMissing = it.quantity == null || it.lineTotal == null;
    return {
      originalDescription: it.description,
      lineType: it.lineType,
      quantity: it.quantity ?? 1,
      unit: it.unit ?? "unit",
      unitPriceAgorot: it.unitPrice == null ? undefined : toAgorot(it.unitPrice),
      lineTotalAgorot: it.lineTotal == null ? 0 : toAgorot(it.lineTotal),
      discountAgorot: it.discount == null || it.discount === 0 ? undefined : toAgorot(Math.abs(it.discount)),
      confidence: hasMissing ? "low" : it.confidence,
      lowConfidenceFields: [...low],
    };
  });
  const purchaseDate = ocr.purchaseDate ? parseDayFirstDate(ocr.purchaseDate) : null;
  const headerLow = new Set<string>(ocr.uncertainHeaderFields);
  if (ocr.purchaseDate && !purchaseDate) headerLow.add("purchaseDate");
  return {
    storeName: ocr.storeName ?? undefined,
    purchaseDate: purchaseDate ?? undefined,
    receiptNumber: ocr.receiptNumber ?? undefined,
    totalAgorot: ocr.total == null ? undefined : toAgorot(ocr.total),
    lines,
    headerLowConfidence: [...headerLow],
  };
}
