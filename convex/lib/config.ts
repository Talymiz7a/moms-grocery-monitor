export const DEFAULT_OCR_MODEL = "claude-opus-5-5";

/**
 * Receipt reading with Claude is a paid API call, so it is off unless both
 * OCR_ENABLED=true and ANTHROPIC_API_KEY are set in the Convex environment.
 */
export function ocrConfig() {
  const enabled = process.env.OCR_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;
  return { enabled, model: process.env.OCR_MODEL || DEFAULT_OCR_MODEL };
}

export const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** The Gemini key with stray spaces or quotes from pasting removed. */
export function geminiApiKey(): string | undefined {
  const key = process.env.GEMINI_API_KEY?.trim().replace(/^["']|["']$/g, "");
  return key || undefined;
}

/** The app's own cap on Gemini receipt readings per calendar month (UTC). */
export const GEMINI_MONTHLY_LIMIT = 30;

/**
 * Models tried in order for each reading mode; when one is unavailable, out of
 * free quota or too slow, the next is tried. "-latest" aliases follow Google's
 * current models. Measured on a real Shufersal receipt: Flash-Lite answered in
 * ~4 s with every amount right; Flash took ~100 s and read names better.
 */
export const GEMINI_MODELS = {
  fast: ["gemini-flash-lite-latest", "gemini-flash-latest"],
  careful: ["gemini-flash-latest", "gemini-flash-lite-latest"],
} as const;
export type GeminiMode = keyof typeof GEMINI_MODELS;

/**
 * Receipt reading with the Gemini API free tier. On when GEMINI_API_KEY is set
 * in the Convex environment (GEMINI_OCR_ENABLED=false switches it off). The
 * key must come from a Google AI Studio project without billing, so requests
 * beyond the free limits are refused by Google instead of charged.
 */
export function geminiConfig(mode: GeminiMode = "fast") {
  const enabled = !!geminiApiKey() && process.env.GEMINI_OCR_ENABLED?.trim().toLowerCase() !== "false";
  const preferred = process.env.GEMINI_MODEL?.trim();
  const defaults: readonly string[] = GEMINI_MODELS[mode];
  const models = preferred ? [preferred, ...defaults.filter((m) => m !== preferred)] : [...defaults];
  return { enabled, models, monthlyLimit: GEMINI_MONTHLY_LIMIT };
}
