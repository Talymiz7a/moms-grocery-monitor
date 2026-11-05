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

export function ReceiptStatusChips({ r }: { r: Summary }) {
  return (
    <span className="flex flex-wrap gap-1">
      {r.verificationStatus === "verified" ? <Chip tone="ok" icon="check">נבדקה</Chip> : <Chip tone="review">ממתינה לבדיקה</Chip>}
      {r.duplicateSuspected && <Chip tone="alert" icon="copy">כפולה אפשרית</Chip>}
      {r.reconciliationStatus === "mismatch" && <Chip tone="review">פער בסכום {formatIls(r.differenceAgorot)}</Chip>}
      {r.reconciliationStatus === "no_total" && <Chip tone="review">חסר סכום כולל</Chip>}
      {!r.purchaseDate && <Chip tone="review">חסר תאריך</Chip>}
      {r.verificationStatus === "draft" && r.ocrConfidence === "low" && <Chip tone="review">קריאה בוודאות נמוכה</Chip>}
    </span>
  );
}
