// Dates are stored as ISO calendar dates ("YYYY-MM-DD") with no time zone,
// and shown to users as DD/MM/YYYY.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(iso: string): boolean {
  const m = ISO_RE.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Formats "2026-06-04" as "04/06/2026". Returns "" for missing values. */
export function formatIsoDate(iso: string | undefined | null): string {
  if (!iso) return "";
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Parses an Israeli-style date (day first) into ISO form.
 * Accepts DD/MM/YYYY, D/M/YY, DD.MM.YYYY, DD-MM-YY and ISO input.
 * Two-digit years are read as 20YY. Returns null when the date is invalid.
 */
export function parseDayFirstDate(input: string): string | null {
  const s = input.trim();
  if (ISO_RE.test(s)) return isValidIsoDate(s) ? s : null;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (m[3].length === 2) y += 2000;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** "2026-06" for an ISO date. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const tb = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((tb - ta) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

export const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];
