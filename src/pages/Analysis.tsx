import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { HEBREW_MONTHS } from "../../convex/lib/dates";
import { GroupedMonthChart, MonthLegend, type GridRow } from "../components/charts/GroupedMonthChart";
import { ProductSearch } from "../components/ProductSearch";
import { Button, Card, Chip, EmptyState, Loading, Notice, PageHeader, inputClass } from "../components/ui";
import { exportChartPng, printDocument, tableToHtml, downloadCsv, type Table } from "../lib/exporters";
import { MONTH_COLORS } from "../lib/chartColors";
import { UNIT_LABELS, formatDateTime } from "../lib/format";
import { useAppState } from "../state/AppState";

const PAGE = 10;

export function Analysis() {
  const { readArgs } = useAppState();
  const navigate = useNavigate();
  const years = useQuery(api.analytics.years, { ...readArgs });
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => {
    if (year === null && years && years.length) setYear(years[0]);
  }, [years, year]);
  const grid = useQuery(api.analytics.monthlyFrequency, year === null ? "skip" : { ...readArgs, year });
  const [selected, setSelected] = useState<{ _id: string; canonicalName: string }[]>([]);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"chart" | "table">("chart");
  const chartRef = useRef<HTMLDivElement>(null);

  const rows: GridRow[] = useMemo(() => {
    if (!grid) return [];
    if (selected.length) {
      const ids = selected.map((s) => s._id);
      return ids.map((id) => {
        const g = grid.find((r) => r.productId === id);
        const name = selected.find((s) => s._id === id)!.canonicalName;
        return g ?? { productId: id, name, unit: "unit", occasions: Array(12).fill(0), quantity: Array(12).fill(0) };
      });
    }
    return grid.slice(page * PAGE, page * PAGE + PAGE);
  }, [grid, selected, page]);
  const pageCount = grid ? Math.ceil(grid.length / PAGE) : 0;

  if (years === undefined) return <Loading />;
  if (years.length === 0) return <EmptyState title="אין עדיין רכישות שנבדקו" />;

  const title = `מופעי רכישה לפי מוצר וחודש — ${year}`;
  const table: Table = {
    name: `מופעי רכישה ${year}`,
    headers: ["מוצר", ...HEBREW_MONTHS, 'סה"כ מופעים', "יחידה", 'סה"כ כמות'],
    rows: rows.map((r) => [
      r.name,
      ...r.occasions,
      r.occasions.reduce((s, n) => s + n, 0),
      UNIT_LABELS[r.unit],
      Math.round(r.quantity.reduce((s, n) => s + n, 0) * 100) / 100,
    ]),
  };
  const meta = [title, `נוצר: ${formatDateTime(Date.now())}`, "מופע רכישה = קבלה שונה שבה נקנה המוצר (לא כמות)"];

  return (
    <>
      <PageHeader
        title="ניתוח מוצרים"
        subtitle="מספר הקבלות השונות שבהן נקנה כל מוצר, לפי חודש. שש יחידות באותה קבלה = מופע אחד."
      />
      <Card className="mb-4">
        <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)]">
          <label>
            <span className="mb-1 block font-medium">שנה</span>
            <select className={inputClass} value={year ?? ""} onChange={(e) => { setYear(Number(e.target.value)); setPage(0); }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <div>
            <span className="mb-1 block font-medium">בחירת מוצרים (ברירת מחדל: 10 המובילים)</span>
            <ProductSearch onPick={(p) => setSelected((s) => [...s, p])} exclude={selected.map((s) => s._id)} placeholder="הוספת מוצר להשוואה…" />
            {selected.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {selected.map((s) => (
                  <button key={s._id} type="button" onClick={() => setSelected((x) => x.filter((y) => y._id !== s._id))} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-brand-500 bg-brand-50 px-3 text-sm font-medium text-brand-700" aria-label={`הסרת ${s.canonicalName}`}>
                    {s.canonicalName} ✕
                  </button>
                ))}
                <button type="button" className="min-h-9 text-sm text-brand-700 underline" onClick={() => setSelected([])}>חזרה ל-10 המובילים</button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">{title}</h2>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-xl border border-line p-0.5" role="group" aria-label="תצוגה">
              {(["chart", "table"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`min-h-10 rounded-lg px-3 font-medium ${view === v ? "bg-brand-500 text-white" : "text-ink"}`}>
                  {v === "chart" ? "גרף" : "טבלה"}
                </button>
              ))}
            </div>
            <Button variant="secondary" disabled={view !== "chart"} onClick={() => chartRef.current && exportChartPng(chartRef.current, title, `product-frequency-${year}.png`, HEBREW_MONTHS.map((m, i) => ({ label: m, color: MONTH_COLORS[i] })))}>תמונה</Button>
            <Button
              variant="secondary"
              onClick={() => {
                const svg = chartRef.current?.querySelector("svg.recharts-surface")?.outerHTML ?? "";
                printDocument(title, `<h1>${title}</h1><p class="meta">${meta.slice(1).join(" · ")}</p>${view === "chart" ? `<div class="chart">${svg}</div>` : ""}${tableToHtml(table)}`);
              }}
            >
              PDF / הדפסה
            </Button>
            <Button variant="secondary" onClick={() => downloadCsv(table, `product-frequency-${year}.csv`, meta)}>CSV</Button>
          </div>
        </div>

        {grid === undefined ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="אין רכישות בשנה זו" />
        ) : view === "chart" ? (
          <>
            <MonthLegend />
            <div ref={chartRef} className="mt-3">
              <GroupedMonthChart rows={rows} year={year!} onSelect={(id) => navigate(`/analysis/products/${id}`)} />
            </div>
            <p className="mt-2 text-sm text-ink-soft">לחיצה על עמודה פותחת את היסטוריית המוצר. בטלפון ובאייפד אפשר לגלול את הגרף לצדדים.</p>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-page text-ink-soft">
                <tr>
                  <th className="p-2 text-start font-medium">מוצר</th>
                  {HEBREW_MONTHS.map((m) => <th key={m} className="p-2 text-center font-medium">{m}</th>)}
                  <th className="p-2 text-center font-medium">סה"כ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.productId}>
                    <td className="p-2"><Link className="font-medium text-brand-700 underline" to={`/analysis/products/${r.productId}`}>{r.name}</Link></td>
                    {r.occasions.map((n, i) => (
                      <td key={i} className={`num p-2 text-center ${n === 0 ? "text-ink-soft/50" : "font-semibold"}`} title={`${r.quantity[i]} ${UNIT_LABELS[r.unit]}`}>{n}</td>
                    ))}
                    <td className="num p-2 text-center font-bold">{r.occasions.reduce((s, n) => s + n, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selected.length === 0 && pageCount > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <Button variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>→ הקודמים</Button>
            <Chip>
              <span className="num">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, grid?.length ?? 0)}</span> מתוך <span className="num">{grid?.length}</span>
            </Chip>
            <Button variant="ghost" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>הבאים ←</Button>
          </div>
        )}
      </Card>
      <div className="mt-4">
        <Notice tone="neutral" title="איך לקרוא את הגרף">
          כל קבוצת עמודות היא מוצר; כל עמודה היא חודש. גובה העמודה = מספר הקבלות השונות שבהן נקנה המוצר באותו חודש — לא הכמות. הכמות מופיעה בחלונית שמוצגת במעבר או בהקשה.
        </Notice>
      </div>
    </>
  );
}
