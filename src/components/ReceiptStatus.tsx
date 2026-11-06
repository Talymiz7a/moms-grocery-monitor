import { formatIls } from "../lib/format";
import { Chip } from "./ui";

type Summary = {
  verificationStatus: "draft" | "verified";
  ocrConfidence?: "high" | "medium" | "low";
  reconciliationStatus?: "match" | "mismatch" | "no_total" | "no_lines";
  differenceAgorot?: number | null;
  duplicateSuspected: boolean;
  purchaseDate?: string;
};

/**
 * The difference is printed total − (lines − discounts). Negative: the lines add
 * up to more than the receipt says; positive: to less.
 */
export function mismatchShort(differenceAgorot: number): string {
  const amount = formatIls(Math.abs(differenceAgorot));
  return differenceAgorot < 0 ? `השורות גבוהות ב-${amount} מסה"כ הקבלה` : `השורות נמוכות ב-${amount} מסה"כ הקבלה`;
}

export function mismatchExplanation(differenceAgorot: number): string {
  const amount = formatIls(Math.abs(differenceAgorot));
  return differenceAgorot < 0
    ? `סכום השורות (אחרי הנחות) גבוה ב-${amount} מהסכום לתשלום שמודפס בקבלה. סיבות אפשריות: שורה שנרשמה פעמיים, מחיר או כמות שגויים, הנחה שלא הוזנה, או סכום לתשלום שנקרא לא נכון.`
    : `סכום השורות (אחרי הנחות) נמוך ב-${amount} מהסכום לתשלום שמודפס בקבלה. סיבות אפשריות: שורה חסרה, מחיר או כמות שגויים, הנחה שנרשמה פעמיים, או סכום לתשלום שנקרא לא נכון.`;
}

export function ReceiptStatusChips({ r }: { r: Summary }) {
  return (
    <span className="flex flex-wrap gap-1">
      {r.verificationStatus === "verified" ? <Chip tone="ok" icon="check">נבדקה</Chip> : <Chip tone="review">ממתינה לבדיקה</Chip>}
      {r.duplicateSuspected && <Chip tone="alert" icon="copy">כפולה אפשרית</Chip>}
      {r.reconciliationStatus === "mismatch" && r.differenceAgorot != null && (
        <Chip tone="review" icon="alert">{mismatchShort(r.differenceAgorot)}</Chip>
      )}
      {r.reconciliationStatus === "no_total" && <Chip tone="review">חסר סכום כולל</Chip>}
      {!r.purchaseDate && <Chip tone="review">חסר תאריך</Chip>}
      {r.verificationStatus === "draft" && r.ocrConfidence === "low" && <Chip tone="review">קריאה בוודאות נמוכה</Chip>}
    </span>
  );
}
