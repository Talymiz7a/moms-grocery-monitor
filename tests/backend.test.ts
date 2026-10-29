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
    const products = await t.query(api.products.list, { dataset: "real" });
    expect(products).toHaveLength(1);
    const productId = products[0]._id;
    await t.mutation(api.receipts.saveReview, {
      editorCode: CODE,
      receiptId,
      header: { storeName: "חנות", purchaseDate: "2026-06-04", totalAgorot: 690 * 7 },
      lines: [milkLine(6, { kind: "existing", productId }), milkLine(1, { kind: "existing", productId })],
      finalize: true,
    });
    const s = await t.query(api.receipts.dashboardSummary, { dataset: "real" });
    expect(s.receiptCount).toBe(1);
    expect(s.distinctProducts).toBe(1);
    expect(s.purchaseOccasions).toBe(1);
    expect(s.totalSpendAgorot).toBe(690 * 7);
    const detail = await t.query(api.receipts.get, { receiptId });
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
    const detail = await t.query(api.receipts.get, { receiptId });
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
    expect((await t.query(api.receipts.dashboardSummary, { dataset: "real" })).receiptCount).toBe(2);
  });

  test("deleting a receipt removes its lines and is recorded", async () => {
    const t = convexTest(schema, modules);
    const { receiptId } = await t.mutation(api.files.createManualDraft, { editorCode: CODE, dataset: "real" });
    await t.mutation(api.receipts.saveReview, {
      editorCode: CODE, receiptId, header: { purchaseDate: "2026-06-04" }, lines: [milkLine(1, { kind: "none" })], finalize: false,
    });
    await t.mutation(api.receipts.remove, { editorCode: CODE, receiptId });
    expect(await t.query(api.receipts.get, { receiptId })).toBeNull();
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

    const real = await t.query(api.receipts.dashboardSummary, { dataset: "real" });
    expect(real.receiptCount).toBe(0);
    expect(real.draftCount).toBe(1);
    expect(await t.query(api.receipts.get, { receiptId: realId })).not.toBeNull();

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
