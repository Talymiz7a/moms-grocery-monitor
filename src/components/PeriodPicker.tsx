import { HEBREW_MONTHS, formatIsoDate } from "../../convex/lib/dates";
import { parseDayFirstDate } from "../lib/format";
import { inputClass, warnInputClass } from "./ui";

export type Period = { mode: "all" | "month" | "year" | "custom"; month?: string; year?: number; fromText?: string; toText?: string };

export const monthTitle = (m: string) => `${HEBREW_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

function lastDay(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Converts a period selection into an ISO date range and a Hebrew label. */
export function periodRange(p: Period, dataFrom?: string | null, dataTo?: string | null): { from?: string; to?: string; label: string; valid: boolean } {
  if (p.mode === "month" && p.month) return { from: `${p.month}-01`, to: lastDay(p.month), label: monthTitle(p.month), valid: true };
  if (p.mode === "year" && p.year) return { from: `${p.year}-01-01`, to: `${p.year}-12-31`, label: `שנת ${p.year}`, valid: true };
  if (p.mode === "custom") {
    const from = p.fromText ? parseDayFirstDate(p.fromText) : null;
    const to = p.toText ? parseDayFirstDate(p.toText) : null;
    if (!from || !to || from > to) return { label: "טווח לא תקין", valid: false };
    return { from, to, label: `${formatIsoDate(from)} – ${formatIsoDate(to)}`, valid: true };
  }
  return {
    from: undefined,
    to: undefined,
    label: dataFrom && dataTo ? `כל התקופה (${formatIsoDate(dataFrom)} – ${formatIsoDate(dataTo)})` : "כל התקופה",
    valid: true,
  };
}

export function PeriodPicker({ value, onChange, months }: { value: Period; onChange: (p: Period) => void; months: string[] }) {
  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))];
  const modes: { key: Period["mode"]; label: string }[] = [
    { key: "all", label: "כל התקופה" },
    { key: "month", label: "חודש" },
    { key: "year", label: "שנה" },
    { key: "custom", label: "טווח" },
  ];
  const r = periodRange(value);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="inline-flex rounded-xl border border-line bg-white p-0.5" role="group" aria-label="תקופה">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={value.mode === m.key}
            onClick={() => onChange({ ...value, mode: m.key, month: value.month ?? months[0], year: value.year ?? years[0] })}
            className={`min-h-10 rounded-lg px-3 font-medium ${value.mode === m.key ? "bg-brand-500 text-white" : "text-ink"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {value.mode === "month" && (
        <select className={`${inputClass} w-auto`} value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value })} aria-label="חודש">
          {months.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
        </select>
      )}
      {value.mode === "year" && (
        <select className={`${inputClass} w-auto`} value={value.year} onChange={(e) => onChange({ ...value, year: Number(e.target.value) })} aria-label="שנה">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
      {value.mode === "custom" && (
        <>
          <input className={`${inputClass} w-36 ${value.fromText && !parseDayFirstDate(value.fromText) ? warnInputClass : ""}`} inputMode="numeric" placeholder="מ- DD/MM/YYYY" aria-label="מתאריך" value={value.fromText ?? ""} onChange={(e) => onChange({ ...value, fromText: e.target.value })} />
          <input className={`${inputClass} w-36 ${value.toText && !parseDayFirstDate(value.toText) ? warnInputClass : ""}`} inputMode="numeric" placeholder="עד DD/MM/YYYY" aria-label="עד תאריך" value={value.toText ?? ""} onChange={(e) => onChange({ ...value, toText: e.target.value })} />
          {!r.valid && (value.fromText || value.toText) && <span className="pb-2 text-sm font-medium text-review-700">הזינו טווח תקין</span>}
        </>
      )}
    </div>
  );
}
