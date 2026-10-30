// Write protection for the public preview.
//
// The preview has no login screen. Anyone may read the (fictional) demo
// data, but every change requires the editor code that is stored in the
// Convex environment variable EDITOR_CODE. If the variable is not set, all
// changes are refused. This is a stop-gap until real authentication is
// chosen; it must not be used to protect real receipts.

import { ConvexError } from "convex/values";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isEditorCodeValid(code: string | undefined | null): boolean {
  const expected = process.env.EDITOR_CODE;
  if (!expected || expected.length < 8 || !code) return false;
  return constantTimeEqual(code, expected);
}

export function requireEditor(code: string | undefined | null): void {
  if (!isEditorCodeValid(code)) {
    throw new ConvexError({ code: "READ_ONLY", message: "התצוגה במצב צפייה בלבד. נדרש קוד עורך כדי לשמור שינויים." });
  }
}

export const EDITOR_ACTOR = "עורך";

/**
 * Reading real data requires the editor code as well; demo data is public.
 * (Until proper sign-in is chosen, the editor code is the only protection.)
 */
export function requireDatasetRead(dataset: "demo" | "real", code: string | undefined | null): void {
  if (dataset === "real" && !isEditorCodeValid(code)) {
    throw new ConvexError({ code: "READ_PROTECTED", message: "נתונים אמיתיים זמינים רק במצב עריכה (נדרש קוד עורך)." });
  }
}
