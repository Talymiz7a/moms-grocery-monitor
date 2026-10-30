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
 * Models tried in order. Free-tier availability differs by model, so when one
 * is unavailable or has no free quota the next is tried. "-latest" aliases
 * follow Google's current Flash models.
 */
export const DEFAULT_GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"];

/**
 * Receipt reading with the Gemini API free tier. On when GEMINI_API_KEY is set
 * in the Convex environment (GEMINI_OCR_ENABLED=false switches it off). The
 * key must come from a Google AI Studio project without billing, so requests
 * beyond the free limits are refused by Google instead of charged.
 */
export function geminiConfig() {
  const enabled = !!geminiApiKey() && process.env.GEMINI_OCR_ENABLED?.trim().toLowerCase() !== "false";
  const preferred = process.env.GEMINI_MODEL?.trim();
  const models = preferred ? [preferred, ...DEFAULT_GEMINI_MODELS.filter((m) => m !== preferred)] : DEFAULT_GEMINI_MODELS;
  return { enabled, models, monthlyLimit: GEMINI_MONTHLY_LIMIT };
}
