import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button, Card, Chip, EmptyState, Field, Loading, Notice, PageHeader, inputClass, warnInputClass } from "../components/ui";
import { UNIT_LABELS, errorMessage, formatDateTime, formatIls, formatIsoDate, parseDayFirstDate } from "../lib/format";
import { useAppState } from "../state/AppState";

export const ALERT_TYPES: Record<string, string> = {
  excessive_frequency: "תדירות חריגה",
  large_quantity: "כמות חריגה",
  close_interval: "רכישות צפופות",
  new_product: "מוצר חדש",
  not_expected: "מוצר לא צפוי",
  duplicate_receipt: "קבלה כפולה",
  high_total: "סכום קבלה גבוה",
};
export const ALERT_STATUS: Record<string, { label: string; tone: "review" | "ok" | "alert" | "neutral" }> = {
  pending: { label: "ממתין לבדיקה", tone: "review" },
  explained: { label: "נבדק והוסבר", tone: "ok" },
  investigate: { label: "נדרש בירור נוסף", tone: "alert" },
};
const SEVERITY: Record<string, { label: string; tone: "alert" | "review" | "neutral" }> = {
  high: { label: "חומרה גבוהה", tone: "alert" },
  medium: { label: "חומרה בינונית", tone: "review" },
  low: { label: "חומרה נמוכה", tone: "neutral" },
};
const BASIS: Record<string, string> = { rule: "לפי כלל שהוגדר", statistical: "בהשוואה להיסטוריה", notice: "הודעה" };

const STATUS_FILTERS = [
  { key: "open", label: "פתוחות" },
  { key: "pending", label: "ממתין לבדיקה" },
  { key: "investigate", label: "נדרש בירור" },
  { key: "explained", label: "נבדק והוסבר" },
  { key: "all", label: "הכל" },
] as const;

type AlertRow = FunctionReturnType<typeof api.alerts.list>["alerts"][number];

export function Alerts() {
  const { dataset } = useAppState();
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  const status = (STATUS_FILTERS.find((f) => f.key === params.get("status"))?.key ?? (focus ? "all" : "open")) as (typeof STATUS_FILTERS)[number]["key"];
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const from = parseDayFirstDate(fromText) ?? undefined;
  const to = parseDayFirstDate(toText) ?? undefined;
  const data = useQuery(api.alerts.list, { dataset, status, type: type || undefined, severity: severity || undefined, from, to });
  const counts = useQuery(api.alerts.counts, { dataset });

  useEffect(() => {
    if (focus && data) document.getElementById(`alert-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus, data]);

  return (
    <>
      <PageHeader
        title="התראות ובקרה"
        subtitle={counts && `${counts.pending} ממתינות לבדיקה · ${counts.investigate} דורשות בירור · ${counts.explained} נבדקו והוסברו`}
      />
      <div className="mb-4">
        <Notice tone="neutral" title="התראה אינה הוכחה">
          כל התראה מסמנת דפוס שכדאי להסתכל עליו, עם הראיות וההשוואה שעליהן היא מבוססת. היא אינה מעידה על שימוש אישי, חוסר יושר או גניבה — יש הסברים לגיטימיים רבים (אירוח, מבצע, צורך עונתי).
        </Notice>
      </div>
      <Card className="mb-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="סינון לפי סטטוס">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={status === f.key}
              onClick={() => setParams(f.key === "open" ? {} : { status: f.key })}
              className={`min-h-11 rounded-xl border px-3 font-medium ${status === f.key ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-white hover:border-brand-500"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label>
            <span className="mb-1 block font-medium">סוג</span>
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">כל הסוגים</option>
              {Object.entries(ALERT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block font-medium">חומרה</span>
            <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">הכל</option>
              <option value="high">גבוהה</option>
              <option value="medium">בינונית</option>
              <option value="low">נמוכה</option>
            </select>
          </label>
          <Field label="מתאריך" warn={fromText.trim() && !from ? "DD/MM/YYYY" : undefined}>
            <input className={`${inputClass} ${fromText.trim() && !from ? warnInputClass : ""}`} inputMode="numeric" placeholder="DD/MM/YYYY" value={fromText} onChange={(e) => setFromText(e.target.value)} />
          </Field>
          <Field label="עד תאריך" warn={toText.trim() && !to ? "DD/MM/YYYY" : undefined}>
            <input className={`${inputClass} ${toText.trim() && !to ? warnInputClass : ""}`} inputMode="numeric" placeholder="DD/MM/YYYY" value={toText} onChange={(e) => setToText(e.target.value)} />
          </Field>
        </div>
      </Card>

      {data === undefined ? (
        <Loading />
      ) : data.alerts.length === 0 ? (
        <EmptyState title="אין התראות בסינון זה" />
      ) : (
        <div className="space-y-4">
          <p className="text-ink-soft">{data.total} התראות</p>
          {data.alerts.map((a) => <AlertCard key={a._id} a={a} focused={a._id === focus} />)}
        </div>
      )}
    </>
  );
}

function EvidenceDetails({ a }: { a: AlertRow }) {
  const e = a.evidence as Record<string, unknown>;
  const unit = UNIT_LABELS[(e.unit as string) ?? "unit"] ?? "";
  const rows: [string, string][] = [];
  const b = (e.baseline ?? null) as Record<string, number | string> | null;
  const r = (e.rule ?? null) as Record<string, number> | null;
  const list = (x: unknown) => (Array.isArray(x) ? x : []);
  switch (a.type) {
    case "excessive_frequency":
      rows.push(["רכישות בחודש", String(e.count)]);
      rows.push(["תאריכים", list(e.dates).map((d) => formatIsoDate(d as string)).join(", ")]);
      rows.push(["כמויות", list(e.quantities).map((q) => `${q}`).join(", ") + ` ${unit}`]);
      if (b) rows.push(["בסיס השוואה", `ממוצע ${b.meanPerMonth} בחודש ב-${b.priorMonths} חודשים קודמים (סף ${b.threshold})`]);
      if (r) rows.push(["כלל", `עד ${r.maxPerMonth} בחודש`]);
      break;
    case "large_quantity":
      rows.push(["כמות בקנייה", `${e.quantity} ${unit}${Number(e.lineCount) > 1 ? ` (${e.lineCount} שורות)` : ""}`]);
      rows.push(["תאריך וחנות", `${formatIsoDate(e.date as string)} · ${e.store ?? ""}`]);
      if (b) rows.push(["בסיס השוואה", `חציון ${b.medianQuantity} ${unit}, מקסימום קודם ${b.maxPrior}, מתוך ${b.priorOccasions} רכישות`]);
      if (r) rows.push(["כלל", `עד ${r.quantityMax} ${unit} בקנייה`]);
      break;
    case "close_interval":
      rows.push(["מרווח", `${e.days} ימים`]);
      rows.push(["רכישות", `${formatIsoDate(e.previousDate as string)} (${e.previousQuantity} ${unit}) ← ${formatIsoDate(e.date as string)} (${e.quantity} ${unit})`]);
      rows.push(["חנויות", list(e.stores).join(" ← ")]);
      if (b) rows.push(["בסיס השוואה", `חציון ${b.medianIntervalDays} ימים בין ${b.priorIntervals} רכישות קודמות`]);
      if (r) rows.push(["כלל", `לפחות ${r.minIntervalDays} ימים בין רכישות`]);
      break;
    case "new_product":
      rows.push(["רכישה ראשונה", `${formatIsoDate(e.firstDate as string)} · ${e.quantity} ${unit} · ${e.store ?? ""}`]);
      rows.push(["רכישות מאז", String(e.laterOccasions)]);
      break;
    case "not_expected":
      rows.push(["תאריכים", list(e.dates).map((d) => formatIsoDate(d as string)).join(", ")]);
      rows.push(["כמויות", list(e.quantities).join(", ") + ` ${unit}`]);
      rows.push(["חנויות", [...new Set(list(e.stores))].join(", ")]);
      break;
    case "duplicate_receipt": {
      const rc = e.receipt as Record<string, unknown> | null;
      const og = e.original as Record<string, unknown> | null;
      if (rc) rows.push(["הקבלה", `${rc.date ? formatIsoDate(rc.date as string) : "ללא תאריך"} · ${rc.store ?? ""} · ${formatIls(rc.totalAgorot as number)} · ${rc.itemCount} שורות`]);
      if (og) rows.push(["הקבלה הקיימת", `${og.date ? formatIsoDate(og.date as string) : "ללא תאריך"} · ${og.store ?? ""} · ${formatIls(og.totalAgorot as number)} · ${og.itemCount} שורות`]);
      break;
    }
    case "high_total":
      rows.push(["סכום", formatIls(e.totalAgorot as number)]);
      rows.push(["שורות בקבלה", String(e.itemCount)]);
      if (b) {
        rows.push(["בסיס השוואה", `${b.scope}: חציון ${formatIls(b.medianTotalAgorot as number)} מתוך ${b.priorReceipts} קבלות (סף ${formatIls(b.thresholdAgorot as number)})`]);
        rows.push(["גודל סל רגיל", `${b.medianItemCount} שורות (90% עד ${b.p90ItemCount})`]);
        rows.push(["ממוצע לשורה", `${formatIls(b.perItemAgorot as number)} לעומת ${formatIls(b.medianPerItemAgorot as number)} בדרך כלל`]);
      }
      break;
  }
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-soft">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function AlertCard({ a, focused }: { a: AlertRow; focused: boolean }) {
  const { isEditor, editorCode } = useAppState();
  const review = useMutation(api.alerts.review);
  const [notes, setNotes] = useState(a.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = ALERT_STATUS[a.status];
  const explanation = (a.evidence as { explanation?: string }).explanation;

  async function setStatus(status: "pending" | "explained" | "investigate") {
    if (!editorCode) return;
    setBusy(true);
    setError(null);
    try {
      await review({ editorCode, alertId: a._id as Id<"alerts">, status, notes });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article id={`alert-${a._id}`} className={`rounded-2xl border bg-white p-5 shadow-sm ${focused ? "border-brand-500 ring-4 ring-brand-100" : a.status === "explained" ? "border-line opacity-90" : "border-line"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Chip tone="brand" icon="bell">{ALERT_TYPES[a.type]}</Chip>
        <Chip tone={st.tone}>{st.label}</Chip>
        <Chip tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Chip>
        <Chip>{BASIS[a.basis]}</Chip>
        {a.limitedEvidence && <Chip tone="review">ראיות מוגבלות — מעט היסטוריה</Chip>}
        {a.inactive && <Chip>הראיות כבר לא קיימות</Chip>}
        {a.reopenedAt && a.status === "pending" && <Chip tone="review">נפתח מחדש</Chip>}
      </div>
      <h3 className="text-lg font-bold">{a.reason}</h3>
      {explanation && <p className="mt-1 text-ink-soft">{explanation}</p>}
      <div className="mt-3 rounded-xl bg-page p-3">
        <EvidenceDetails a={a} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a.productId && (
          <Link to={`/analysis/products/${a.productId}`} className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-medium text-brand-700 hover:border-brand-500">
            היסטוריית {a.productName}
          </Link>
        )}
        {a.receipts.map((r) =>
          "missing" in r ? (
            <span key={r._id} className="text-sm text-ink-soft">קבלה שנמחקה</span>
          ) : (
            <Link key={r._id} to={`/receipts/${r._id}`} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-line px-3 text-sm font-medium text-brand-700 hover:border-brand-500">
              קבלה <span className="num">{r.purchaseDate ? formatIsoDate(r.purchaseDate) : "ללא תאריך"}</span> · {r.storeName ?? ""} · <span className="num">{formatIls(r.totalAgorot)}</span>
            </Link>
          ),
        )}
      </div>

      <div className="mt-4 border-t border-line pt-4">
        {isEditor ? (
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block font-medium">הערות הבודק/ת</span>
              <textarea className={`${inputClass} min-h-20`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="למשל: אירוח משפחתי בחג; אושר מול המטפלת" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant={a.status === "explained" ? "primary" : "secondary"} icon="check" disabled={busy} onClick={() => setStatus("explained")}>נבדק והוסבר</Button>
              <Button variant={a.status === "investigate" ? "primary" : "secondary"} disabled={busy} onClick={() => setStatus("investigate")}>נדרש בירור נוסף</Button>
              {a.status !== "pending" && <Button variant="ghost" disabled={busy} onClick={() => setStatus("pending")}>החזרה ל"ממתין"</Button>}
            </div>
            {error && <p className="font-medium text-alert-600" role="alert">{error}</p>}
          </div>
        ) : (
          a.notes && <p><span className="font-medium">הערות: </span>{a.notes}</p>
        )}
        {a.reviewHistory.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-brand-700">היסטוריית בדיקה ({a.reviewHistory.length})</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {a.reviewHistory.map((h, i) => (
                <li key={i}>
                  <span className="num text-ink-soft">{formatDateTime(h.at)}</span> · {h.actor} · {ALERT_STATUS[h.status].label}
                  {h.notes && <> — {h.notes}</>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}
