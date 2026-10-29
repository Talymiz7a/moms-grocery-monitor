import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HEBREW_MONTHS } from "../../../convex/lib/dates";
import { CHART_INK, MONTH_COLORS } from "../../lib/chartColors";
import { UNIT_LABELS } from "../../lib/format";

export type GridRow = {
  productId: string;
  name: string;
  unit: string;
  occasions: number[];
  quantity: number[];
};

const GROUP_WIDTH = 132;

/** Wraps long Hebrew product names onto up to three lines under the axis. */
function ProductTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const words = (payload?.value ?? "").split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= 14) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  return (
    <text x={x} y={(y ?? 0) + 14} textAnchor="middle" fill={CHART_INK.primary} fontSize={13} direction="rtl">
      {lines.slice(0, 3).map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 15}>{l}</tspan>
      ))}
    </text>
  );
}

function MonthTooltip({ active, payload, rows, year }: { active?: boolean; payload?: readonly { payload: unknown }[]; rows: GridRow[]; year: number }) {
  if (!active || !payload?.length) return null;
  const productId = (payload[0].payload as { productId: string }).productId;
  const row = rows.find((r) => r.productId === productId);
  if (!row) return null;
  const nonZero = row.occasions.map((n, i) => ({ n, i })).filter((m) => m.n > 0);
  return (
    <div dir="rtl" className="min-w-52 rounded-xl border border-line bg-white p-3 text-sm shadow-lg">
      <p className="mb-1 font-bold">{row.name}</p>
      <p className="mb-2 text-ink-soft">מופעי רכישה ב-{year} (קבלות שונות)</p>
      <ul className="space-y-0.5">
        {nonZero.map(({ n, i }) => (
          <li key={i} className="flex items-center gap-2">
            <span className="inline-block size-3 rounded-sm" style={{ background: MONTH_COLORS[i] }} />
            <span className="w-16">{HEBREW_MONTHS[i]}</span>
            <span className="num font-semibold">{n}</span>
            <span className="num text-ink-soft">
              ({row.quantity[i].toLocaleString("he-IL", { maximumFractionDigits: 2 })} {UNIT_LABELS[row.unit]})
            </span>
          </li>
        ))}
        {nonZero.length < 12 && <li className="text-ink-soft">שאר החודשים: 0</li>}
      </ul>
    </div>
  );
}

export function MonthLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-soft" aria-label="מקרא חודשים">
      {HEBREW_MONTHS.map((m, i) => (
        <li key={m} className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm" style={{ background: MONTH_COLORS[i] }} />
          {m}
        </li>
      ))}
    </ul>
  );
}

export function GroupedMonthChart({ rows, year, onSelect }: { rows: GridRow[]; year: number; onSelect?: (productId: string) => void }) {
  const data = rows.map((r) => {
    const o: Record<string, string | number> = { name: r.name, productId: r.productId };
    r.occasions.forEach((n, i) => (o[`m${i}`] = n));
    return o;
  });
  const max = Math.max(1, ...rows.flatMap((r) => r.occasions));
  return (
    <div className="overflow-x-auto" dir="rtl">
      <div style={{ minWidth: Math.max(rows.length * GROUP_WIDTH + 60, 320), height: 420 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap={18} margin={{ top: 10, right: 8, left: 8, bottom: 40 }}>
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
            <XAxis dataKey="name" reversed interval={0} tick={<ProductTick />} tickLine={false} axisLine={{ stroke: CHART_INK.axis }} height={60} />
            <YAxis
              orientation="right"
              allowDecimals={false}
              domain={[0, max]}
              tick={{ fill: CHART_INK.secondary, fontSize: 13 }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              cursor={{ fill: "rgba(58,134,255,0.06)" }}
              content={(p) => <MonthTooltip active={p.active} payload={p.payload as never} rows={rows} year={year} />}
              wrapperStyle={{ outline: "none", zIndex: 5 }}
            />
            {MONTH_COLORS.map((c, i) => (
              <Bar
                key={i}
                dataKey={`m${i}`}
                name={HEBREW_MONTHS[i]}
                fill={c}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
                onClick={(d) => onSelect?.((d as unknown as { productId: string }).productId)}
                style={{ cursor: onSelect ? "pointer" : undefined }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
