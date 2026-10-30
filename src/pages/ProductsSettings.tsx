import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { normalizeText } from "../../convex/lib/normalize";
import { Button, Card, Chip, Field, Loading, Notice, PageHeader, inputClass } from "../components/ui";
import { UNIT_LABELS, errorMessage, formatDateTime } from "../lib/format";
import { useAppState } from "../state/AppState";

type Product = FunctionReturnType<typeof api.products.listWithExpectations>[number];
type Unit = Product["unit"];

export const EXPECTED_USE_LABELS: Record<string, string> = {
  expected: "צפוי",
  occasional: "מזדמן",
  not_expected: "לא צפוי בדרך כלל",
  manual_review: "לבדיקה ידנית",
};

function numOrUndef(s: string): number | undefined {
  const t = s.trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function ProductsSettings() {
  const { isEditor, readArgs } = useAppState();
  const products = useQuery(api.products.listWithExpectations, { ...readArgs });
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = normalizeText(filter);
    return (products ?? []).filter((p) => !q || [p.canonicalName, ...p.aliases, p.category ?? ""].some((n) => normalizeText(n).includes(q)));
  }, [products, filter]);

  if (products === undefined) return <Loading />;
  return (
    <>
      <PageHeader
        title="מוצרים ורשימת קניות צפויה"
        subtitle="ציפיות ידניות (נפרדות מההיסטוריה שנלמדת אוטומטית), סיווג צפוי/לא צפוי, איחוד ופיצול מוצרים"
        actions={<Link className="inline-flex min-h-11 items-center font-medium text-brand-700 underline" to="/settings">להגדרות</Link>}
      />
      {!isEditor && (
        <div className="mb-4">
          <Notice tone="brand" icon="lock" title="צפייה בלבד">שינוי ציפיות ומוצרים זמין במצב עריכה.</Notice>
        </div>
      )}
      <div className="mb-4 max-w-md">
        <input className={inputClass} placeholder="סינון מוצרים…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="סינון מוצרים" />
      </div>
      <div className="space-y-3">
        {shown.map((p) => (
          <Card key={p._id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/analysis/products/${p._id}`} className="text-lg font-bold text-brand-700 underline">{p.canonicalName}</Link>
              {p.category && <Chip>{p.category}</Chip>}
              <Chip tone={p.expectedUse === "expected" ? "ok" : p.expectedUse === "occasional" ? "neutral" : "review"}>{EXPECTED_USE_LABELS[p.expectedUse]}</Chip>
              <button type="button" className="ms-auto inline-flex min-h-10 items-center rounded-lg border border-line px-3 font-medium text-brand-700 hover:border-brand-500" aria-expanded={openId === p._id} onClick={() => setOpenId(openId === p._id ? null : p._id)}>
                {openId === p._id ? "סגירה" : isEditor ? "עריכה" : "פרטים"}
              </button>
            </div>
            <p className="mt-1 text-sm text-ink-soft">{expectationSummary(p) || "אין ציפייה ידנית — ההשוואה נעשית רק מול ההיסטוריה"}</p>
            {openId === p._id && <ProductEditor p={p} all={products} onDone={() => setOpenId(null)} />}
          </Card>
        ))}
      </div>
    </>
  );
}

function expectationSummary(p: Product): string {
  const e = p.expectation;
  if (!e) return "";
  const u = UNIT_LABELS[e.usualUnit ?? p.unit];
  return [
    e.usualQuantity && `כמות רגילה ${e.usualQuantity} ${u}`,
    e.expectedIntervalDays && `כל ${e.expectedIntervalDays} ימים`,
    e.maxPerMonth && `עד ${e.maxPerMonth} בחודש`,
    e.minIntervalDays && `מרווח מינימלי ${e.minIntervalDays} ימים`,
    (e.quantityMin || e.quantityMax) && `טווח כמות ${e.quantityMin ?? 0}–${e.quantityMax ?? "∞"}`,
    e.notes,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ProductEditor({ p, all, onDone }: { p: Product; all: Product[]; onDone: () => void }) {
  const { isEditor, editorCode } = useAppState();
  const updateProduct = useMutation(api.products.updateProduct);
  const setExpectation = useMutation(api.products.setExpectation);
  const merge = useMutation(api.products.merge);
  const splitAlias = useMutation(api.products.splitAlias);
  const e = p.expectation;
  const [f, setF] = useState({
    canonicalName: p.canonicalName,
    category: p.category ?? "",
    unit: p.unit,
    packageSize: p.packageSize ? String(p.packageSize) : "",
    packageUnit: (p.packageUnit ?? "unit") as Unit,
    expectedUse: p.expectedUse,
    notes: p.notes ?? "",
  });
  const [x, setX] = useState({
    usualQuantity: e?.usualQuantity ? String(e.usualQuantity) : "",
    expectedIntervalDays: e?.expectedIntervalDays ? String(e.expectedIntervalDays) : "",
    maxPerMonth: e?.maxPerMonth ? String(e.maxPerMonth) : "",
    minIntervalDays: e?.minIntervalDays ? String(e.minIntervalDays) : "",
    quantityMin: e?.quantityMin ? String(e.quantityMin) : "",
    quantityMax: e?.quantityMax ? String(e.quantityMax) : "",
    notes: e?.notes ?? "",
  });
  const [mergeTarget, setMergeTarget] = useState("");
  const mergeCheck = useQuery(api.products.mergeCheck, mergeTarget ? { sourceId: p._id, targetId: mergeTarget as Id<"products">, editorCode: editorCode ?? undefined } : "skip");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ro = !isEditor;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  }

  const exp = {
    usualQuantity: numOrUndef(x.usualQuantity),
    usualUnit: p.unit,
    expectedIntervalDays: numOrUndef(x.expectedIntervalDays),
    maxPerMonth: numOrUndef(x.maxPerMonth),
    minIntervalDays: numOrUndef(x.minIntervalDays),
    quantityMin: numOrUndef(x.quantityMin),
    quantityMax: numOrUndef(x.quantityMax),
    notes: x.notes.trim() || undefined,
  };
  const expInvalid = Object.values(exp).some((v) => typeof v === "number" && Number.isNaN(v));

  return (
    <div className="mt-4 space-y-5 border-t border-line pt-4">
      <fieldset disabled={ro} className="space-y-3">
        <legend className="mb-2 font-bold">פרטי המוצר</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="שם המוצר"><input className={inputClass} value={f.canonicalName} onChange={(ev) => setF({ ...f, canonicalName: ev.target.value })} /></Field>
          <Field label="קטגוריה"><input className={inputClass} value={f.category} onChange={(ev) => setF({ ...f, category: ev.target.value })} /></Field>
          <Field label="סיווג">
            <select className={inputClass} value={f.expectedUse} onChange={(ev) => setF({ ...f, expectedUse: ev.target.value as Product["expectedUse"] })}>
              {Object.entries(EXPECTED_USE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="יחידת מדידה">
            <select className={inputClass} value={f.unit} onChange={(ev) => setF({ ...f, unit: ev.target.value as Unit })}>
              {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="גודל אריזה (להשוואת מחירים)" hint='למשל 250 גרם, 1 ליטר'>
            <div className="flex gap-2">
              <input className={`${inputClass} num text-end`} inputMode="decimal" value={f.packageSize} onChange={(ev) => setF({ ...f, packageSize: ev.target.value })} />
              <select className={inputClass} value={f.packageUnit} onChange={(ev) => setF({ ...f, packageUnit: ev.target.value as Unit })}>
                {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </Field>
          <Field label="הערות"><input className={inputClass} value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} /></Field>
        </div>
        {isEditor && (
          <Button
            variant="secondary"
            onClick={() =>
              run(
                () =>
                  updateProduct({
                    editorCode: editorCode!,
                    productId: p._id,
                    canonicalName: f.canonicalName,
                    category: f.category || undefined,
                    unit: f.unit,
                    packageSize: numOrUndef(f.packageSize),
                    packageUnit: f.packageUnit,
                    expectedUse: f.expectedUse,
                    notes: f.notes || undefined,
                  }),
                "פרטי המוצר נשמרו",
              )
            }
          >
            שמירת פרטי המוצר
          </Button>
        )}
      </fieldset>

      <fieldset disabled={ro} className="space-y-3">
        <legend className="mb-2 font-bold">ציפייה ידנית (רשימת קניות צפויה)</legend>
        <p className="text-sm text-ink-soft">כל השדות רשות. כללים שמוגדרים כאן יוצרים התראות "לפי כלל שהוגדר", בנפרד מההשוואה להיסטוריה. יחידה: {UNIT_LABELS[p.unit]}.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="כמות רגילה בקנייה"><input className={`${inputClass} num text-end`} inputMode="decimal" value={x.usualQuantity} onChange={(ev) => setX({ ...x, usualQuantity: ev.target.value })} /></Field>
          <Field label="מרווח צפוי (ימים)"><input className={`${inputClass} num text-end`} inputMode="numeric" value={x.expectedIntervalDays} onChange={(ev) => setX({ ...x, expectedIntervalDays: ev.target.value })} /></Field>
          <Field label="מקסימום רכישות בחודש"><input className={`${inputClass} num text-end`} inputMode="numeric" value={x.maxPerMonth} onChange={(ev) => setX({ ...x, maxPerMonth: ev.target.value })} /></Field>
          <Field label="מרווח מינימלי (ימים)"><input className={`${inputClass} num text-end`} inputMode="numeric" value={x.minIntervalDays} onChange={(ev) => setX({ ...x, minIntervalDays: ev.target.value })} /></Field>
          <Field label="כמות מינימלית בקנייה"><input className={`${inputClass} num text-end`} inputMode="decimal" value={x.quantityMin} onChange={(ev) => setX({ ...x, quantityMin: ev.target.value })} /></Field>
          <Field label="כמות מקסימלית בקנייה"><input className={`${inputClass} num text-end`} inputMode="decimal" value={x.quantityMax} onChange={(ev) => setX({ ...x, quantityMax: ev.target.value })} /></Field>
        </div>
        <Field label="הערה (למשל: 2 ליטר בשבוע)"><input className={inputClass} value={x.notes} onChange={(ev) => setX({ ...x, notes: ev.target.value })} /></Field>
        {e?.updatedAt && <p className="text-sm text-ink-soft">עודכן לאחרונה: {formatDateTime(e.updatedAt)} · {e.updatedBy}</p>}
        {isEditor && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={expInvalid} onClick={() => run(() => setExpectation({ editorCode: editorCode!, productId: p._id, expectation: exp as never }), "הציפייה נשמרה — ההתראות מחושבות מחדש")}>
              שמירת הציפייה
            </Button>
            {e && <Button variant="ghost" onClick={() => run(() => setExpectation({ editorCode: editorCode!, productId: p._id, expectation: null }), "הציפייה הוסרה")}>הסרת הציפייה</Button>}
          </div>
        )}
      </fieldset>

      {isEditor && (
        <fieldset className="space-y-3">
          <legend className="mb-2 font-bold">איחוד ופיצול</legend>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl bg-page p-3">
              <p className="mb-2 font-medium">איחוד מוצר זה לתוך מוצר אחר</p>
              <select className={inputClass} value={mergeTarget} onChange={(ev) => setMergeTarget(ev.target.value)}>
                <option value="">בחירת מוצר יעד…</option>
                {all.filter((o) => o._id !== p._id).map((o) => <option key={o._id} value={o._id}>{o.canonicalName}</option>)}
              </select>
              {mergeCheck?.conflict && <p className="mt-2 text-sm font-medium text-review-700">⚠ הגודל או האחוז בשמות שונים — ייתכן שאלה מוצרים שונים.</p>}
              {mergeCheck?.unitDiffers && <p className="mt-1 text-sm font-medium text-review-700">⚠ יחידות המדידה שונות — כמויות לא יחוברו ללא המרה אמינה.</p>}
              <Button
                variant="danger"
                className="mt-2"
                disabled={!mergeTarget}
                onClick={() => {
                  if (!window.confirm("לאחד? כל השורות והניסוחים יעברו למוצר היעד. הפעולה נרשמת בהיסטוריה וניתן לפצל ניסוחים בחזרה.")) return;
                  void run(async () => {
                    await merge({ editorCode: editorCode!, sourceId: p._id, targetId: mergeTarget as Id<"products"> });
                    onDone();
                  }, "המוצרים אוחדו");
                }}
              >
                איחוד
              </Button>
            </div>
            <div className="rounded-xl bg-page p-3">
              <p className="mb-2 font-medium">ניסוחים מהקבלות</p>
              <ul className="space-y-2">
                {p.aliases.map((a) => (
                  <li key={a} className="flex flex-wrap items-center gap-2">
                    <Chip>{a}</Chip>
                    {normalizeText(a) !== normalizeText(p.canonicalName) && (
                      <button
                        type="button"
                        className="min-h-9 text-sm text-brand-700 underline"
                        onClick={() => {
                          const name = window.prompt("שם למוצר החדש שיפוצל מניסוח זה:", a);
                          if (name) void run(() => splitAlias({ editorCode: editorCode!, productId: p._id, alias: a, newName: name }), "הניסוח פוצל למוצר חדש");
                        }}
                      >
                        פיצול למוצר נפרד
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </fieldset>
      )}
      {msg && <p className={`font-medium ${msg.ok ? "text-ok-700" : "text-alert-600"}`} role="status">{msg.text}</p>}
    </div>
  );
}
