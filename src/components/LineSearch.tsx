import { useQuery } from "convex/react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatIls, formatIsoDate, formatQuantity } from "../lib/format";
import { useAppState } from "../state/AppState";
import { Chip, inputClass } from "./ui";

/**
 * Searches every receipt line by its printed wording (linked to a product or
 * not) and lists where and when it was bought. Matching products link to
 * their analysis page.
 */
export function LineSearch() {
  const { readArgs } = useAppState();
  const [text, setText] = useState("");
  const query = useDeferredValue(text.trim());
  const result = useQuery(api.receipts.searchLines, query.length >= 2 ? { ...readArgs, text: query } : "skip");
  const lines = result?.lines ?? [];
  const receiptCount = new Set(lines.map((l) => l.receiptId)).size;
  const total = lines.reduce((s, l) => s + l.lineTotalAgorot - (l.discountAgorot ?? 0), 0);

  return (
    <div>
      <label className="mb-1 block font-medium" htmlFor="line-search">חיפוש מוצר בכל הקבלות</label>
      <input
        id="line-search"
        type="search"
        className={`${inputClass} max-w-xl`}
        placeholder="למשל: בננה, חלב, ביצים…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {query.length >= 2 && result && (
        <div className="mt-4" aria-live="polite">
          {lines.length === 0 && result.products.length === 0 ? (
            <p className="text-ink-soft">לא נמצאו שורות שמכילות „{query}”.</p>
          ) : (
            <>
              <p className="mb-2 font-medium">
                נמצאו <span className="num">{lines.length}</span> שורות ב-<span className="num">{receiptCount}</span> קבלות · סה"כ <span className="num">{formatIls(total)}</span>
                {result.truncated && <span className="text-ink-soft"> (מוצגות 200 האחרונות)</span>}
              </p>
              {result.products.length > 0 && (
                <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink-soft">ניתוח מוצר:</span>
                  {result.products.map((p) => (
                    <Link key={p._id} to={`/analysis/products/${p._id}`} className="rounded-full border border-brand-500 px-3 py-1 font-medium text-brand-700 hover:bg-brand-50">
                      {p.canonicalName}
                    </Link>
                  ))}
                </p>
              )}
              {lines.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="bg-page text-ink-soft">
                      <tr>
                        <th className="p-2 text-start font-medium">תאריך</th>
                        <th className="p-2 text-start font-medium">חנות</th>
                        <th className="p-2 text-start font-medium">כפי שמודפס</th>
                        <th className="p-2 text-end font-medium">כמות</th>
                        <th className="p-2 text-end font-medium">מחיר</th>
                        <th className="p-2 text-end font-medium">סכום</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l._id} className="border-t border-line">
                          <td className="num p-2">
                            <Link to={`/receipts/${l.receiptId}`} className="font-medium text-brand-700 underline">
                              {l.purchaseDate ? formatIsoDate(l.purchaseDate) : "ללא תאריך"}
                            </Link>
                          </td>
                          <td className="p-2">{l.storeName ?? "—"}</td>
                          <td className="p-2">
                            {l.originalDescription}
                            {l.productName && l.productName !== l.originalDescription && <span className="block text-xs text-ink-soft">{l.productName}</span>}
                            {!l.verified && <Chip tone="review">ממתינה לבדיקה</Chip>}
                          </td>
                          <td className="num p-2 text-end">{formatQuantity(l.quantity, l.unit)}</td>
                          <td className="num p-2 text-end">{l.unitPriceAgorot != null ? formatIls(l.unitPriceAgorot) : "—"}</td>
                          <td className="num p-2 text-end">{formatIls(l.lineTotalAgorot - (l.discountAgorot ?? 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
