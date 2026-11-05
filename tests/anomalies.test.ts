import { describe, expect, test } from "vitest";
import { buildOccasions, type FactItem, type FactProduct, type FactReceipt } from "../convex/lib/analytics";
import { detectAnomalies, type ProductInfo, type ReceiptInfo } from "../convex/lib/anomalies";

const P: FactProduct[] = [{ id: "milk", name: "חלב", unit: "unit" }];
const PI: ProductInfo[] = [{ id: "milk", name: "חלב", unit: "unit", expectedUse: "expected" }];

function scenario(dates: string[], qty: (i: number) => number = () => 1) {
  const receipts: FactReceipt[] = dates.map((d, i) => ({ id: `r${i}`, date: d, itemCount: 1, storeName: "חנות", totalAgorot: 690 }));
  const items: FactItem[] = dates.map((_, i) => ({ receiptId: `r${i}`, productId: "milk", lineType: "item", quantity: qty(i), unit: "unit", lineTotalAgorot: 690 * qty(i) }));
  const occasions = buildOccasions(receipts, items, P);
  const rinfo: ReceiptInfo[] = receipts.map((r) => ({ ...r, verified: true }));
  return { occasions, receipts: rinfo };
}
const weekly = (n: number, start = "2026-01-04") => Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * 7 * 86400000).toISOString().slice(0, 10));

describe("anomaly detection", () => {
  test("a regular weekly pattern raises nothing", () => {
    const s = scenario(weekly(20));
    expect(detectAnomalies({ ...s, products: PI, expectations: [], sensitivity: "medium" })).toEqual([]);
  });

  test("a quantity spike is flagged statistically, with its baseline", () => {
    const s = scenario(weekly(12), (i) => (i === 11 ? 6 : 1));
    const [a] = detectAnomalies({ ...s, products: PI, expectations: [], sensitivity: "medium" });
    expect(a).toMatchObject({ type: "large_quantity", basis: "statistical", limitedEvidence: false, receiptIds: ["r11"] });
    expect(a.evidence.baseline).toMatchObject({ medianQuantity: 1, priorOccasions: 11 });
  });

  test("without enough history there is no statistical alert — only a configured rule fires, marked limited evidence", () => {
    const s = scenario(weekly(3), (i) => (i === 2 ? 6 : 1));
    expect(detectAnomalies({ ...s, products: PI, expectations: [], sensitivity: "medium" })).toEqual([]);
    const withRule = detectAnomalies({ ...s, products: PI, expectations: [{ productId: "milk", quantityMax: 4 }], sensitivity: "medium" });
    expect(withRule).toHaveLength(1);
    expect(withRule[0]).toMatchObject({ type: "large_quantity", basis: "rule", limitedEvidence: true });
  });

  test("two receipts on the same day are a 0-day interval", () => {
    const dates = [...weekly(8), weekly(8)[7]];
    const s = scenario(dates);
    const a = detectAnomalies({ ...s, products: PI, expectations: [], sensitivity: "medium" }).find((x) => x.type === "close_interval");
    expect(a?.evidence).toMatchObject({ days: 0 });
    expect(a?.reason).toContain("באותו יום");
  });

  test("monthly maximum rule and sensitivity", () => {
    const dates = ["2026-03-01", "2026-03-03", "2026-03-05", "2026-03-08"];
    const s = scenario(dates);
    const rule = detectAnomalies({ ...s, products: PI, expectations: [{ productId: "milk", maxPerMonth: 2 }], sensitivity: "low" });
    expect(rule.find((a) => a.type === "excessive_frequency")).toMatchObject({ basis: "rule", severity: "high" });
  });

  test("not-expected products and duplicates are rule alerts with explanations, never accusations", () => {
    const s = scenario(["2026-05-01"]);
    const receipts = [...s.receipts, { id: "dup", date: "2026-05-01", itemCount: 1, verified: false, duplicateOfId: "r0", duplicateReason: "אותו קובץ" }];
    const res = detectAnomalies({ ...s, receipts, products: [{ ...PI[0], expectedUse: "not_expected" }], expectations: [], sensitivity: "medium" });
    expect(res.map((a) => a.type).sort()).toEqual(["duplicate_receipt", "not_expected"]);
    for (const a of res) expect(a.reason).not.toMatch(/גנב|מעילה|חשוד/);
  });
});
