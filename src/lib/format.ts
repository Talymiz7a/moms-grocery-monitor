export { formatIsoDate, parseDayFirstDate, isValidIsoDate } from "../../convex/lib/dates";
export { formatIls, parseShekelInput, toAgorot, fromAgorot } from "../../convex/lib/money";

export const UNIT_LABELS: Record<string, string> = {
  unit: "יח'",
  kg: 'ק"ג',
  g: "גרם",
  l: "ליטר",
  ml: 'מ"ל',
  pack: "אריזה",
};

export const LINE_TYPE_LABELS: Record<string, string> = {
  item: "פריט",
  discount: "הנחה",
  return: "החזרה",
  deposit: "פיקדון",
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  high: "ודאות גבוהה",
  medium: "ודאות בינונית",
  low: "ודאות נמוכה",
};

export const FIELD_LABELS: Record<string, string> = {
  description: "תיאור",
  quantity: "כמות",
  unitPrice: "מחיר ליחידה",
  lineTotal: "סכום שורה",
  discount: "הנחה",
  storeName: "חנות",
  purchaseDate: "תאריך",
  receiptNumber: "מספר קבלה",
  total: "סכום כולל",
};

export function formatQuantity(q: number, unit: string): string {
  const n = unit === "kg" ? q.toLocaleString("he-IL", { maximumFractionDigits: 3 }) : q.toLocaleString("he-IL", { maximumFractionDigits: 2 });
  return `${n} ${UNIT_LABELS[unit] ?? ""}`.trim();
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Extracts a readable Hebrew message from a Convex or network error. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "data" in e) {
    const data = (e as { data: unknown }).data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "message" in data) return String((data as { message: unknown }).message);
  }
  if (e instanceof Error && /fetch|network/i.test(e.message)) return "אין חיבור לשרת. בדקו את החיבור ונסו שוב.";
  return "אירעה שגיאה. נסו שוב.";
}
