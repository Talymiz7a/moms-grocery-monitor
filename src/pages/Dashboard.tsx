import { useQuery } from "convex/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { SeriesBarChart } from "../components/charts/SeriesCharts";
import { PeriodPicker, monthTitle, periodRange, type Period } from "../components/PeriodPicker";
import { Card, Chip, EmptyState, LinkButton, Loading, PageHeader, StatCard } from "../components/ui";
import { UNIT_LABELS, formatIls, formatIsoDate } from "../lib/format";
import { useAppState } from "../state/AppState";
import { ALERT_TYPES } from "./Alerts";

export function Dashboard() {
  const { dataset } = useAppState();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>({ mode: "all" });
  const base = useQuery(api.analytics.periodSummary, { dataset });
  const range = periodRange(period, base?.dataFrom, base?.dataTo);
  const s = useQuery(api.analytics.periodSummary, range.valid && period.mode !== "all" ? { dataset, from: range.from, to: range.to } : { dataset });
  if (s === undefined || base === undefined) return <Loading />;
  const q = range.from && range.to ? `from=${range.from}&to=${range.to}` : "";
  const maxTop = Math.max(1, ...s.top.map((t) => t.occasions));

  return (
    <>
      <PageHeader title="לוח בקרה" subtitle={`${range.label} · קבלות שנבדקו בלבד`} actions={<LinkButton to="/reports" icon="file">דוחות וייצוא</LinkButton>} />
      <Card className="mb-4 p-4">
        <PeriodPicker value={period} onChange={setPeriod} months={base.months} />
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="קבלות" value={s.receiptCount} to={`/receipts?filter=verified${q ? `&${q}` : ""}`} />
        <StatCard label="מוצרים שונים" value={s.distinctProducts} hint="זהות מוצר מאושרת" to="/analysis" />
        <StatCard label="מופעי רכישה" value={s.purchaseOccasions} hint="מוצר × קבלה (לא כמות)" to="/analysis" />
        <StatCard label="סך הוצאה" value={formatIls(s.totalSpendAgorot)} hint="משני לתדירות ולכמות" />
        <StatCard label="התראות פתוחות" value={s.openAlertCount} hint="בתקופה" to="/alerts" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-xl font-bold">מופעי רכישה לפי חודש</h2>
          <p className="mb-2 text-sm text-ink-soft">כל המוצרים יחד. לחיצה על עמודה פותחת את קבלות החודש.</p>
          {s.monthly.length === 0 ? (
            <EmptyState title="אין רכישות בתקופה" />
          ) : (
            <SeriesBarChart
              unitLabel="מופעי רכישה"
              data={s.monthly.map((m) => ({ label: monthTitle(m.month), value: m.occasions, hint: `${m.receipts} קבלות`, key: m.month }))}
              onSelect={(p) => {
                const m = p.key!;
                const [y, mo] = m.split("-").map(Number);
                const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
                navigate(`/receipts?from=${m}-01&to=${m}-${String(last).padStart(2, "0")}`);
              }}
            />
          )}
        </Card>
        <Card>
          <h2 className="mb-1 text-xl font-bold">המוצרים הנקנים ביותר</h2>
          <p className="mb-3 text-sm text-ink-soft">לפי מופעי רכישה בתקופה</p>
          {s.top.length === 0 ? (
            <EmptyState title="אין נתונים" />
          ) : (
            <ul className="space-y-2">
              {s.top.map((t) => (
                <li key={t.productId}>
                  <Link to={`/analysis/products/${t.productId}`} className="group grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3">
                    <span className="truncate font-medium text-brand-700 group-hover:underline">{t.name}</span>
                    <span className="h-3 rounded-e-full bg-brand-500" style={{ width: `${Math.max(4, (t.occasions / maxTop) * 100)}%` }} aria-hidden="true" />
                    <span className="num text-sm"><strong>{t.occasions}</strong> <span className="text-ink-soft">({t.quantity} {UNIT_LABELS[t.unit]})</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold">דפוסים חריגים לבדיקה</h2>
            <Link to="/alerts" className="text-brand-700 underline">לכל ההתראות</Link>
          </div>
          {s.unusual.length === 0 ? (
            <EmptyState title="אין התראות פתוחות בתקופה" />
          ) : (
            <ul className="divide-y divide-line">
              {s.unusual.map((a) => (
                <li key={a._id}>
                  <Link to={`/alerts?focus=${a._id}`} className="block py-3 hover:bg-page">
                    <span className="mb-1 flex flex-wrap gap-1">
                      <Chip tone="brand">{ALERT_TYPES[a.type]}</Chip>
                      <Chip tone={a.severity === "high" ? "alert" : a.severity === "medium" ? "review" : "neutral"}>{a.severity === "high" ? "גבוהה" : a.severity === "medium" ? "בינונית" : "נמוכה"}</Chip>
                      {a.status === "investigate" && <Chip tone="alert">נדרש בירור</Chip>}
                    </span>
                    <span className="font-medium">{a.reason}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-xl font-bold">קבלות אחרונות</h2>
          {s.recent.length === 0 ? (
            <EmptyState title="אין קבלות בתקופה" />
          ) : (
            <ul className="divide-y divide-line">
              {s.recent.map((r) => (
                <li key={r._id}>
                  <Link to={`/receipts/${r._id}`} className="flex flex-wrap items-center gap-x-4 py-3 hover:bg-page">
                    <span className="num w-24 font-medium">{r.purchaseDate ? formatIsoDate(r.purchaseDate) : "—"}</span>
                    <span className="flex-1">{r.storeName ?? "—"} · {r.itemCount} שורות</span>
                    <span className="num font-semibold">{formatIls(r.totalAgorot)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {s.draftCount > 0 && (
            <div className="mt-4 rounded-xl border border-review-200 bg-review-50 p-3">
              <p className="mb-2 font-semibold text-review-700">{s.draftCount} קבלות ממתינות לבדיקה (לא נספרות עדיין)</p>
              <ul className="space-y-1">
                {s.needsReview.map((r) => (
                  <li key={r._id}>
                    <Link to={`/receipts/${r._id}/review`} className="text-brand-700 underline">
                      {r.purchaseDate ? formatIsoDate(r.purchaseDate) : "ללא תאריך"} · {r.storeName ?? "—"}
                      {r.duplicate ? " · כפולה אפשרית" : ""}
                      {r.lowConfidence ? " · קריאה בוודאות נמוכה" : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
