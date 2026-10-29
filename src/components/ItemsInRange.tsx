import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { LINE_TYPE_LABELS, formatIls, formatIsoDate, formatQuantity } from "../lib/format";
import { useAppState } from "../state/AppState";
import { OpenReceiptButton } from "./ReceiptFile";
import { ReceiptStatusChips } from "./ReceiptStatus";
import { Chip, EmptyState, Loading } from "./ui";

/** Every receipt in a date range with its lines, prices and linked alerts. */
export function ItemsInRange({ from, to }: { from: string; to: string }) {
  const { dataset } = useAppState();
  const rows = useQuery(api.receipts.itemsInRange, { dataset, from, to });
  if (rows === undefined) return <Loading />;
  if (rows.length === 0) return <EmptyState title="אין קבלות בטווח זה" />;
  return (
    <div className="space-y-4">
      <p className="text-ink-soft">{rows.length} קבלות · {rows.reduce((s, r) => s + r.items.length, 0)} שורות</p>
      {rows.map((r) => (
        <section key={r._id} className="rounded-2xl border border-line bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link to={`/receipts/${r._id}`} className="num text-lg font-bold text-brand-700 underline">{r.purchaseDate ? formatIsoDate(r.purchaseDate) : "ללא תאריך"}</Link>
            <span className="font-medium">{r.storeName ?? "—"}</span>
            <span className="num font-bold">{formatIls(r.totalAgorot)}</span>
            <ReceiptStatusChips r={r} />
            {r.hasFile && <span className="ms-auto"><OpenReceiptButton receiptId={r._id} compact /></span>}
          </div>
          {r.alerts.length > 0 && (
            <ul className="mb-2 space-y-1">
              {r.alerts.map((a) => (
                <li key={a._id}>
                  <Link to={`/alerts?focus=${a._id}`} className="inline-flex items-center gap-2 text-sm">
                    <Chip tone={a.status === "pending" ? "review" : "neutral"} icon="bell">{a.status === "pending" ? "ממתין לבדיקה" : a.status === "explained" ? "נבדק והוסבר" : "נדרש בירור"}</Chip>
                    <span className="text-brand-700 underline">{a.reason}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-ink-soft">
                <tr className="border-b border-line">
                  <th className="p-2 text-start font-medium">מוצר</th>
                  <th className="p-2 text-start font-medium">כפי שמודפס</th>
                  <th className="p-2 text-start font-medium">כמות</th>
                  <th className="p-2 text-start font-medium">מחיר</th>
                  <th className="p-2 text-start font-medium">סכום</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.items.map((i) => (
                  <tr key={i._id}>
                    <td className="p-2">
                      {i.productId ? <Link className="text-brand-700 underline" to={`/analysis/products/${i.productId}`}>{i.productName}</Link> : <span className="text-ink-soft">{i.lineType === "item" ? "לא שויך" : LINE_TYPE_LABELS[i.lineType]}</span>}
                    </td>
                    <td className="p-2 text-ink-soft">{i.originalDescription}</td>
                    <td className="num p-2 text-end">{formatQuantity(i.quantity, i.unit)}</td>
                    <td className="num p-2 text-end">{i.unitPriceAgorot != null ? formatIls(i.unitPriceAgorot) : "—"}</td>
                    <td className="num p-2 text-end">{formatIls(i.lineTotalAgorot - (i.discountAgorot ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
