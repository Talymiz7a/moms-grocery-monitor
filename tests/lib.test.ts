import { describe, expect, test } from "vitest";
import { formatIsoDate, parseDayFirstDate } from "../convex/lib/dates";
import { formatIls, parseShekelInput } from "../convex/lib/money";
import { suggestMatches } from "../convex/lib/normalize";
import { reconcile } from "../convex/lib/reconcile";
import { convertOcr, type OcrReceipt } from "../convex/lib/ocrSchema";
import { generateDemoData, DEMO_START, DEMO_END } from "../convex/lib/demoData";

describe("dates (DD/MM/YYYY)", () => {
  test("parses day-first formats", () => {
    expect(parseDayFirstDate("04/06/2026")).toBe("2026-06-04");
    expect(parseDayFirstDate("4.6.26")).toBe("2026-06-04");
    expect(parseDayFirstDate("12-10-2026")).toBe("2026-10-12");
    expect(parseDayFirstDate("2026-10-12")).toBe("2026-10-12");
  });
  test("rejects impossible dates instead of guessing", () => {
    expect(parseDayFirstDate("31/02/2026")).toBeNull();
    expect(parseDayFirstDate("13/13/2026")).toBeNull();
    expect(parseDayFirstDate("")).toBeNull();
    expect(parseDayFirstDate("אתמול")).toBeNull();
  });
  test("formats ISO as DD/MM/YYYY", () => {
    expect(formatIsoDate("2026-06-04")).toBe("04/06/2026");
    expect(formatIsoDate(undefined)).toBe("");
  });
});

describe("money", () => {
  test("parses shekel input to agorot", () => {
    expect(parseShekelInput("12.90")).toBe(1290);
    expect(parseShekelInput("12,9")).toBe(1290);
    expect(parseShekelInput("₪ 7")).toBe(700);
    expect(parseShekelInput("-5.00")).toBe(-500);
    expect(parseShekelInput("abc")).toBeNull();
    expect(parseShekelInput("1.234")).toBeNull();
  });
  test("formats ILS", () => {
    expect(formatIls(1290)).toContain("12.90");
    expect(formatIls(1290)).toContain("₪");
    expect(formatIls(undefined)).toBe("—");
  });
});

describe("product name matching", () => {
  const products = [
    { id: "milk3", canonicalName: "חלב 3% 1 ליטר", aliases: ["חלב טרי 3% 1ל", "חלב 3 אחוז קרטון 1 ליטר"] },
    { id: "milk1", canonicalName: "חלב 1% 1 ליטר", aliases: ["חלב דל שומן 1% 1ל"] },
    { id: "cottage", canonicalName: "קוטג' 5% 250 גרם", aliases: ["קוטג 5% 250 גר"] },
    { id: "eggs", canonicalName: "ביצים L תבנית 12", aliases: ["ביצים L 12 יח"] },
  ];
  test("a previously confirmed wording is an exact match", () => {
    const [top] = suggestMatches("חלב טרי 3% 1ל", products);
    expect(top).toMatchObject({ id: "milk3", kind: "exact" });
  });
  test("variant spelling is suggested, not auto-confirmed", () => {
    const [top] = suggestMatches("קוטג׳ 5%", products);
    expect(top.id).toBe("cottage");
    expect(top.kind).not.toBe("exact");
  });
  test("different fat percentage is never a strong match", () => {
    const res = suggestMatches("חלב 1% 1 ליטר בקרטון", products);
    expect(res[0].id).toBe("milk1");
    const milk3 = res.find((r) => r.id === "milk3");
    if (milk3) {
      expect(milk3.qualifiersConflict).toBe(true);
      expect(milk3.kind).toBe("weak");
    }
  });
  test("OCR that lost the % sign still prefers the right variety", () => {
    const res = suggestMatches("חלב טרי 3 אחו 1 ל", products);
    expect(res[0].id).toBe("milk3");
    const milk1 = res.find((r) => r.id === "milk1");
    if (milk1) expect(milk1.qualifiersConflict).toBe(true);
  });
});

describe("reconciliation", () => {
  test("matches when lines minus discounts equal the printed total", () => {
    const r = reconcile(
      [
        { lineType: "item", quantity: 2, unitPriceAgorot: 590, lineTotalAgorot: 1180, discountAgorot: 200 },
        { lineType: "discount", quantity: 1, lineTotalAgorot: -500 },
        { lineType: "return", quantity: -1, unitPriceAgorot: 390, lineTotalAgorot: -390 },
        { lineType: "item", quantity: 1.25, unitPriceAgorot: 790, lineTotalAgorot: 988 },
      ],
      1078,
    );
    expect(r.computedTotalAgorot).toBe(1180 - 200 - 500 - 390 + 988);
    expect(r.status).toBe("match");
  });
  test("reports an unexplained difference without changing figures", () => {
    const r = reconcile([{ lineType: "item", quantity: 1, unitPriceAgorot: 1000, lineTotalAgorot: 1000 }], 1400);
    expect(r.status).toBe("mismatch");
    expect(r.differenceAgorot).toBe(400);
    expect(r.linesTotalAgorot).toBe(1000);
  });
  test("missing printed total is flagged as incomplete", () => {
    expect(reconcile([{ lineType: "item", quantity: 1, lineTotalAgorot: 100 }], undefined).status).toBe("no_total");
  });
  test("flags quantity × price arithmetic errors per line", () => {
    const r = reconcile([{ lineType: "item", quantity: 3, unitPriceAgorot: 690, lineTotalAgorot: 1380 }], 1380);
    expect(r.lineChecks).toEqual([{ index: 0, arithmeticMismatch: true, expectedAgorot: 2070 }]);
  });
});

describe("OCR conversion", () => {
  const base: OcrReceipt = {
    storeName: "סופר השכונה",
    purchaseDate: "04/06/2026",
    receiptNumber: "41-1",
    total: 20.7,
    items: [
      { description: "חלב 3% 1ל", quantity: 3, unit: "unit", unitPrice: 6.9, lineTotal: 20.7, discount: null, lineType: "item", confidence: "high", uncertainFields: [] },
      { description: "???", quantity: null, unit: null, unitPrice: null, lineTotal: null, discount: null, lineType: "item", confidence: "medium", uncertainFields: ["description"] },
    ],
    overallConfidence: "medium",
    uncertainHeaderFields: [],
    rawText: "...",
    notes: null,
  };
  test("converts amounts and day-first dates", () => {
    const c = convertOcr(base);
    expect(c.purchaseDate).toBe("2026-06-04");
    expect(c.totalAgorot).toBe(2070);
    expect(c.lines[0]).toMatchObject({ quantity: 3, unitPriceAgorot: 690, lineTotalAgorot: 2070, confidence: "high" });
  });
  test("unreadable values are flagged low-confidence, not invented", () => {
    const c = convertOcr(base);
    expect(c.lines[1].confidence).toBe("low");
    expect(c.lines[1].lowConfidenceFields).toEqual(expect.arrayContaining(["description", "quantity", "lineTotal"]));
  });
  test("an unparseable printed date is left empty and flagged", () => {
    const c = convertOcr({ ...base, purchaseDate: "31/02/2026" });
    expect(c.purchaseDate).toBeUndefined();
    expect(c.headerLowConfidence).toContain("purchaseDate");
  });
});

describe("demo data", () => {
  const { receipts, products } = generateDemoData();
  test("is deterministic", () => {
    expect(JSON.stringify(generateDemoData())).toBe(JSON.stringify(generateDemoData()));
    expect(products.length).toBeGreaterThan(15);
  });
  test("covers five months, June to October 2026", () => {
    const dates = receipts.map((r) => r.purchaseDate).filter((d): d is string => !!d).sort();
    expect(dates[0] >= DEMO_START).toBe(true);
    expect(dates[dates.length - 1] <= DEMO_END).toBe(true);
    expect(new Set(dates.map((d) => d.slice(0, 7)))).toEqual(new Set(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]));
  });
  test("contains the required scenarios", () => {
    expect(receipts.some((r) => r.lines.some((l) => l.productKey === "milk3" && l.quantity === 6))).toBe(true);
    expect(receipts.filter((r) => r.duplicateOfKey).length).toBe(2);
    expect(receipts.some((r) => !r.purchaseDate)).toBe(true);
    expect(receipts.some((r) => r.totalAgorot === undefined)).toBe(true);
    expect(receipts.some((r) => r.lines.some((l) => l.lineType === "return"))).toBe(true);
    expect(receipts.some((r) => r.lines.some((l) => l.lineType === "discount"))).toBe(true);
    expect(receipts.some((r) => r.ocrConfidence === "low")).toBe(true);
    expect(receipts.some((r) => r.lines.some((l) => l.productKey === "energy"))).toBe(true);
    const sameDay = new Map<string, number>();
    for (const r of receipts) if (r.purchaseDate && !r.duplicateOfKey) sameDay.set(r.purchaseDate, (sameDay.get(r.purchaseDate) ?? 0) + 1);
    expect([...sameDay.values()].some((n) => n > 1)).toBe(true);
  });
});
