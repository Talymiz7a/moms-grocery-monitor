import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_INK, SERIES_COLOR } from "../../lib/chartColors";

export type Point = { label: string; value: number | null; hint?: string; key?: string };

function SimpleTooltip({ active, payload, unitLabel }: { active?: boolean; payload?: readonly { payload: Point }[]; unitLabel: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div dir="rtl" className="rounded-xl border border-line bg-white p-3 text-sm shadow-lg">
      <p className="font-bold">{p.label}</p>
      <p>
        <span className="num font-semibold">{p.value === null ? "—" : p.value.toLocaleString("he-IL", { maximumFractionDigits: 2 })}</span> {unitLabel}
      </p>
      {p.hint && <p className="text-ink-soft">{p.hint}</p>}
    </div>
  );
}

/** One measure over time (months). Bars anchored to zero; one axis. */
export function SeriesBarChart({
  data,
  unitLabel,
  height = 260,
  onSelect,
  allowDecimals = false,
}: {
  data: Point[];
  unitLabel: string;
  height?: number;
  onSelect?: (p: Point) => void;
  allowDecimals?: boolean;
}) {
  return (
    <div className="overflow-x-auto" dir="rtl">
      <div style={{ minWidth: Math.max(data.length * 56, 300), height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
            <XAxis dataKey="label" reversed interval={0} tick={{ fill: CHART_INK.primary, fontSize: 13 }} tickLine={false} axisLine={{ stroke: CHART_INK.axis }} />
            <YAxis orientation="right" allowDecimals={allowDecimals} tick={{ fill: CHART_INK.secondary, fontSize: 13 }} tickLine={false} axisLine={false} width={44} />
            <Tooltip cursor={{ fill: "rgba(58,134,255,0.06)" }} content={(p) => <SimpleTooltip active={p.active} payload={p.payload as never} unitLabel={unitLabel} />} />
            <Bar
              dataKey="value"
              fill={SERIES_COLOR}
              radius={[4, 4, 0, 0]}
              maxBarSize={44}
              isAnimationActive={false}
              onClick={(d) => onSelect?.((d as unknown as { payload: Point }).payload)}
              style={{ cursor: onSelect ? "pointer" : undefined }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** A value over time (e.g. price). Gaps where there is no value. */
export function SeriesLineChart({ data, unitLabel, height = 240 }: { data: Point[]; unitLabel: string; height?: number }) {
  return (
    <div className="overflow-x-auto" dir="rtl">
      <div style={{ minWidth: Math.max(data.length * 44, 300), height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
            <XAxis dataKey="label" reversed tick={{ fill: CHART_INK.primary, fontSize: 12 }} tickLine={false} axisLine={{ stroke: CHART_INK.axis }} />
            <YAxis orientation="right" tick={{ fill: CHART_INK.secondary, fontSize: 13 }} tickLine={false} axisLine={false} width={52} domain={["auto", "auto"]} />
            <Tooltip content={(p) => <SimpleTooltip active={p.active} payload={p.payload as never} unitLabel={unitLabel} />} />
            <Line type="monotone" dataKey="value" stroke={SERIES_COLOR} strokeWidth={2} dot={{ r: 4, fill: SERIES_COLOR, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
