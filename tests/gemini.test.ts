/// <reference types="vite/client" />
// Gemini receipt reading. Google's API is never called: fetch is stubbed with
// recorded-shape responses.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { convertGeminiReceipt, parseGeminiResponse, toBase64 } from "../convex/lib/gemini";

const modules = import.meta.glob("../convex/**/*.ts");
const CODE = "test-editor-code-123";

const RECEIPT = {
  rawText: "שופרסל דיל\n30/10/2026\nחלב 3% 1 ל 2 X 6.90 13.80\nלחם אחיד 7.50\nהנחת מועדון -1.00\nסה\"כ לתשלום 20.30",
  storeName: "שופרסל דיל",
  purchaseDate: "30/10/2026",
  receiptNumber: "4512",
  items: [
    { description: "חלב 3% 1 ל", quantity: 2, unit: "unit", unitPrice: 6.9, lineTotal: 13.8, discount: null, lineType: "item", confidence: "high", uncertainFields: [] },
    { description: "לחם אחיד", quantity: 1, unit: "unit", unitPrice: 7.5, lineTotal: 7.5, discount: null, lineType: "item", confidence: "high", uncertainFields: [] },
    { description: "הנחת מועדון", quantity: 1, unit: null, unitPrice: null, lineTotal: -1, discount: null, lineType: "discount", confidence: "high", uncertainFields: [] },
  ],
  total: 20.3,
  uncertainHeaderFields: [],
  overallConfidence: "high",
  notes: null,
};

const ok = (receipt: unknown, modelVersion = "gemini-2.5-flash") =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(receipt) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 600 },
      modelVersion,
    }),
    { status: 200 },
  );

async function newReceipt(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const fileId = await ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: "image/jpeg" }));
    return ctx.db.insert("receipts", {
      dataset: "real", purchaseDateSource: "missing", fileId, fileType: "image/jpeg", ocrStatus: "not_run",
      verificationStatus: "draft", uploadedAt: 0, updatedAt: 0, createdBy: "test",
    });
  });
}

beforeEach(() => {
  process.env.EDITOR_CODE = CODE;
  process.env.FILE_LINK_SECRET = "test-file-link-secret-0123456789";
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_OCR_ENABLED;
  delete process.env.GEMINI_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

describe("Gemini response handling", () => {
  test("parses the JSON answer and ignores thought parts", () => {
    const parsed = parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: JSON.stringify(RECEIPT) }] }, finishReason: "STOP" }],
    });
    expect(parsed.items).toHaveLength(3);
    expect(parsed.total).toBe(20.3);
  });

  test("tolerates numeric strings and missing optional fields", () => {
    const parsed = parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ ...RECEIPT, total: "20.30", items: [{ description: "לחם", quantity: "1", lineTotal: "7.50", lineType: "item", confidence: "high" }] }) }] } }],
    });
    expect(parsed.total).toBe(20.3);
    expect(parsed.items[0]).toMatchObject({ quantity: 1, lineTotal: 7.5, unitPrice: null, uncertainFields: [] });
  });

  test("rejects blocked or truncated answers", () => {
    expect(() => parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } })).toThrow();
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] })).toThrow();
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "not json" }] } }] })).toThrow();
  });

  test("flags arithmetic mismatches, total mismatches and future dates without changing values", () => {
    const wrong = {
      ...RECEIPT,
      purchaseDate: "30/10/2027",
      total: 25,
      items: [{ ...RECEIPT.items[0], lineTotal: 12.8 }, RECEIPT.items[1]],
    };
    const c = convertGeminiReceipt(parseGeminiResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(wrong) }] } }] }), "2026-10-30");
    expect(c.lines[0].lineTotalAgorot).toBe(1280);
    expect(c.lines[0].confidence).toBe("medium");
    expect(c.lines[0].lowConfidenceFields).toEqual(expect.arrayContaining(["quantity", "unitPrice", "lineTotal"]));
    expect(c.lines[1].confidence).toBe("high");
    expect(c.headerLowConfidence).toEqual(expect.arrayContaining(["purchaseDate", "total"]));
    expect(c.confidence).toBe("medium");
  });

  test("base64 encoding matches Node's", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("geminiOcr.extract", () => {
  test("stores a draft for review and sends the image with the API key header", async () => {
    const t = convexTest(schema, modules);
    const receiptId = await newReceipt(t);
    const fetchMock = vi.fn(async () => ok(RECEIPT));
    vi.stubGlobal("fetch", fetchMock);

    const res = await t.action(api.geminiOcr.extract, { editorCode: CODE, receiptId });
    expect(res).toMatchObject({ ok: true, lines: 3 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(url).not.toContain("test-key");
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe("image/jpeg");
    expect(body.generationConfig.responseMimeType).toBe("application/json");

    const r = await t.run((ctx) => ctx.db.get(receiptId));
    expect(r).toMatchObject({
      verificationStatus: "draft",
      ocrStatus: "done",
      purchaseDate: "2026-10-30",
      storeName: "שופרסל דיל",
      totalAgorot: 2030,
      ocrConfidence: "high",
    });
    expect(r!.ocrModel).toContain("Gemini");
    expect(r!.reconciliation?.status).toBe("match");
    const items = await t.run((ctx) => ctx.db.query("receiptItems").collect());
    expect(items.map((i) => [i.originalDescription, i.quantity, i.lineTotalAgorot])).toEqual([
      ["חלב 3% 1 ל", 2, 1380],
      ["לחם אחיד", 1, 750],
      ["הנחת מועדון", 1, -100],
    ]);
    const status = await t.query(api.app.status, {});
    expect(status.gemini).toEqual({ enabled: true, monthlyLimit: 30, usedThisMonth: 1 });
  });

  test("moves to the next model when one is unavailable or out of free quota", async () => {
    const t = convexTest(schema, modules);
    const receiptId = await newReceipt(t);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":404}}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"error":{"code":429,"message":"limit: 0"}}', { status: 429 }))
      .mockResolvedValueOnce(ok(RECEIPT, "gemini-flash-lite"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await t.action(api.geminiOcr.extract, { editorCode: CODE, receiptId });
    expect(res.model).toBe("gemini-flash-lite");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // One reading counts once, however many models were tried.
    expect((await t.query(api.app.status, {})).gemini.usedThisMonth).toBe(1);
  });

  test("an invalid key fails clearly and marks the receipt for manual entry", async () => {
    const t = convexTest(schema, modules);
    const receiptId = await newReceipt(t);
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"API key not valid. Please pass a valid API key."}}', { status: 400 })));
    await expect(t.action(api.geminiOcr.extract, { editorCode: CODE, receiptId })).rejects.toThrow(/מפתח/);
    const r = await t.run((ctx) => ctx.db.get(receiptId));
    expect(r!.ocrStatus).toBe("failed");
  });

  test("enforces the monthly limit of 30 before calling Google", async () => {
    const t = convexTest(schema, modules);
    const receiptId = await newReceipt(t);
    await t.run((ctx) =>
      ctx.db.insert("aiUsage", { provider: "gemini", month: new Date().toISOString().slice(0, 7), count: 30, updatedAt: 0 }),
    );
    const fetchMock = vi.fn(async () => ok(RECEIPT));
    vi.stubGlobal("fetch", fetchMock);
    await expect(t.action(api.geminiOcr.extract, { editorCode: CODE, receiptId })).rejects.toThrow(/30/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requires the editor code, a configured key, and an unapproved receipt", async () => {
    const t = convexTest(schema, modules);
    const receiptId = await newReceipt(t);
    const fetchMock = vi.fn(async () => ok(RECEIPT));
    vi.stubGlobal("fetch", fetchMock);
    await expect(t.action(api.geminiOcr.extract, { editorCode: "wrong-code-000", receiptId })).rejects.toThrow();
    process.env.GEMINI_OCR_ENABLED = "false";
    await expect(t.action(api.geminiOcr.extract, { editorCode: CODE, receiptId })).rejects.toThrow(/Gemini/);
    delete process.env.GEMINI_OCR_ENABLED;
    await t.run((ctx) => ctx.db.patch(receiptId, { verificationStatus: "verified" }));
    await expect(t.action(api.geminiOcr.extract, { editorCode: CODE, receiptId })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await t.query(api.app.status, {})).gemini.usedThisMonth).toBe(0);
  });
});
