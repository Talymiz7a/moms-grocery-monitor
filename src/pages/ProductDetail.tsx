import { useQuery } from "convex/react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { HEBREW_MONTHS } from "../../convex/lib/dates";
import { SeriesBarChart, SeriesLineChart } from "../components/charts/SeriesCharts";
import { ProductSearch } from "../components/ProductSearch";
import { Card, Chip, EmptyState, LinkButton, Loading, Notice, PageHeader, StatCard } from "../components/ui";
import { downloadCsv, printDocument, tableToHtml, type Table } from "../lib/exporters";
import { UNIT_LABELS, formatDateTime, formatIls, formatIsoDate, formatQuantity } from "../lib/format";
import { useAppState } from "../state/AppState";

const EXPECTED_USE: Record<string, { label: string; tone: "ok" | "neutral" | "review" | "alert" }> = {
  expected: { label: "צפוי", tone: "ok" },
  occasional: { label: "מזדמן", tone: "neutral" },
  not_expected: { label: "לא צפוי בדרך כלל", tone: "review" },
  manual_review: { label: "לבדיקה ידנית", tone: "review" },
};

export const monthLabel = (key: string) => `${HEBREW_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

type SortKey = "date" | "store" | "quantity" | "price" | "spend";

export function ProductDetail() {
  const { id } = useParams();
  const { dataset } = useAppState();
  const navigate = useNavigate();
  const data = useQuery(api.analytics.productDetail, { dataset, productId: id as Id<"products"> });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });

  if (data === undefined) return <Loading />;
  if (data === null) return <Notice tone="alert" title="המוצר לא נמצא" />;
  if ("mergedIntoId" in data) return <Navigate to={`/analysis/products/${data.mergedIntoId}`} replace />;

  const { product: p, summary, monthly, occasions, expectation, alerts } = data;
  const unit = UNIT_LABELS[p.unit];
  const priceUnit = occasions.find((o) => o.standardPrice)?.standardPrice?.per;
  const priceLabel = priceUnit === "kg" ? '₪ לק"ג' : priceUnit === "l" ? "₪ לליטר" : `₪ ל${unit}`;

  const sorted = [...occasions].sort((a, b) => {
    const v = (o: (typeof occasions)[number]) =>
      sort.key === "date" ? o.date : sort.key === "store" ? o.storeName ?? "" : sort.key === "quantity" ? o.quantity : sort.key === "price" ? o.unitPriceAgorot ?? 0 : o.spendAgorot;
    const x = v(a), y = v(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  const th = (key: SortKey, label: string) => (
    <th className="p-2 text-start font-medium">
      <button type="button" className="inline-flex min-h-9 items-center gap-1 hover:text-brand-700" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "date" ? -1 : 1 }))} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        {label} {sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}
      </button>
    </th>
  );

  const purchasesTable: Table = {
    name: "כל הרכישות",
    headers: ["תאריך", "חנות", "כמות", "יחידה", "מחיר ליחידה ₪", "סכום ₪", "שורות בקבלה", "ימים מהרכישה הקודמת"],
    rows: occasions.map((o) => [formatIsoDate(o.date), o.storeName ?? "", o.quantity, unit, o.unitPriceAgorot === null ? "" : o.unitPriceAgorot / 100, o.spendAgorot / 100, o.lineCount, o.daysSincePrevious ?? ""]),
  };
  const monthlyTable: Table = {
    name: "לפי חודש",
    headers: ["חודש", "מופעי רכישה", "ממוצע 3 חודשים קודמים", `כמות (${unit})`, "ממוצע כמות קודם", "מחיר ממוצע ₪"],
    rows: monthly.map((m) => [monthLabel(m.month), m.occasions, m.priorAvgOccasions ?? "", m.quantity, m.priorAvgQuantity ?? "", m.avgUnitPriceAgorot === null ? "" : m.avgUnitPriceAgorot / 100]),
  };
  const created = `נוצר: ${formatDateTime(Date.now())}`;

  return (
    <>
      <PageHeader
        title={p.canonicalName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {p.category && <Chip>{p.category}</Chip>}
            <Chip tone={EXPECTED_USE[p.expectedUse].tone}>{EXPECTED_USE[p.expectedUse].label}</Chip>
            <span>יחידה: {unit}{p.packageSize ? ` · אריזה ${p.packageSize} ${UNIT_LABELS[p.packageUnit ?? "unit"]}` : ""}</span>
          </span>
        }
        actions={
          <>
            <LinkButton to="/analysis" icon="back" variant="ghost">לכל המוצרים</LinkButton>
            <button type="button" className="inline-flex min-h-11 items-center rounded-xl border border-brand-500 px-4 font-medium text-brand-700" onClick={() => printDocument(p.canonicalName, `<h1>היסטוריית מוצר: ${p.canonicalName}</h1><p class="meta">${summary.firstDate ? `${formatIsoDate(summary.firstDate)}–${formatIsoDate(summary.lastDate)}` : ""} · ${created}</p>${tableToHtml(monthlyTable)}${tableToHtml(purchasesTable)}`)}>PDF / הדפסה</button>
            <button type="button" className="inline-flex min-h-11 items-center rounded-xl border border-brand-500 px-4 font-medium text-brand-700" onClick={() => downloadCsv(purchasesTable, `product-history.csv`, [`היסטוריית מוצר: ${p.canonicalName}`, created])}>CSV</button>
          </>
        }
      />
      <div className="mb-4 max-w-md">
        <ProductSearch onPick={(x) => navigate(`/analysis/products/${x._id}`)} placeholder="מעבר למוצר אחר…" />
      </div>

      {summary.totalOccasions === 0 ? (
        <EmptyState title="אין רכישות מאושרות של מוצר זה" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="מופעי רכישה" value={summary.totalOccasions} hint="קבלות שונות" />
            <StatCard label="כמות כוללת" value={formatQuantity(summary.totalQuantity, p.unit)} />
            <StatCard label="הופעות בשורות" value={summary.totalLines} hint="שורות בקבלות" />
            <StatCard label="מרווח טיפוסי" value={summary.medianIntervalDays === null ? "—" : `${summary.medianIntervalDays} ימים`} hint="חציון בין רכישות" />
            <StatCard label="מרווח קצר ביותר" value={summary.minIntervalDays === null ? "—" : `${summary.minIntervalDays} ימים`} />
            <StatCard label="סך הוצאה" value={formatIls(summary.totalSpendAgorot)} hint="משני לתדירות ולכמות" />
          </div>
          {summary.incompatibleLines > 0 && (
            <div className="mt-3">
              <Notice tone="review" title={`${summary.incompatibleLines} שורות ביחידה שלא ניתן להמיר`}>שורות אלה נספרות במופעים אך לא נוספו לכמות, כדי לא לחבר יחידות שונות.</Notice>
            </div>
          )}
          {expectation && (
            <div className="mt-3">
              <Notice tone="neutral" title="ציפייה מוגדרת (ידנית)">
                {[
                  expectation.usualQuantity && `כמות רגילה: ${expectation.usualQuantity} ${UNIT_LABELS[expectation.usualUnit ?? p.unit]}`,
                  expectation.expectedIntervalDays && `כל ${expectation.expectedIntervalDays} ימים`,
                  expectation.maxPerMonth && `עד ${expectation.maxPerMonth} פעמים בחודש`,
                  expectation.minIntervalDays && `לפחות ${expectation.minIntervalDays} ימים בין רכישות`,
                  expectation.quantityMax && `עד ${expectation.quantityMax} ${unit} בקנייה`,
                ].filter(Boolean).join(" · ")}
              </Notice>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <h2 className="mb-1 text-lg font-bold">מופעי רכישה לפי חודש</h2>
              <p className="mb-2 text-sm text-ink-soft">קבלות שונות שבהן נקנה המוצר</p>
              <SeriesBarChart unitLabel="מופעים" data={monthly.map((m) => ({ label: monthLabel(m.month), value: m.occasions, hint: m.priorAvgOccasions === null ? "אין חודשים קודמים להשוואה" : `ממוצע 3 חודשים קודמים: ${m.priorAvgOccasions}` }))} />
            </Card>
            <Card>
              <h2 className="mb-1 text-lg font-bold">כמות לפי חודש</h2>
              <p className="mb-2 text-sm text-ink-soft">סכום יחידות ({unit})</p>
              <SeriesBarChart allowDecimals unitLabel={unit} data={monthly.map((m) => ({ label: monthLabel(m.month), value: m.quantity, hint: m.priorAvgQuantity === null ? undefined : `ממוצע קודם: ${m.priorAvgQuantity}` }))} />
            </Card>
            <Card>
              <h2 className="mb-1 text-lg font-bold">היסטוריית מחיר</h2>
              <p className="mb-2 text-sm text-ink-soft">{priceLabel}, לאחר הנחות בשורה (מנורמל לגודל אריזה כשאפשר)</p>
              <SeriesLineChart
                unitLabel={priceLabel}
                data={occasions.map((o) => ({ label: formatIsoDate(o.date).slice(0, 5), value: o.standardPrice ? Math.round(o.standardPrice.agorot) / 100 : null, hint: o.storeName }))}
              />
            </Card>
            <Card>
              <h2 className="mb-3 text-lg font-bold">השוואה לחודשים קודמים</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-ink-soft">
                    <tr className="border-b border-line">
                      <th className="p-2 text-start font-medium">חודש</th>
                      <th className="p-2 text-start font-medium">מופעים</th>
                      <th className="p-2 text-start font-medium">ממוצע קודם</th>
                      <th className="p-2 text-start font-medium">כמות</th>
                      <th className="p-2 text-start font-medium">ממוצע קודם</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {monthly.map((m) => (
                      <tr key={m.month}>
                        <td className="p-2">{monthLabel(m.month)}</td>
                        <td className="num p-2 text-end font-semibold">{m.occasions}</td>
                        <td className="num p-2 text-end text-ink-soft">{m.priorAvgOccasions ?? "—"}</td>
                        <td className="num p-2 text-end">{m.quantity}</td>
                        <td className="num p-2 text-end text-ink-soft">{m.priorAvgQuantity ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-sm text-ink-soft">"ממוצע קודם" = עד 3 חודשים קודמים, מאז הרכישה הראשונה של המוצר.</p>
            </Card>
          </div>

          <Card className="mt-6">
            <h2 className="mb-3 text-lg font-bold">כל הרכישות ({occasions.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="text-ink-soft">
                  <tr className="border-b border-line">
                    {th("date", "תאריך")}
                    {th("store", "חנות")}
                    {th("quantity", "כמות")}
                    {th("price", "מחיר ליחידה")}
                    {th("spend", "סכום")}
                    <th className="p-2 text-start font-medium">ימים מהקודמת</th>
                    <th className="p-2 text-start font-medium">קבלה</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sorted.map((o) => (
                    <tr key={o.receiptId} className="hover:bg-page">
                      <td className="num p-2">{formatIsoDate(o.date)}</td>
                      <td className="p-2">{o.storeName ?? "—"}</td>
                      <td className="num p-2 text-end">{formatQuantity(o.quantity, p.unit)}{o.lineCount > 1 && <span className="text-ink-soft"> · {o.lineCount} שורות</span>}</td>
                      <td className="num p-2 text-end">{o.unitPriceAgorot === null ? "—" : formatIls(o.unitPriceAgorot)}</td>
                      <td className="num p-2 text-end">{formatIls(o.spendAgorot)}</td>
                      <td className="num p-2 text-end">{o.daysSincePrevious ?? "—"}</td>
                      <td className="p-2"><Link className="text-brand-700 underline" to={`/receipts/${o.receiptId}`}>לקבלה</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {alerts.length > 0 && (
            <Card className="mt-6">
              <h2 className="mb-3 text-lg font-bold">התראות למוצר זה</h2>
              <ul className="space-y-2">
                {alerts.map((a) => (
                  <li key={a._id}><Link className="text-brand-700 underline" to={`/alerts?focus=${a._id}`}>{a.reason}</Link></li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="mt-6">
            <h2 className="mb-2 text-lg font-bold">ניסוחים בקבלות שאושרו כמוצר זה</h2>
            <div className="flex flex-wrap gap-2">{p.aliases.map((a) => <Chip key={a}>{a}</Chip>)}</div>
          </Card>
        </>
      )}
    </>
  );
}
