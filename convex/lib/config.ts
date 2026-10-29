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
