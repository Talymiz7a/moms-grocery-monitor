/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const CODE = "test-editor-code-123";

beforeEach(() => {
  process.env.EDITOR_CODE = CODE;
  process.env.FILE_LINK_SECRET = "test-file-link-secret-0123456789";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  delete process.env.OCR_ENABLED;
  delete process.env.ANTHROPIC_API_KEY;
});

type Line = {
  originalDescription: string;
  lineType: "item" | "discount" | "return" | "deposit";
  quantity: number;
  unit: "unit" | "kg" | "g" | "l" | "ml" | "pack";
  unitPriceAgorot?: number;
  lineTotalAgorot: number;
  discountAgorot?: number;
  confidence: "high" | "medium" | "low";
  lowConfidenceFields: string[];
  corrected: boolean;
  product:
    | { kind: "existing"; productId: any }
    | { kind: "new"; canonicalName: string; unit: "unit" }
    | { kind: "none" };
};

const milkLine = (quantity: number, product: Line["product"]): Line => ({
  originalDescription: "חלב 3% 1ל",
  lineType: "item",
  quantity,
  unit: "unit",
  unitPriceAgorot: 690,
  lineTotalAgorot: 690 * quantity,
  confidence: "high",
  lowConfidenceFields: [],
  corrected: false,
  product,
});

describe("write protection", () => {
  test("changes are refused without the editor code", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.files.generateUploadUrl, { editorCode: "" })).rejects.toThrow();
    await expect(t.mutation(api.files.createManualDraft, { editorCode: "wrong-code", dataset: "demo" })).rejects.toThrow();
    await expect(t.action(api.demo.reset, { editorCode: "nope" })).rejects.toThrow();
  });
  test("all changes are refused when no editor code is configured", async () => {
    delete process.env.EDITOR_CODE;
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "demo" })).rejects.toThrow();
    expect((await t.query(api.app.status, {})).editingConfigured).toBe(false);
  });
  test("editor code verification", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(api.app.verifyEditorCode, { code: CODE })).toEqual({ valid: true });
    expect(await t.mutation(api.app.verifyEditorCode, { code: "x" })).toEqual({ valid: false });
  });
});

describe("receipt review and counting", () => {
  test("several lines or units of one product on one receipt are ONE purchase occasion", async () => {
    const t = convexTest(schema, modules);
    const { receiptId } = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    await t.mutation(api.receipts.saveReview, {
      editorCode: CODE,
      receiptId,
      header: { storeName: "חנות", purchaseDate: "2026-06-04", totalAgorot: 690 * 7 },
      lines: [milkLine(6, { kind: "new", canonicalName: "חלב 3% 1 ליטר", unit: "unit" })],
      finalize: false,
    });
    const products = await t.query(api.products.list, { dataset: "real", editorCode: CODE });
    expect(products).toHaveLength(1);
    const productId = products[0]._id;
    await t.mutation(api.receipts.saveReview, {
      editorCode: CODE,
      receiptId,
      header: { storeName: "חנות", purchaseDate: "2026-06-04", totalAgorot: 690 * 7 },
      lines: [milkLine(6, { kind: "existing", productId }), milkLine(1, { kind: "existing", productId })],
      finalize: true,
    });
    const s = await t.query(api.receipts.dashboardSummary, { dataset: "real", editorCode: CODE });
    expect(s.receiptCount).toBe(1);
    expect(s.distinctProducts).toBe(1);
    expect(s.purchaseOccasions).toBe(1);
    expect(s.totalSpendAgorot).toBe(690 * 7);
    const detail = await t.query(api.receipts.get, { editorCode: CODE, receiptId });
    expect(detail?.receipt.reconciliation?.status).toBe("match");
    expect(detail?.receipt.verificationStatus).toBe("verified");
    expect(detail?.items.map((i) => i.matchStatus)).toEqual(["confirmed", "confirmed"]);
    expect(detail?.audit.length).toBeGreaterThanOrEqual(2);
  });

  test("an unexplained total difference is kept and flagged, not corrected", async () => {
    const t = convexTest(schema, modules);
    const { receiptId } = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    const res = await t.mutation(api.receipts.saveReview, {
      editorCode: CODE,
      receiptId,
      header: { storeName: "חנות", purchaseDate: "2026-06-04", totalAgorot: 1090 },
      lines: [milkLine(1, { kind: "none" })],
      finalize: true,
    });
    expect(res.reconciliation.status).toBe("mismatch");
    expect(res.reconciliation.differenceAgorot).toBe(400);
    const detail = await t.query(api.receipts.get, { editorCode: CODE, receiptId });
    expect(detail?.receipt.totalAgorot).toBe(1090);
  });

  test("invalid input is rejected", async () => {
    const t = convexTest(schema, modules);
    const { receiptId } = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    const base = { editorCode: CODE, receiptId, finalize: false };
    await expect(t.mutation(api.receipts.saveReview, { ...base, header: { purchaseDate: "2026-02-31" }, lines: [] })).rejects.toThrow();
    await expect(t.mutation(api.receipts.saveReview, { ...base, header: {}, lines: [milkLine(0, { kind: "none" })] })).rejects.toThrow();
    await expect(
      t.mutation(api.receipts.saveReview, { ...base, header: {}, lines: [{ ...milkLine(1, { kind: "none" }), lineTotalAgorot: 12.5 }] }),
    ).rejects.toThrow();
  });

  test("a likely duplicate cannot be approved until a person overrides it", async () => {
    const t = convexTest(schema, modules);
    const header = { storeName: "סופר השכונה", purchaseDate: "2026-07-01", receiptNumber: "41-100", totalAgorot: 690 };
    const lines = [milkLine(1, { kind: "none" })];
    const a = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    await t.mutation(api.receipts.saveReview, { editorCode: CODE, receiptId: a.receiptId, header, lines, finalize: true });
    const b = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    await expect(
      t.mutation(api.receipts.saveReview, { editorCode: CODE, receiptId: b.receiptId, header, lines, finalize: true }),
    ).rejects.toThrow(/כפול/);
    // Saved as draft it is flagged.
    const draft = await t.mutation(api.receipts.saveReview, { editorCode: CODE, receiptId: b.receiptId, header, lines, finalize: false });
    expect(draft.duplicate?.id).toBe(a.receiptId);
    await t.mutation(api.receipts.setDuplicateOverride, { editorCode: CODE, receiptId: b.receiptId, notDuplicate: true });
    await t.mutation(api.receipts.saveReview, { editorCode: CODE, receiptId: b.receiptId, header, lines, finalize: true });
    expect((await t.query(api.receipts.dashboardSummary, { dataset: "real", editorCode: CODE })).receiptCount).toBe(2);
  });

  test("deleting a receipt removes its lines and is recorded", async () => {
    const t = convexTest(schema, modules);
    const { receiptId } = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    await t.mutation(api.receipts.saveReview, {
      editorCode: CODE, receiptId, header: { purchaseDate: "2026-06-04" }, lines: [milkLine(1, { kind: "none" })], finalize: false,
    });
    await t.mutation(api.receipts.remove, { editorCode: CODE, receiptId });
    expect(await t.query(api.receipts.get, { editorCode: CODE, receiptId })).toBeNull();
    const items = await t.run((ctx) => ctx.db.query("receiptItems").collect());
    expect(items).toHaveLength(0);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.some((a) => a.action === "receipt.delete")).toBe(true);
  });
});

describe("OCR is off unless explicitly enabled", () => {
  test("extract refuses to call the paid API", async () => {
    const t = convexTest(schema, modules);
    const { receiptId } = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    await expect(t.action(api.ocr.extract, { editorCode: CODE, receiptId })).rejects.toThrow(/כבויה/);
    expect((await t.query(api.app.status, {})).ocrEnabled).toBe(false);
  });
  test("OCR_ENABLED without an API key stays off", async () => {
    process.env.OCR_ENABLED = "true";
    const t = convexTest(schema, modules);
    expect((await t.query(api.app.status, {})).ocrEnabled).toBe(false);
  });
});

describe("demo data", () => {
  test("seeds five months, flags scenarios, and never touches real data", async () => {
    const t = convexTest(schema, modules);
    // One real receipt that must survive a demo reset untouched.
    const { receiptId: realId } = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    await t.action(internal.demo.seed, {});
    await t.action(api.demo.reset, { editorCode: CODE });

    const demo = await t.query(api.receipts.dashboardSummary, { dataset: "demo" });
    expect(demo.receiptCount).toBeGreaterThan(45);
    expect(demo.firstDate! >= "2026-06-01").toBe(true);
    expect(demo.lastDate! <= "2026-10-28").toBe(true);
    expect(demo.draftCount).toBe(4);
    expect(demo.duplicateCount).toBe(2);
    expect(demo.mismatchCount).toBe(1);
    expect(demo.missingTotalCount).toBe(1);
    expect(demo.purchaseOccasions).toBeGreaterThan(demo.receiptCount);

    const real = await t.query(api.receipts.dashboardSummary, { dataset: "real", editorCode: CODE });
    expect(real.receiptCount).toBe(0);
    expect(real.draftCount).toBe(1);
    expect(await t.query(api.receipts.get, { editorCode: CODE, receiptId: realId })).not.toBeNull();

    // The exact re-upload is detected by file fingerprint.
    const all = await t.query(api.receipts.list, { dataset: "demo" });
    const dup = (await t.run((ctx) => ctx.db.query("receipts").collect())).find((r) => r.duplicateReason?.includes("קובץ"));
    expect(dup?.duplicateOfId).toBeDefined();
    const original = await t.run((ctx) => ctx.db.get(dup!.duplicateOfId!));
    expect(original?.fileSha256).toBe(dup?.fileSha256);

    // Receipts without a date are listed (first), and excluded from date ranges.
    expect(all[0].purchaseDate).toBeUndefined();
    const june = await t.query(api.receipts.list, { dataset: "demo", from: "2026-06-01", to: "2026-06-30" });
    expect(june.length).toBeGreaterThan(5);
    expect(june.every((r) => r.purchaseDate! >= "2026-06-01" && r.purchaseDate! <= "2026-06-30")).toBe(true);
  });
});

describe("receipt files are served only through signed, expiring links", () => {
  test("valid link works; tampered or real-without-code links do not", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const [first] = await t.query(api.receipts.list, { dataset: "demo", filter: "verified" });
    const link = await t.mutation(api.files.getFileLink, { receiptId: first._id });
    expect(link).not.toBeNull();
    const u = new URL(link!.url);
    const ok = await t.fetch(`${u.pathname}${u.search}`, { method: "GET" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(ok.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(await ok.text()).toContain("<svg");

    u.searchParams.set("s", "forged");
    expect((await t.fetch(`${u.pathname}${u.search}`, { method: "GET" })).status).toBe(403);
    u.searchParams.set("e", String(Date.now() - 1000));
    expect((await t.fetch(`${u.pathname}${u.search}`, { method: "GET" })).status).toBe(403);

    // A real receipt's file requires the editor code.
    const realId = await t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["x"], { type: "image/png" }));
      return ctx.db.insert("receipts", {
        dataset: "real", purchaseDateSource: "missing", fileId, fileType: "image/png", ocrStatus: "not_run",
        verificationStatus: "draft", uploadedAt: 0, updatedAt: 0, createdBy: "test",
      });
    });
    await expect(t.mutation(api.files.getFileLink, { receiptId: realId })).rejects.toThrow();
    expect(await t.mutation(api.files.getFileLink, { receiptId: realId, editorCode: CODE })).not.toBeNull();
  });
});

describe("alerts workflow (Stage 3)", () => {
  test("demo data produces the expected alerts", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const { alerts } = await t.query(api.alerts.list, { dataset: "demo", status: "all" });
    const has = (type: string, text: string) => alerts.some((a) => a.type === type && a.reason.includes(text));
    expect(has("large_quantity", "חלב 3%")).toBe(true);
    expect(has("excessive_frequency", "קפה")).toBe(true);
    expect(has("close_interval", "קפה")).toBe(true);
    expect(alerts.filter((a) => a.type === "duplicate_receipt")).toHaveLength(2);
    expect(has("new_product", "חומוס")).toBe(true);
    expect(has("not_expected", "משקה אנרגיה")).toBe(true);
    expect(has("high_total", "236.12")).toBe(true);
    expect(alerts.find((a) => a.type === "not_expected" && a.reason.includes("לכלבים"))?.status).toBe("explained");
    const counts = await t.query(api.alerts.counts, { dataset: "demo" });
    expect(counts.explained).toBe(1);
    expect(counts.investigate).toBe(1);
    // Every alert links to its receipts and explains its basis.
    for (const a of alerts) {
      expect(a.receipts.length).toBeGreaterThan(0);
      expect(typeof a.evidence.explanation).toBe("string");
    }
  });

  test("reviewing: explanation required, read-only refused, history kept", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const { alerts } = await t.query(api.alerts.list, { dataset: "demo" });
    const a = alerts.find((x) => x.type === "large_quantity")!;
    await expect(t.mutation(api.alerts.review, { editorCode: "nope", alertId: a._id, status: "explained", notes: "x" })).rejects.toThrow();
    await expect(t.mutation(api.alerts.review, { editorCode: CODE, alertId: a._id, status: "explained" })).rejects.toThrow(/הסבר/);
    await t.mutation(api.alerts.review, { editorCode: CODE, alertId: a._id, status: "explained", notes: "אירוח משפחתי" });
    const after = (await t.query(api.alerts.list, { dataset: "demo", status: "explained" })).alerts.find((x) => x._id === a._id)!;
    expect(after.resolvedAt).toBeDefined();
    expect(after.reviewHistory.at(-1)).toMatchObject({ status: "explained", notes: "אירוח משפחתי" });
  });

  test("an explained alert stays closed on recompute, and reopens only when its evidence changes", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const { alerts } = await t.query(api.alerts.list, { dataset: "demo" });
    const a = alerts.find((x) => x.type === "large_quantity" && x.reason.includes("חלב 3%"))!;
    await t.mutation(api.alerts.review, { editorCode: CODE, alertId: a._id, status: "explained", notes: "אירוח" });
    await t.mutation(internal.alerts.recompute, { dataset: "demo" });
    let doc = await t.run((ctx) => ctx.db.get(a._id));
    expect(doc?.status).toBe("explained");
    // New evidence: the same purchase is corrected to 8 litres.
    await t.run(async (ctx) => {
      const items = await ctx.db.query("receiptItems").withIndex("by_receipt", (q) => q.eq("receiptId", a.receipts[0]._id)).collect();
      const milk = items.find((i) => i.quantity === 6)!;
      await ctx.db.patch(milk._id, { quantity: 8, lineTotalAgorot: 5520 });
    });
    await t.mutation(internal.alerts.recompute, { dataset: "demo" });
    doc = await t.run((ctx) => ctx.db.get(a._id));
    expect(doc?.status).toBe("pending");
    expect(doc?.reopenedAt).toBeDefined();
  });

  test("an override removes a never-reviewed duplicate alert", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const dups = (await t.query(api.alerts.list, { dataset: "demo" })).alerts.filter((a) => a.type === "duplicate_receipt");
    await t.mutation(api.receipts.setDuplicateOverride, { editorCode: CODE, receiptId: dups[0].receipts[0]._id, notDuplicate: true });
    await t.mutation(internal.alerts.recompute, { dataset: "demo" });
    const left = (await t.query(api.alerts.list, { dataset: "demo" })).alerts.filter((a) => a.type === "duplicate_receipt");
    expect(left).toHaveLength(1);
  });

  test("expectations validate input; merge and split move lines and keep history", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const products = await t.query(api.products.listWithExpectations, { dataset: "demo" });
    const milk3 = products.find((p) => p.canonicalName === "חלב 3% 1 ליטר")!;
    const milk1 = products.find((p) => p.canonicalName === "חלב 1% 1 ליטר")!;
    expect(milk3.expectation?.quantityMax).toBe(4);
    await expect(
      t.mutation(api.products.setExpectation, { editorCode: CODE, productId: milk3._id, expectation: { quantityMin: 5, quantityMax: 2 } }),
    ).rejects.toThrow();
    expect(await t.query(api.products.mergeCheck, { sourceId: milk1._id, targetId: milk3._id })).toMatchObject({ conflict: true });

    const before = await t.query(api.analytics.productDetail, { dataset: "demo", productId: milk3._id });
    const milk1Detail = await t.query(api.analytics.productDetail, { dataset: "demo", productId: milk1._id });
    const res = await t.mutation(api.products.merge, { editorCode: CODE, sourceId: milk1._id, targetId: milk3._id });
    expect(res.moved).toBeGreaterThan(0);
    const merged = await t.query(api.analytics.productDetail, { dataset: "demo", productId: milk3._id });
    if (!merged || "mergedIntoId" in merged || !before || "mergedIntoId" in before || !milk1Detail || "mergedIntoId" in milk1Detail) throw new Error("unexpected");
    // Same-receipt purchases of both count once, so occasions grow by at most milk1's count.
    expect(merged.summary.totalOccasions).toBeGreaterThan(before.summary.totalOccasions);
    expect(merged.summary.totalOccasions).toBeLessThanOrEqual(before.summary.totalOccasions + milk1Detail.summary.totalOccasions);
    expect(await t.query(api.analytics.productDetail, { dataset: "demo", productId: milk1._id })).toEqual({ mergedIntoId: milk3._id });

    // Split the 1% wording back out.
    const split = await t.mutation(api.products.splitAlias, { editorCode: CODE, productId: milk3._id, alias: "חלב 1% 1 ליטר", newName: "חלב 1% (פוצל)" });
    expect(split.moved).toBeGreaterThan(0);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.some((a) => a.action === "product.merge")).toBe(true);
    expect(audit.some((a) => a.action === "product.split")).toBe(true);
  });
});

describe("end-to-end data checks (Stage 5)", () => {
  test("manual correction of a draft recalculates analytics and alerts", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const before = await t.query(api.analytics.periodSummary, { dataset: "demo" });
    const drafts = await t.query(api.receipts.list, { dataset: "demo", filter: "draft" });
    const lowConf = drafts.find((r) => r.purchaseDate === "2026-10-25")!;
    const detail = (await t.query(api.receipts.get, { editorCode: CODE, receiptId: lowConf._id }))!;
    const products = await t.query(api.products.list, { dataset: "demo" });
    const byName = (n: string) => products.find((p) => p.canonicalName === n)!._id;
    const fix: Record<string, string> = { "חלב טרי 3 אחו 1 ל": "חלב 3% 1 ליטר", "ביצים L 12": "ביצים L תבנית 12", "קוטג׳ 5%": "קוטג' 5% 250 גרם" };
    const lines = detail.items.map((i) => ({
      originalDescription: i.originalDescription,
      lineType: i.lineType,
      quantity: i.quantity,
      unit: i.unit,
      unitPriceAgorot: i.unitPriceAgorot,
      lineTotalAgorot: i.lineTotalAgorot,
      discountAgorot: i.discountAgorot,
      confidence: i.confidence,
      lowConfidenceFields: i.lowConfidenceFields,
      corrected: !!fix[i.originalDescription],
      product: i.productId
        ? { kind: "existing" as const, productId: i.productId }
        : fix[i.originalDescription]
          ? { kind: "existing" as const, productId: byName(fix[i.originalDescription]) }
          : { kind: "none" as const },
    }));
    await t.mutation(api.receipts.saveReview, {
      editorCode: CODE,
      receiptId: lowConf._id,
      header: { storeName: detail.receipt.storeName, purchaseDate: "2026-10-25", receiptNumber: detail.receipt.receiptNumber, totalAgorot: detail.receipt.totalAgorot },
      lines,
      finalize: true,
    });
    const after = await t.query(api.analytics.periodSummary, { dataset: "demo" });
    expect(after.receiptCount).toBe(before.receiptCount + 1);
    // Milk appears on two lines of this receipt but counts as ONE occasion.
    const distinctProductsOnReceipt = new Set(lines.filter((l) => l.product.kind === "existing").map((l) => (l.product as { productId: string }).productId)).size;
    expect(after.purchaseOccasions).toBe(before.purchaseOccasions + distinctProductsOnReceipt);
    expect(after.dataTo).toBe("2026-10-25");
    // Wordings learned as confirmed aliases.
    const milk = (await t.query(api.products.list, { dataset: "demo" })).find((p) => p.canonicalName === "חלב 3% 1 ליטר")!;
    expect(milk.aliases).toContain("חלב טרי 3 אחו 1 ל");
    // Recompute uses the corrected data.
    const res = await t.mutation(internal.alerts.recompute, { dataset: "demo" });
    expect(res.candidates).toBeGreaterThan(0);
  });

  test("a receipt without a date is listed but excluded from analytics until a date is entered", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const s = await t.query(api.analytics.periodSummary, { dataset: "demo" });
    const undated = (await t.query(api.receipts.list, { dataset: "demo" })).filter((r) => !r.purchaseDate);
    expect(undated).toHaveLength(1);
    expect(s.receiptCount).toBe(54);
  });

  test("discounts, returns and negative lines reconcile to the printed total", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const july5 = (await t.query(api.receipts.list, { dataset: "demo", from: "2026-07-05", to: "2026-07-05" }))[0];
    const d = (await t.query(api.receipts.get, { editorCode: CODE, receiptId: july5._id }))!;
    expect(d.items.some((i) => i.lineType === "return" && i.lineTotalAgorot < 0)).toBe(true);
    expect(d.items.some((i) => i.lineType === "discount" && i.lineTotalAgorot < 0)).toBe(true);
    expect(d.receipt.reconciliation?.status).toBe("match");
  });

  test("period filters and reports agree, and demo never leaks into real", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.demo.seed, {});
    const sep = await t.query(api.analytics.periodSummary, { dataset: "demo", from: "2026-09-01", to: "2026-09-30" });
    const report = await t.query(api.analytics.reportData, { dataset: "demo", from: "2026-06-01", to: "2026-10-31" });
    const sepRow = report.monthlySummary.find((m) => m.month === "2026-09")!;
    expect(sepRow.occasions).toBe(sep.purchaseOccasions);
    expect(sepRow.receipts).toBe(sep.receiptCount);
    const total = report.monthlySummary.reduce((s, m) => s + m.occasions, 0);
    expect(total).toBe((await t.query(api.analytics.periodSummary, { dataset: "demo" })).purchaseOccasions);
    expect(report.previous).toEqual({ from: "2025-12-30", to: "2026-05-31" }); // same length (153 days), immediately before
    expect(report.reviewedAlerts.length).toBe(2);
    const real = await t.query(api.analytics.reportData, { dataset: "real", editorCode: CODE, from: "2026-06-01", to: "2026-10-31" });
    expect(real.comparison).toHaveLength(0);
    expect(real.unresolvedAlerts).toHaveLength(0);
    expect((await t.query(api.analytics.periodSummary, { dataset: "real", editorCode: CODE })).receiptCount).toBe(0);
  });
});

describe("real data is protected", () => {
  test("reading real data requires the editor code; demo stays public", async () => {
    const t = convexTest(schema, modules);
    const { receiptId } = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    await expect(t.query(api.receipts.list, { dataset: "real" })).rejects.toThrow();
    await expect(t.query(api.receipts.get, { receiptId })).rejects.toThrow();
    await expect(t.query(api.analytics.periodSummary, { dataset: "real", editorCode: "wrong" })).rejects.toThrow();
    await expect(t.query(api.alerts.list, { dataset: "real" })).rejects.toThrow();
    await expect(t.query(api.products.list, { dataset: "real" })).rejects.toThrow();
    expect(await t.query(api.receipts.list, { dataset: "real", editorCode: CODE })).toHaveLength(1);
    expect(await t.query(api.receipts.list, { dataset: "demo" })).toEqual([]);
  });
});
