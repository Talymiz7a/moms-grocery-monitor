import { useQuery } from "convex/react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { OpenReceiptButton } from "../components/ReceiptFile";
import { ProductSearch } from "../components/ProductSearch";
import { ItemsInRange } from "../components/ItemsInRange";
import { ReceiptStatusChips } from "../components/ReceiptStatus";
import { Card, EmptyState, Field, Loading, PageHeader, inputClass, warnInputClass } from "../components/ui";
import { formatIls, formatIsoDate, parseDayFirstDate } from "../lib/format";
import { useAppState } from "../state/AppState";

const FILTERS = [
  { key: "all", label: "הכל" },
  { key: "draft", label: "ממתינות לבדיקה" },
  { key: "verified", label: "נבדקו" },
  { key: "issues", label: "דורשות תשומת לב" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export function Receipts() {
  const { readArgs } = useAppState();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.find((f) => f.key === params.get("filter"))?.key ?? "all") as FilterKey;
  const [fromText, setFromText] = useState(() => formatIsoDate(params.get("from") ?? ""));
  const [toText, setToText] = useState(() => formatIsoDate(params.get("to") ?? ""));
  const from = parseDayFirstDate(fromText) ?? undefined;
  const to = parseDayFirstDate(toText) ?? undefined;
  const fromInvalid = fromText.trim() !== "" && !from;
  const toInvalid = toText.trim() !== "" && !to;
  const rawRows = useQuery(api.receipts.list, { ...readArgs, filter, from, to });
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });
  const [showItems, setShowItems] = useState(false);
  const rows = rawRows && sortRows(rawRows, sort);
  const th = (key: SortKey, label: string) => (
    <th className="p-3 text-start font-medium" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="inline-flex min-h-9 items-center gap-1 hover:text-brand-700"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "date" || key === "total" ? -1 : 1 }))}
      >
        {label} {sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader title="קבלות ורכישות" subtitle="כל הקבלות עם קישור לקבלה המקורית" />
      <Card className="mb-4">
        <div className="mb-4 max-w-xl">
          <span className="mb-1 block font-medium">חיפוש מוצר — כל הרכישות שלו</span>
          <ProductSearch onPick={(p) => navigate(`/analysis/products/${p._id}`)} placeholder="למשל: חלב, ביצים, קפה…" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="מתאריך" warn={fromInvalid ? "תאריך לא תקין (DD/MM/YYYY)" : undefined}>
            <input className={`${inputClass} ${fromInvalid ? warnInputClass : ""}`} inputMode="numeric" placeholder="DD/MM/YYYY" value={fromText} onChange={(e) => setFromText(e.target.value)} />
          </Field>
          <Field label="עד תאריך" warn={toInvalid ? "תאריך לא תקין (DD/MM/YYYY)" : undefined}>
            <input className={`${inputClass} ${toInvalid ? warnInputClass : ""}`} inputMode="numeric" placeholder="DD/MM/YYYY" value={toText} onChange={(e) => setToText(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <span className="mb-1 block font-medium">מצב</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="סינון לפי מצב">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setParams(f.key === "all" ? {} : { filter: f.key })}
                  className={`min-h-11 rounded-xl border px-3 font-medium ${filter === f.key ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-white hover:border-brand-500"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {(from || to) && (
          <p className="mt-3 text-sm text-ink-soft">קבלות ללא תאריך אינן מוצגות כשבוחרים טווח תאריכים.</p>
        )}
        {from && to && (
          <label className="mt-3 inline-flex min-h-11 items-center gap-2 font-medium">
            <input type="checkbox" className="size-5" checked={showItems} onChange={(e) => setShowItems(e.target.checked)} />
            הצגת כל הפריטים, הכמויות, המחירים וההתראות בטווח
          </label>
        )}
      </Card>

      {from && to && showItems ? (
        <ItemsInRange from={from} to={to} />
      ) : rows === undefined ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState title="לא נמצאו קבלות">נסו לשנות את הסינון.</EmptyState>
      ) : (
        <>
          <p className="mb-2 text-ink-soft">{rows.length} קבלות</p>
          {/* Table on wider screens */}
          <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
            <table className="w-full text-start">
              <thead className="bg-page text-ink-soft">
                <tr>
                  {th("date", "תאריך")}
                  {th("store", "חנות")}
                  {th("number", "מס' קבלה")}
                  {th("lines", "שורות")}
                  {th("total", "סכום")}
                  <th className="p-3 text-start font-medium">מצב</th>
                  <th className="p-3 text-start font-medium">מקור</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r._id} className="hover:bg-page">
                    <td className="p-3">
                      <Link className="num font-medium text-brand-700 underline" to={`/receipts/${r._id}`}>
                        {r.purchaseDate ? formatIsoDate(r.purchaseDate) : "ללא תאריך"}
                      </Link>
                    </td>
                    <td className="p-3">{r.storeName ?? "—"}</td>
                    <td className="num p-3 text-end whitespace-nowrap">{r.receiptNumber ?? "—"}</td>
                    <td className="num p-3 text-end">{r.itemCount}</td>
                    <td className="num p-3 text-end font-semibold">{formatIls(r.totalAgorot)}</td>
                    <td className="p-3"><ReceiptStatusChips r={r} /></td>
                    <td className="p-3">{r.hasFile ? <OpenReceiptButton receiptId={r._id} compact /> : "ידני"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Cards on phones */}
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => (
              <li key={r._id}>
                <Link to={`/receipts/${r._id}`} className="block rounded-2xl border border-line bg-white p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="num font-semibold">{r.purchaseDate ? formatIsoDate(r.purchaseDate) : "ללא תאריך"}</span>
                    <span className="num font-bold">{formatIls(r.totalAgorot)}</span>
                  </div>
                  <p className="mt-1">{r.storeName ?? "—"} · {r.itemCount} שורות</p>
                  <div className="mt-2"><ReceiptStatusChips r={r} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

    </>
  );
}

type SortKey = "date" | "store" | "number" | "lines" | "total";
type Row = { purchaseDate?: string; storeName?: string; receiptNumber?: string; itemCount: number; totalAgorot?: number; uploadedAt: number };

function sortRows<T extends Row>(rows: T[], sort: { key: SortKey; dir: 1 | -1 }): T[] {
  const val = (r: T): string | number =>
    sort.key === "date" ? r.purchaseDate ?? "" : sort.key === "store" ? r.storeName ?? "" : sort.key === "number" ? r.receiptNumber ?? "" : sort.key === "lines" ? r.itemCount : r.totalAgorot ?? -1;
  return [...rows].sort((a, b) => {
    // Receipts without a date stay at the top so they are never hidden.
    if (sort.key === "date" && !a.purchaseDate !== !b.purchaseDate) return a.purchaseDate ? 1 : -1;
    const x = val(a), y = val(b);
    const c = typeof x === "string" ? x.localeCompare(String(y), "he") : x - (y as number);
    return c * sort.dir || b.uploadedAt - a.uploadedAt;
  });
}
