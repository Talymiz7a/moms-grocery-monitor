import { useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PeriodPicker, monthTitle, periodRange, type Period } from "../components/PeriodPicker";
import { ProductSearch } from "../components/ProductSearch";
import { Button, Card, EmptyState, Loading, Notice, PageHeader } from "../components/ui";
import { downloadCsv, downloadXlsx, printDocument, tableToHtml, escapeHtml, type Table } from "../lib/exporters";
import { UNIT_LABELS, formatDateTime, formatIls, formatIsoDate } from "../lib/format";
import { useAppState } from "../state/AppState";
import { ALERT_STATUS, ALERT_TYPES } from "./Alerts";
import { monthLabel } from "./ProductDetail";

const TABS = [
  { key: "monthly", label: "סיכום חודשי" },
  { key: "comparison", label: "השוואת תדירות וכמות" },
  { key: "open", label: "התראות פתוחות" },
  { key: "reviewed", label: "התראות שנבדקו" },
  { key: "product", label: "היסטוריית מוצר" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const sev = (s: string) => (s === "high" ? "גבוהה" : s === "medium" ? "בינונית" : "נמוכה");
const pct = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? "0%" : "חדש") : `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%`);

export function Reports() {
  const { dataset } = useAppState();
  const base = useQuery(api.analytics.periodSummary, { dataset });
  const [period, setPeriod] = useState<Period>({ mode: "all" });
  const [tab, setTab] = useState<TabKey>("monthly");
  const [product, setProduct] = useState<{ _id: string; canonicalName: string } | null>(null);
  const range = periodRange(period, base?.dataFrom, base?.dataTo);
  const from = range.from ?? base?.dataFrom ?? undefined;
  const to = range.to ?? base?.dataTo ?? undefined;
  const data = useQuery(api.analytics.reportData, from && to && range.valid ? { dataset, from, to } : "skip");
  const productData = useQuery(api.analytics.productDetail, product ? { dataset, productId: product._id as Id<"products"> } : "skip");

  if (base === undefined) return <Loading />;
  if (!base.dataFrom) return <EmptyState title="אין עדיין נתונים לדוחות" />;

  const created = formatDateTime(Date.now());
  const periodText = from && to ? `מ-${formatIsoDate(from)} עד ${formatIsoDate(to)}` : "";
  const meta = [`מעקב קניות אמא — דוח`, `תקופה: ${periodText}`, `נוצר: ${created}`, dataset === "demo" ? "נתוני הדגמה בדיוניים" : ""].filter(Boolean);

  const tables: Record<TabKey, Table | null> = {
    monthly: data
      ? {
          name: "סיכום חודשי",
          headers: ["חודש", "קבלות", "מופעי רכישה", "מוצרים שונים", "הוצאה ₪", "התראות בחודש"],
          rows: data.monthlySummary.map((m) => [monthLabel(m.month), m.receipts, m.occasions, m.distinctProducts, m.spendAgorot / 100, m.alertsOpened]),
        }
      : null,
    comparison: data
      ? {
          name: "השוואת תדירות וכמות",
          headers: ["מוצר", "מופעים", "מופעים בתקופה הקודמת", "שינוי", "כמות", "כמות בתקופה הקודמת", "יחידה", "הופעות בשורות"],
          rows: data.comparison.map((c) => [c.name, c.occasions, c.prevOccasions, pct(c.occasions, c.prevOccasions), c.quantity, c.prevQuantity, UNIT_LABELS[c.unit], c.lines]),
        }
      : null,
    open: data
      ? {
          name: "התראות פתוחות",
          headers: ["סוג", "חומרה", "סטטוס", "מוצר", "מתאריך", "עד תאריך", "תיאור", "ראיות מוגבלות"],
          rows: data.unresolvedAlerts.map((a) => [ALERT_TYPES[a.type], sev(a.severity), ALERT_STATUS[a.status].label, a.product ?? "", a.periodStart ? formatIsoDate(a.periodStart) : "", a.periodEnd ? formatIsoDate(a.periodEnd) : "", a.reason, a.limitedEvidence ? "כן" : ""]),
        }
      : null,
    reviewed: data
      ? {
          name: "התראות שנבדקו",
          headers: ["סוג", "סטטוס", "מוצר", "תיאור", "הערות", "נבדק על ידי", "תאריך טיפול"],
          rows: data.reviewedAlerts.map((a) => [ALERT_TYPES[a.type], ALERT_STATUS[a.status].label, a.product ?? "", a.reason, a.notes ?? "", a.resolvedBy ?? "", a.resolvedAt ? formatDateTime(a.resolvedAt) : ""]),
        }
      : null,
    product:
      productData && !("mergedIntoId" in productData)
        ? {
            name: `היסטוריית מוצר - ${productData.product.canonicalName}`,
            headers: ["תאריך", "חנות", "כמות", "יחידה", "מחיר ליחידה ₪", "סכום ₪", "ימים מהקודמת"],
            rows: productData.occasions
              .filter((o) => (!from || o.date >= from) && (!to || o.date <= to))
              .map((o) => [formatIsoDate(o.date), o.storeName ?? "", o.quantity, UNIT_LABELS[productData.product.unit], o.unitPriceAgorot === null ? "" : o.unitPriceAgorot / 100, o.spendAgorot / 100, o.daysSincePrevious ?? ""]),
          }
        : null,
  };
  const current = tables[tab];
  const all = (Object.values(tables).filter(Boolean) as Table[]);

  function pdf(list: Table[]) {
    const note = `<p class="note">מופע רכישה = קבלה שונה שבה נקנה המוצר. כמות = סכום היחידות. התראה אינה הוכחה לשימוש לא תקין.</p>`;
    printDocument(
      "דוח מעקב קניות",
      `<h1>מעקב קניות אמא — ${escapeHtml(list.length === 1 ? list[0].name : "דוח מלא")}</h1><p class="meta">${escapeHtml(meta.slice(1).join(" · "))}</p>${note}${list.map(tableToHtml).join("")}`,
    );
  }

  return (
    <>
      <PageHeader title="דוחות וייצוא" subtitle="כל דוח כולל את תקופת הדוח ואת תאריך היצירה. מותאם להדפסה לרוחב A4." />
      <Card className="mb-4 p-4">
        <PeriodPicker value={period} onChange={setPeriod} months={base.months} />
        <p className="mt-2 text-sm text-ink-soft">
          תקופה: {periodText}
          {data && <> · השוואה לתקופה הקודמת: מ-<span className="num">{formatIsoDate(data.previous.from)}</span> עד <span className="num">{formatIsoDate(data.previous.to)}</span></>}
        </p>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="סוג דוח">
        {TABS.map((t) => (
          <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`min-h-11 rounded-xl border px-3 font-medium ${tab === t.key ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-white hover:border-brand-500"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">{TABS.find((t) => t.key === tab)!.label}</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!current} onClick={() => current && downloadCsv(current, `report-${tab}.csv`, meta)}>CSV</Button>
            <Button variant="secondary" disabled={!current} onClick={() => current && downloadXlsx([current], `report-${tab}.xlsx`, meta)}>Excel</Button>
            <Button variant="secondary" disabled={!current} onClick={() => current && pdf([current])}>PDF / הדפסה</Button>
            <Button disabled={!data} onClick={() => downloadXlsx(all, "report-full.xlsx", meta)}>Excel — כל הדוחות</Button>
            <Button variant="secondary" disabled={!data} onClick={() => pdf(all)}>PDF — כל הדוחות</Button>
          </div>
        </div>

        {tab === "product" && (
          <div className="mb-4 max-w-md">
            <ProductSearch onPick={setProduct} placeholder="בחירת מוצר לדוח…" />
            {product && <p className="mt-2">מוצר נבחר: <Link className="font-medium text-brand-700 underline" to={`/analysis/products/${product._id}`}>{product.canonicalName}</Link></p>}
          </div>
        )}

        {tab === "product" && !product ? (
          <EmptyState title="בחרו מוצר" />
        ) : !current ? (
          <Loading />
        ) : current.rows.length === 0 ? (
          <EmptyState title="אין נתונים בתקופה זו" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-page text-ink-soft">
                <tr>{current.headers.map((h) => <th key={h} className="p-2 text-start font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {current.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={`p-2 ${typeof c === "number" ? "num text-end" : ""}`}>
                        {typeof c === "number" && current.headers[j].includes("₪") ? formatIls(Math.round(c * 100)) : c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "monthly" && data && (
          <p className="mt-3 text-sm text-ink-soft">חודשים: {data.monthlySummary.map((m) => monthTitle(m.month)).join(" · ")}</p>
        )}
      </Card>
      <div className="mt-4">
        <Notice tone="neutral" title="על הייצוא">
          CSV נפתח באקסל עם עברית תקינה; קובץ Excel נוצר מימין לשמאל עם כותרת, תקופה ותאריך יצירה; PDF נוצר דרך חלון ההדפסה (בחרו "שמירה כ-PDF"), לרוחב A4.
        </Notice>
      </div>
    </>
  );
}
