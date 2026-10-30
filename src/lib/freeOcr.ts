// Free receipt reading in the browser with Tesseract.js — no paid API, and the
// image is processed on the device. Three passes over the same image are
// merged (Hebrew words / Hebrew+English / digits-only prices) and parsed with
// the receipt parser. Everything it produces is a draft for human review.

import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { mergePasses, type OcrPass } from "../../convex/lib/ocrMerge";
import { parseReceipt, type ParsedReceipt } from "../../convex/lib/receiptParser";

const ASSETS = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract/core",
  langPath: "/tesseract/lang",
  gzip: true,
};

export type OcrProgress = { label: string; fraction: number };

const MAX_EDGE = 2600;
const MIN_WIDTH = 1000;

/** Decodes an image (applying the camera's orientation) and scales it to a size Tesseract reads well. */
export async function prepareImage(blob: Blob): Promise<HTMLCanvasElement> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    // Some formats (e.g. SVG) are not supported by createImageBitmap everywhere.
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    source = img;
  }
  const w = "naturalWidth" in source ? source.naturalWidth || source.width : source.width;
  const h = "naturalHeight" in source ? source.naturalHeight || source.height : source.height;
  let scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  if (w * scale < MIN_WIDTH) scale = Math.min(MIN_WIDTH / w, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingQuality = "high";
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  return canvas;
}

type TessData = {
  text?: string;
  blocks?: Array<{
    paragraphs: Array<{
      lines: Array<{
        confidence: number;
        bbox: { x0: number; x1: number; y0: number; y1: number };
        words: Array<{ text: string; confidence: number; bbox: { x0: number; x1: number; y0: number; y1: number } }>;
      }>;
    }>;
  }> | null;
};

function toPass(data: TessData): OcrPass {
  const lines: OcrPass["lines"] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        lines.push({
          conf: l.confidence,
          ...l.bbox,
          words: l.words.map((w) => ({ text: w.text, conf: w.confidence, ...w.bbox })),
        });
  return { lines };
}

const PASSES = [
  { key: "heb", langs: ["heb"], label: "קורא מילים בעברית", params: {} },
  { key: "mix", langs: ["heb", "eng"], label: "קורא עברית ומספרים", params: {} },
  { key: "num", langs: ["eng"], label: "קורא מחירים", params: { tessedit_char_whitelist: "0123456789.,-/:%xX*" } },
] as const;

/**
 * Reads a receipt image. Returns the parsed draft plus timing. Throws only on
 * technical failure (e.g. the engine could not load).
 */
export async function readReceiptFree(blob: Blob, onProgress: (p: OcrProgress) => void): Promise<{ parsed: ParsedReceipt; durationMs: number }> {
  const t0 = performance.now();
  onProgress({ label: "מכין את התמונה", fraction: 0.02 });
  const canvas = await prepareImage(blob);
  const results: Partial<Record<(typeof PASSES)[number]["key"], OcrPass>> = {};
  let worker: Worker | null = null;
  try {
    for (let i = 0; i < PASSES.length; i++) {
      const pass = PASSES[i];
      const base = 0.05 + (i / PASSES.length) * 0.9;
      const span = 0.9 / PASSES.length;
      const logger = (m: { status: string; progress: number }) => {
        const label = m.status === "recognizing text" ? pass.label : "טוען את מנוע הקריאה (בפעם הראשונה זה לוקח יותר זמן)";
        onProgress({ label: `${label} — שלב ${i + 1} מתוך ${PASSES.length}`, fraction: base + span * (m.status === "recognizing text" ? 0.3 + 0.7 * m.progress : 0.3 * m.progress) });
      };
      // A fresh worker per pass keeps memory low on iPad and resets parameters.
      worker = await createWorker([...pass.langs], OEM.LSTM_ONLY, { ...ASSETS, logger });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1", ...pass.params });
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
      results[pass.key] = toPass(data as unknown as TessData);
      await worker.terminate();
      worker = null;
    }
  } finally {
    if (worker) await worker.terminate();
  }
  onProgress({ label: "מנתח את השורות", fraction: 0.97 });
  const merged = mergePasses({ heb: results.heb, mix: results.mix!, num: results.num });
  const parsed = parseReceipt(merged);
  onProgress({ label: "הסתיים", fraction: 1 });
  return { parsed, durationMs: Math.round(performance.now() - t0) };
}

/** Shapes a parsed receipt for the `freeOcr.saveResult` mutation. */
export function toSaveArgs(parsed: ParsedReceipt, durationMs: number) {
  return {
    header: {
      storeName: parsed.storeName,
      purchaseDate: parsed.purchaseDate,
      receiptNumber: parsed.receiptNumber,
      totalAgorot: parsed.totalAgorot,
    },
    headerLowConfidence: parsed.headerLowConfidence,
    lines: parsed.lines.map(({ sourceText: _s, ...l }) => l),
    rawText: parsed.rawText,
    confidence: parsed.overallConfidence,
    unrecognized: parsed.unrecognized,
    dateText: parsed.dateText,
    durationMs,
  };
}
