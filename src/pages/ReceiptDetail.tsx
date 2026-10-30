import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ReceiptFileViewer } from "../components/ReceiptFile";
import { ReceiptStatusChips } from "../components/ReceiptStatus";
import { Card, Chip, LinkButton, Loading, Notice, PageHeader } from "../components/ui";
import { CONFIDENCE_LABELS, LINE_TYPE_LABELS, formatDateTime, formatIls, formatIsoDate, formatQuantity } from "../lib/format";
import { useAppState } from "../state/AppState";
import { ReconciliationPanel } from "./Review";

export function ReceiptDetail() {
  const { id } = useParams();
  const receiptId = id as Id<"receipts">;
  const { isEditor, editorCode } = useAppState();
  const data = useQuery(api.receipts.get, { receiptId, editorCode: editorCode ?? undefined });
  if (data === undefined) return <Loading />;
  if (data === null) return <Notice tone="alert" title="הקבלה לא נמצאה" />;
  const { receipt: r, items, duplicateOf, audit } = data;
  const summary = {
    ...r,
    reconciliationStatus: r.reconciliation?.status,
    differenceAgorot: r.reconciliation?.differenceAgorot ?? null,
    duplicateSuspected: !!r.duplicateOfId && !r.duplicateOverride,
  };

  return (
    <>
      <PageHeader
        title={`${r.storeName ?? "קבלה"} · ${r.purchaseDate ? formatIsoDate(r.purchaseDate) : "ללא תאריך"}`}
        subtitle={<ReceiptStatusChips r={summary} />}
        actions={
          <>
            <LinkButton to="/receipts" icon="back" variant="ghost">לכל הקבלות</LinkButton>
            <LinkButton to={`/receipts/${receiptId}/review`} icon={isEditor ? "edit" : "eye"} variant="primary">
              {isEditor ? "בדיקה ועריכה" : "מסך הבדיקה"}
            </LinkButton>
          </>
        }
      />
      {duplicateOf && !r.duplicateOverride && (
        <div className="mb-4">
          <Notice tone="alert" icon="copy" title="ייתכן שזו קבלה כפולה">
            {r.duplicateReason}.{" "}
            <Link className="font-medium text-brand-700 underline" to={`/receipts/${duplicateOf._id}`}>
              לקבלה המקורית ({duplicateOf.purchaseDate ? formatIsoDate(duplicateOf.purchaseDate) : "ללא תאריך"}, {formatIls(duplicateOf.totalAgorot)})
            </Link>
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Info label="חנות" value={r.storeName ?? "—"} />
              <Info label="תאריך" value={r.purchaseDate ? formatIsoDate(r.purchaseDate) : "חסר"} num />
              <Info label="מספר קבלה" value={r.receiptNumber ?? "—"} num />
              <Info label="סכום מודפס" value={formatIls(r.totalAgorot)} num />
              <Info label="קונה" value={r.shopper ?? "—"} />
              <Info label="מקור התאריך" value={r.purchaseDateSource === "ocr" ? "מהקבלה" : r.purchaseDateSource === "manual" ? "הוזן ידנית" : "חסר"} />
              <Info label="קריאת הקבלה" value={r.ocrModel ?? (r.ocrStatus === "manual" ? "הזנה ידנית" : "—")} />
              <Info label="הועלתה" value={formatDateTime(r.uploadedAt)} num />
            </dl>
            {r.notes && <p className="mt-4 rounded-xl bg-page p-3">הערות: {r.notes}</p>}
          </Card>
          <Card>
            <h2 className="mb-3 text-xl font-bold">שורות הקבלה</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem]">
                <thead className="text-ink-soft">
                  <tr className="border-b border-line">
                    <th className="p-2 text-start font-medium">כפי שמודפס</th>
                    <th className="p-2 text-start font-medium">מוצר מאושר</th>
                    <th className="p-2 text-start font-medium">כמות</th>
                    <th className="p-2 text-start font-medium">מחיר</th>
                    <th className="p-2 text-start font-medium">סכום</th>
                    <th className="p-2 text-start font-medium">הנחה</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((it) => (
                    <tr key={it._id} className={it.confidence === "low" ? "bg-review-50" : ""}>
                      <td className="p-2">
                        {it.originalDescription}
                        <span className="ms-2 inline-flex gap-1">
                          {it.lineType !== "item" && <Chip>{LINE_TYPE_LABELS[it.lineType]}</Chip>}
                          {it.confidence !== "high" && <Chip tone="review">{CONFIDENCE_LABELS[it.confidence]}</Chip>}
                          {it.corrected && <Chip tone="brand">תוקן ידנית</Chip>}
                        </span>
                      </td>
                      <td className="p-2">{it.productName ?? (it.lineType === "discount" ? "—" : <span className="text-review-700">לא שויך</span>)}</td>
                      <td className="num p-2 text-end">{formatQuantity(it.quantity, it.unit)}</td>
                      <td className="num p-2 text-end">{it.unitPriceAgorot != null ? formatIls(it.unitPriceAgorot) : "—"}</td>
                      <td className="num p-2 text-end font-medium">{formatIls(it.lineTotalAgorot)}</td>
                      <td className="num p-2 text-end">{it.discountAgorot ? formatIls(-it.discountAgorot) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.reconciliation && <div className="mt-4"><ReconciliationPanel rec={r.reconciliation} /></div>}
          </Card>
          <Card>
            <h2 className="mb-3 text-xl font-bold">היסטוריית שינויים</h2>
            <ul className="space-y-2">
              {audit.map((a) => (
                <li key={a._id} className="flex flex-wrap gap-x-3">
                  <span className="num text-ink-soft">{formatDateTime(a.at)}</span>
                  <span className="font-medium">{a.actor}</span>
                  <span>{a.summary}</span>
                </li>
              ))}
              {audit.length === 0 && <li className="text-ink-soft">אין רישומים.</li>}
            </ul>
          </Card>
        </div>
        <Card className="h-fit xl:sticky xl:top-24">
          <h2 className="mb-3 text-xl font-bold">הקבלה המקורית</h2>
          <ReceiptFileViewer receiptId={receiptId} hasFile={!!r.fileId} />
          {r.ocrRawText && (
            <details className="mt-4">
              <summary className="cursor-pointer font-medium text-brand-700">טקסט מקורי שנקרא מהקבלה</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-page p-3 text-sm" dir="rtl">{r.ocrRawText}</pre>
            </details>
          )}
        </Card>
      </div>
    </>
  );
}

function Info({ label, value, num = false }: { label: string; value: string; num?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className={`font-medium ${num ? "num text-end sm:text-start" : ""}`}>{value}</dd>
    </div>
  );
}
