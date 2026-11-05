import { describe, expect, test } from "vitest";
import { buildOccasions, convertQuantity, monthlyGrid, productHistory, standardPrice, type FactItem, type FactProduct, type FactReceipt } from "../convex/lib/analytics";

const products: FactProduct[] = [
  { id: "milk", name: "חלב 3% 1 ליטר", unit: "unit", packageSize: 1, packageUnit: "l" },
  { id: "tomato", name: "עגבניות", unit: "kg" },
  { id: "cheese", name: "גבינה 250 גרם", unit: "unit", packageSize: 250, packageUnit: "g" },
];
const receipts: FactReceipt[] = [
  { id: "r1", date: "2026-01-04", itemCount: 3 },
  { id: "r2", date: "2026-01-11", itemCount: 1 },
  { id: "r3", date: "2026-02-01", itemCount: 2 },
  { id: "r4", date: "2026-02-01", itemCount: 1 },
];
const line = (receiptId: string, productId: string, quantity: number, extra: Partial<FactItem> = {}): FactItem => ({
  receiptId, productId, lineType: "item", quantity, unit: "unit", unitPriceAgorot: 690, lineTotalAgorot: Math.round(690 * quantity), ...extra,
});

describe("purchase occasions", () => {
  const items: FactItem[] = [
    line("r1", "milk", 6),
    line("r1", "milk", 1),                       // second line, same receipt
    line("r1", "tomato", 500, { unit: "g", unitPriceAgorot: undefined, lineTotalAgorot: 395 }),
    line("r2", "milk", 1),
    line("r3", "milk", 2),
    line("r4", "milk", 1),                       // same day, different receipt
    line("r3", "tomato", 1, { unit: "pack", lineTotalAgorot: 500 }), // incompatible unit
    line("r3", "cheese", -1, { lineType: "return", lineTotalAgorot: -590 }), // return only
  ];
  const occ = buildOccasions(receipts, items, products);

  test("several units or lines on one receipt are ONE occasion, quantities summed", () => {
    const r1 = occ.filter((o) => o.receiptId === "r1" && o.productId === "milk");
    expect(r1).toHaveLength(1);
    expect(r1[0].quantity).toBe(7);
    expect(r1[0].lineCount).toBe(2);
  });
  test("frequency counts distinct receipts, including two on the same day", () => {
    expect(occ.filter((o) => o.productId === "milk")).toHaveLength(4);
  });
  test("grams are converted to the product's kg; incompatible units are not added", () => {
    const t1 = occ.find((o) => o.receiptId === "r1" && o.productId === "tomato")!;
    expect(t1.quantity).toBe(0.5);
    expect(t1.standardPrice).toEqual({ agorot: 790, per: "kg" });
    expect(occ.find((o) => o.receiptId === "r3" && o.productId === "tomato")).toBeUndefined();
  });
  test("a receipt with only a return is not a purchase occasion", () => {
    expect(occ.some((o) => o.productId === "cheese")).toBe(false);
  });
  test("unconvertible units return null", () => {
    expect(convertQuantity(2, "pack", "kg")).toBeNull();
    expect(convertQuantity(250, "ml", "l")).toBe(0.25);
  });
  test("package size gives a comparable price per litre / kg", () => {
    expect(standardPrice(products[2], 590)).toEqual({ agorot: 2360, per: "kg" });
    expect(standardPrice(products[0], 690)).toEqual({ agorot: 690, per: "l" });
  });

  test("monthly grid counts occasions, not quantity", () => {
    const grid = monthlyGrid(occ, products, 2026);
    const milk = grid.find((g) => g.productId === "milk")!;
    expect(milk.occasions.slice(0, 3)).toEqual([2, 2, 0]);
    expect(milk.quantity.slice(0, 2)).toEqual([8, 3]);
    expect(milk.totalOccasions).toBe(4);
    expect(grid[0].productId).toBe("milk");
  });

  test("history: days between purchases and comparison with prior months", () => {
    const h = productHistory(occ, "milk", "2026-01", "2026-03");
    expect(h.occasions.map((o) => o.daysSincePrevious)).toEqual([null, 7, 21, 0]);
    expect(h.summary.minIntervalDays).toBe(0);
    expect(h.monthly.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(h.monthly[0].priorAvgOccasions).toBeNull();
    expect(h.monthly[2]).toMatchObject({ occasions: 0, priorAvgOccasions: 2, priorMonths: 2 });
  });
});
