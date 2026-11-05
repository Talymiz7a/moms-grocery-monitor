import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { mergePasses, parseAmount, type MergedLine, type OcrPass } from "../convex/lib/ocrMerge";
import { parseQuantityLine, parseReceipt } from "../convex/lib/receiptParser";
import { reconcile } from "../convex/lib/reconcile";

const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const truth = fixture("ocr-truth.json");

function line(text: string, amount?: number, conf = 95, raw?: string): MergedLine {
  return {
    y: 0,
    tokens: text.split(" ").map((t) => ({ text: t, conf, x0: 0, x1: 0, y0: 0, y1: 0 })),
    text,
    amounts: amount === undefined ? [] : [{ value: amount, text: amount.toFixed(2), conf, x0: 0 }],
    raw: raw ?? (amount === undefined ? text : `${text} ${amount.toFixed(2)}`),
    numericText: raw ?? text,
    conf,
  };
}

describe("OCR helpers", () => {
  test("amounts with trailing or leading minus, comma decimals and currency", () => {
    expect(parseAmount("3.70-")).toBe(-3.7);
    expect(parseAmount("-3.70")).toBe(-3.7);
    expect(parseAmount("12,90")).toBe(12.9);
    expect(parseAmount("₪96.32")).toBe(96.32);
    expect(parseAmount("520022732")).toBeNull();
    expect(parseAmount("1.235")).toBeNull();
  });
  test("quantity lines: units, weights, X read as aleph, split weights", () => {
    expect(parseQuantityLine("2 יח' X 6.90")).toEqual({ quantity: 2, unitPrice: 6.9, weighed: false });
    expect(parseQuantityLine("3 'n 5.90 א")).toEqual({ quantity: 3, unitPrice: 5.9, weighed: false });
    expect(parseQuantityLine('1.235 ק"ג X 7.90')).toEqual({ quantity: 1.235, unitPrice: 7.9, weighed: true });
    expect(parseQuantityLine("235 1 Alp 7.90 א")).toEqual({ quantity: 1.235, unitPrice: 7.9, weighed: true });
    expect(parseQuantityLine("חלב 3% 1 ליטר")).toBeNull();
  });
});

describe("receipt parser (layouts)", () => {
  const header = [line("סופר השכונה"), line("תאריך: 14/10/2026 שעה: 18:42", undefined, 95, "תאריך: 14/10/2026 שעה: 18:42")];
  test("quantity under the description; discount; total; reconciliation matches", () => {
    const r = parseReceipt([
      ...header,
      line("חלב 3% 1 ליטר", 13.8),
      line("2 יח' X 6.90"),
      line("קוטג' 5%", 17.7),
      line("3 יח' X 5.90"),
      line("הנחת מבצע", -3.7),
      line("עגבניות", 9.76),
      line('1.235 ק"ג X 7.90'),
      line('סה"כ לתשלום', 37.56),
      line("אשראי ויזה", 37.56),
    ]);
    expect(r.purchaseDate).toBe("2026-10-14");
    expect(r.storeName).toBe("סופר השכונה");
    expect(r.totalAgorot).toBe(3756);
    expect(r.lines.map((l) => [l.originalDescription, l.lineType, l.quantity, l.unit])).toEqual([
      ["חלב 3% 1 ליטר", "item", 2, "unit"],
      ["קוטג' 5%", "item", 3, "unit"],
      ["הנחת מבצע", "discount", 1, "unit"],
      ["עגבניות", "item", 1.235, "kg"],
    ]);
    expect(reconcile(r.lines, r.totalAgorot).status).toBe("match");
    expect(r.unrecognized).toEqual([]);
  });
  test("description first, then a quantity line carrying the total", () => {
    const r = parseReceipt([...header, line("שמנת חמוצה 15%"), line("3 יח' X 4.90", 14.7), line("לחם אחיד", 8.5), line('סה"כ לתשלום', 23.2)]);
    expect(r.lines.map((l) => [l.originalDescription, l.quantity, l.lineTotalAgorot])).toEqual([
      ["שמנת חמוצה 15%", 3, 1470],
      ["לחם אחיד", 1, 850],
    ]);
  });
  test("quantity that disagrees with the line total is derived from the total and flagged", () => {
    const r = parseReceipt([...header, line("בננות", 8.74), line('2 ק"ג X 8.90'), line('סה"כ לתשלום', 8.74)]);
    expect(r.lines[0].quantity).toBe(0.982);
    expect(r.lines[0].lowConfidenceFields).toContain("quantity");
  });
  test("missing amount on a quantity line is computed and flagged, not attached elsewhere", () => {
    const r = parseReceipt([...header, line("טחינה", 16.9), line("בצל יבש"), line('0.387 ק"ג X 3.90'), line('סה"כ לתשלום', 18.41)]);
    expect(r.lines[1]).toMatchObject({ originalDescription: "בצל יבש", quantity: 0.387, lineTotalAgorot: 151 });
    expect(r.lines[1].lowConfidenceFields).toContain("lineTotal");
    expect(r.lines[0].quantity).toBe(1);
  });
  test("mismatch with the printed total flags amounts that were not confirmed", () => {
    const r = parseReceipt([...header, line("מים", 16.3, 90), line("תה", 15.1, 96), line('סה"כ לתשלום', 32.0)]);
    expect(r.lines[0].lowConfidenceFields).toContain("lineTotal");
    expect(r.lines[1].lowConfidenceFields).not.toContain("lineTotal");
  });
  test("implausible dates are rejected and flagged; nothing is invented", () => {
    const r = parseReceipt([line("חנות"), line("תאריך 15-07-2617", undefined, 95, "תאריך 15-07-2617"), line("לחם", 8.5)]);
    expect(r.purchaseDate).toBeUndefined();
    expect(r.headerLowConfidence).toEqual(expect.arrayContaining(["purchaseDate", "total"]));
    expect(r.totalAgorot).toBeUndefined();
  });
});

describe("regression on captured Tesseract output (synthetic photo-like receipts)", () => {
  // Minimum share of exact line amounts measured today; b6 is a blurred receipt
  // in a font where Tesseract confuses 7/1 and 9/8. These guard against
  // regressions — they are not accuracy claims for real receipts.
  const floor: Record<string, number> = { r1: 0.85, b6: 0.7 };
  for (const id of ["r1", "b6"]) {
    test(`${id}: date, total and line amounts`, () => {
      const passes = fixture(`ocr-${id}.json`) as { heb: OcrPass; mix: OcrPass; num: OcrPass };
      const r = parseReceipt(mergePasses(passes));
      const t = truth[id];
      expect(r.purchaseDate).toBe(t.date);
      expect(r.totalAgorot).toBe(Math.round(t.total * 100));
      const got = r.lines.map((l) => l.lineTotalAgorot).sort((a, b) => a - b);
      const want = t.lines.map((l: { total: number }) => Math.round(l.total * 100)).sort((a: number, b: number) => a - b);
      const found = want.filter((w: number) => got.includes(w)).length;
      expect(found / want.length).toBeGreaterThanOrEqual(floor[id]);
      // Every wrong amount must be flagged: the lines cannot add up to the total.
      if (found < want.length) expect(r.lines.some((l) => l.lowConfidenceFields.includes("lineTotal"))).toBe(true);
    });
  }
});
