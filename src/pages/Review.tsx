import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { suggestMatches, type MatchSuggestion } from "../../convex/lib/normalize";
import { reconcile, type Reconciliation } from "../../convex/lib/reconcile";
import { ReceiptFileViewer } from "../components/ReceiptFile";
import { Button, Card, Chip, Field, Loading, Notice, PageHeader, inputClass, warnInputClass } from "../components/ui";
import {
  CONFIDENCE_LABELS,
  FIELD_LABELS,
  LINE_TYPE_LABELS,
  UNIT_LABELS,
  errorMessage,
  formatIls,
  formatIsoDate,
  fromAgorot,
  parseDayFirstDate,
  parseShekelInput,
} from "../lib/format";
import { useAppState } from "../state/AppState";
import { readReceiptFree, toSaveArgs, type OcrProgress } from "../lib/freeOcr";
import { parseAmount } from "../../convex/lib/ocrMerge";
import { OcrProgressBar } from "./Upload";

type Unit = Doc<"receiptItems">["unit"];
type LineType = Doc<"receiptItems">["lineType"];
type ProductChoice =
  | { kind: "existing"; productId: Id<"products"> }
  | { kind: "new"; canonicalName: string; unit: Unit }
  | { kind: "none" };

type EditLine = {
  key: string;
  originalDescription: string;
  lineType: LineType;
  quantityText: string;
  unit: Unit;
  unitPriceText: string;
  lineTotalText: string;
  discountText: string;
  confidence: "high" | "medium" | "low";
  lowConfidenceFields: string[];
  corrected: boolean;
  fromOcr: boolean;
  product: ProductChoice;
};

type HeaderState = {
  storeName: string;
  dateText: string;
  receiptNumber: string;
  totalText: string;
  shopper: string;
  notes: string;
};

const money = (agorot: number | undefined | null) => (agorot == null ? "" : fromAgorot(agorot).toFixed(2));
let keySeq = 0;
const newKey = () => `l${++keySeq}`;

function parseQuantity(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

type ParsedLine = {
  quantity: number | null;
  unitPriceAgorot: number | null | undefined;
  lineTotalAgorot: number | null;
  discountAgorot: number | null | undefined;
};

function parseLine(l: EditLine): ParsedLine {
  return {
    quantity: parseQuantity(l.quantityText),
    unitPriceAgorot: l.unitPriceText.trim() === "" ? undefined : parseShekelInput(l.unitPriceText),
    lineTotalAgorot: parseShekelInput(l.lineTotalText),
    discountAgorot: l.discountText.trim() === "" ? undefined : parseShekelInput(l.discountText),
  };
}

export function Review() {
  const { id } = useParams();
  const receiptId = id as Id<"receipts">;
  const navigate = useNavigate();
  const { isEditor, editorCode, readArgs } = useAppState();
  const data = useQuery(api.receipts.get, { receiptId, editorCode: editorCode ?? undefined });
  const products = useQuery(api.products.list, { ...readArgs });
  const status = useQuery(api.app.status, {});
  const saveReview = useMutation(api.receipts.saveReview);
  const setOverride = useMutation(api.receipts.setDuplicateOverride);
  const removeReceipt = useMutation(api.receipts.remove);
  const runOcr = useAction(api.ocr.extract);
  const saveFreeOcr = useMutation(api.freeOcr.saveResult);
  const getFileLink = useMutation(api.files.getFileLink);
  const [params] = useSearchParams();
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);

  const [header, setHeader] = useState<HeaderState | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [initKey, setInitKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Load the stored values into the form. Reloads after OCR finishes, unless
  // the person has already started editing.
  useEffect(() => {
    if (!data) return;
    const r = data.receipt;
    const k = `${r._id}:${r.ocrStatus}:${data.items.length}:${r.updatedAt}`;
    if (k === initKey || (dirty && initKey?.startsWith(r._id))) return;
    setHeader({
      storeName: r.storeName ?? "",
      dateText: r.purchaseDate ? formatIsoDate(r.purchaseDate) : "",
      receiptNumber: r.receiptNumber ?? "",
      totalText: money(r.totalAgorot),
      shopper: r.shopper ?? "",
      notes: r.notes ?? "",
    });
    setLines(
      data.items.map((it) => ({
        key: newKey(),
        originalDescription: it.originalDescription,
        lineType: it.lineType,
        quantityText: String(it.quantity),
        unit: it.unit,
        unitPriceText: money(it.unitPriceAgorot),
        lineTotalText: money(it.lineTotalAgorot),
        discountText: money(it.discountAgorot),
        confidence: it.confidence,
        lowConfidenceFields: it.lowConfidenceFields,
        corrected: it.corrected,
        fromOcr: r.ocrStatus === "done" && !it.corrected,
        product: it.productId ? { kind: "existing", productId: it.productId } : { kind: "none" },
      })),
    );
    setInitKey(k);
    setDirty(false);
  }, [data, initKey, dirty]);

  const candidates = useMemo(
    () => (products ?? []).map((p) => ({ id: p._id as string, canonicalName: p.canonicalName, aliases: p.aliases })),
    [products],
  );
  const productName = useMemo(() => new Map((products ?? []).map((p) => [p._id as string, p.canonicalName])), [products]);

  const parsed = lines.map(parseLine);
  const headerDate = header?.dateText.trim() ? parseDayFirstDate(header.dateText) : null;
  const headerTotal = header?.totalText.trim() ? parseShekelInput(header.totalText) : null;
  const rec = reconcile(
    lines.map((l, i) => ({
      lineType: l.lineType,
      quantity: parsed[i].quantity ?? 0,
      unitPriceAgorot: parsed[i].unitPriceAgorot ?? undefined,
      lineTotalAgorot: parsed[i].lineTotalAgorot ?? 0,
      discountAgorot: parsed[i].discountAgorot ?? undefined,
    })),
    headerTotal,
  );

  if (data === undefined || products === undefined || header === null) return <Loading />;
  if (data === null) return <Notice tone="alert" title="הקבלה לא נמצאה" />;
  const r = data.receipt;
  const readOnly = !isEditor;
  const verified = r.verificationStatus === "verified";
  const headerLow = new Set(r.headerLowConfidence ?? []);

  const validation: string[] = [];
  if (header.dateText.trim() && !headerDate) validation.push("תאריך הקנייה אינו תקין (DD/MM/YYYY)");
  if (header.totalText.trim() && headerTotal === null) validation.push("הסכום הכולל אינו תקין");
  lines.forEach((l, i) => {
    const p = parsed[i];
    if (!l.originalDescription.trim()) validation.push(`שורה ${i + 1}: חסר תיאור`);
    if (p.quantity === null) validation.push(`שורה ${i + 1}: כמות לא תקינה`);
    if (p.lineTotalAgorot === null) validation.push(`שורה ${i + 1}: סכום שורה לא תקין`);
    if (p.unitPriceAgorot === null) validation.push(`שורה ${i + 1}: מחיר ליחידה לא תקין`);
    if (p.discountAgorot === null || (p.discountAgorot ?? 0) < 0) validation.push(`שורה ${i + 1}: הנחה לא תקינה`);
    if (l.product.kind === "new" && !l.product.canonicalName.trim()) validation.push(`שורה ${i + 1}: חסר שם למוצר החדש`);
  });
  const unmatched = lines.filter((l) => l.lineType !== "discount" && l.product.kind === "none").length;

  function updateHeader(patch: Partial<HeaderState>) {
    setHeader((h) => (h ? { ...h, ...patch } : h));
    setDirty(true);
  }
  function updateLine(key: string, patch: Partial<EditLine>, valueEdit = true) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch, corrected: l.corrected || (valueEdit && l.fromOcr) } : l)));
    setDirty(true);
  }
  function addLine() {
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        originalDescription: "",
        lineType: "item",
        quantityText: "1",
        unit: "unit",
        unitPriceText: "",
        lineTotalText: "",
        discountText: "",
        confidence: "high",
        lowConfidenceFields: [],
        corrected: false,
        fromOcr: false,
        product: { kind: "none" },
      },
    ]);
    setDirty(true);
  }

  async function save(finalize: boolean) {
    if (!editorCode || !header) return;
    setError(null);
    setMessage(null);
    setBusy(finalize ? "finalize" : "draft");
    try {
      const res = await saveReview({
        editorCode,
        receiptId,
        finalize,
        header: {
          storeName: header.storeName.trim() || undefined,
          purchaseDate: headerDate ?? undefined,
          receiptNumber: header.receiptNumber.trim() || undefined,
          totalAgorot: headerTotal ?? undefined,
          shopper: header.shopper.trim() || undefined,
          notes: header.notes.trim() || undefined,
        },
        lines: lines.map((l, i) => ({
          originalDescription: l.originalDescription.trim(),
          lineType: l.lineType,
          quantity: parsed[i].quantity!,
          unit: l.unit,
          unitPriceAgorot: parsed[i].unitPriceAgorot ?? undefined,
          lineTotalAgorot: parsed[i].lineTotalAgorot!,
          discountAgorot: parsed[i].discountAgorot ?? undefined,
          confidence: l.confidence,
          lowConfidenceFields: l.lowConfidenceFields,
          corrected: l.corrected,
          product: l.lineType === "discount" ? { kind: "none" as const } : l.product,
        })),
      });
      setDirty(false);
      setInitKey(null);
      if (finalize) navigate(`/receipts/${receiptId}`);
      else setMessage(res.duplicate ? `נשמר כטיוטה. ${res.duplicate.reason}.` : "נשמר כטיוטה.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function readAutomatically() {
    if (!editorCode) return;
    setError(null);
    setBusy("ocr");
    try {
      setDirty(false);
      await runOcr({ editorCode, receiptId });
      setInitKey(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function overrideDuplicate(notDuplicate: boolean) {
    if (!editorCode) return;
    try {
      await setOverride({ editorCode, receiptId, notDuplicate });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function deleteReceipt() {
    if (!editorCode) return;
    if (!window.confirm("למחוק את הקבלה ואת כל השורות שלה? המחיקה נרשמת בהיסטוריה.")) return;
    try {
      await removeReceipt({ editorCode, receiptId });
      navigate("/receipts");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const canOcr = isEditor && !!status?.ocrEnabled && !!r.fileId && !verified;
  const canFreeOcr = isEditor && !!r.fileId && !verified && (r.fileType ?? "").startsWith("image/");

  async function readFree() {
    if (!editorCode) return;
    setError(null);
    setMessage(null);
    setBusy("free-ocr");
    try {
      const link = await getFileLink({ receiptId, editorCode });
      if (!link) throw new Error("no file");
      const res = await fetch(link.url);
      if (!res.ok) throw new Error(`file ${res.status}`);
      const { parsed, durationMs } = await readReceiptFree(await res.blob(), setOcrProgress);
      setDirty(false);
      await saveFreeOcr({ editorCode, receiptId, ...toSaveArgs(parsed, durationMs) });
      setInitKey(null);
      setMessage(`הקבלה נקראה תוך ${Math.round(durationMs / 1000)} שניות: ${parsed.lines.length} שורות. בדקו כל שורה מול התמונה.`);
    } catch (e) {
      console.error(e);
      setError("הקריאה החינמית נכשלה. אפשר לנסות שוב או להזין ידנית.");
    } finally {
      setBusy(null);
      setOcrProgress(null);
    }
  }

  function addUnrecognized(raw: string) {
    // Amounts in the text become the line total; the rest is the description.
    const tokens = raw.split(/\s+/);
    const amounts = tokens.map((t) => parseAmount(t)).filter((x): x is number => x !== null);
    const description = tokens.filter((t) => parseAmount(t) === null).join(" ").trim();
    const total = amounts.length ? amounts[amounts.length - 1] : null;
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        originalDescription: description || raw,
        lineType: total !== null && total < 0 ? "discount" : "item",
        quantityText: "1",
        unit: "unit",
        unitPriceText: total !== null && total > 0 ? total.toFixed(2) : "",
        lineTotalText: total !== null ? total.toFixed(2) : "",
        discountText: "",
        confidence: "low",
        lowConfidenceFields: ["description", "lineTotal"],
        corrected: false,
        fromOcr: true,
        product: { kind: "none" },
      },
    ]);
    setDirty(true);
  }
  const isFreeOcr = (r.ocrModel ?? "").includes("Tesseract");

  return (
    <>
      <PageHeader
        title="בדיקה ועריכת קבלה"
        subtitle={verified ? "הקבלה כבר אושרה. שמירה חוזרת תעדכן אותה ותירשם בהיסטוריה." : "בדקו כל שדה מול הקבלה המקורית לפני האישור."}
        actions={<Link className="inline-flex min-h-11 items-center font-medium text-brand-700 underline" to={`/receipts/${receiptId}`}>לפרטי הקבלה</Link>}
      />

      <div className="mb-4 space-y-3">
        {readOnly && (
          <Notice tone="brand" icon="lock" title="צפייה בלבד">
            אפשר לראות את מסך הבדיקה, אבל שמירה, אישור ומחיקה דורשים כניסה למצב עריכה.
          </Notice>
        )}
        {data.duplicateOf && !r.duplicateOverride && (
          <Notice tone="alert" icon="copy" title="ייתכן שזו קבלה כפולה">
            <p>
              {r.duplicateReason}.{" "}
              <Link className="font-medium text-brand-700 underline" to={`/receipts/${data.duplicateOf._id}`}>
                פתיחת הקבלה הקיימת ({data.duplicateOf.purchaseDate ? formatIsoDate(data.duplicateOf.purchaseDate) : "ללא תאריך"}, {formatIls(data.duplicateOf.totalAgorot)})
              </Link>
            </p>
            {isEditor && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => overrideDuplicate(true)}>זו קנייה נפרדת — אינה כפולה</Button>
                <Button variant="danger" icon="trash" onClick={deleteReceipt}>מחיקת הכפילות</Button>
              </div>
            )}
          </Notice>
        )}
        {r.duplicateOverride && (
          <Notice tone="neutral" title="סומנה ידנית כקבלה שאינה כפולה">
            {isEditor && <button type="button" className="text-brand-700 underline" onClick={() => overrideDuplicate(false)}>ביטול הסימון</button>}
          </Notice>
        )}
        {params.get("ocr") === "failed" && r.ocrStatus !== "done" && (
          <Notice tone="review" title="הקריאה האוטומטית החינמית לא הצליחה">אפשר לנסות שוב עם הכפתור "קריאה חינמית במכשיר", או להזין את הפריטים ידנית מול התמונה.</Notice>
        )}
        {isFreeOcr && !verified && (
          <Notice tone="review" icon="alert" title="נקרא בקריאה חינמית במכשיר (ניסוי)">
            מחירים וסכומים נקראים בדרך כלל טוב; שמות מוצרים עלולים להיות משובשים. בדקו כל שורה מול התמונה — הצעות לשיוך מוצר מופיעות מתחת לכל שורה.
          </Notice>
        )}
        {ocrProgress && <OcrProgressBar p={ocrProgress} />}
        {r.ocrStatus === "failed" && <Notice tone="review" title="הקריאה האוטומטית נכשלה">{r.ocrError} — אפשר להזין ידנית.</Notice>}
        {r.ocrStatus === "running" && <Notice tone="brand" title="הקבלה נקראת כעת…">התוצאה תופיע כאן אוטומטית.</Notice>}
        {r.fileId && r.ocrStatus === "not_run" && !status?.ocrEnabled && (
          <Notice tone="neutral" title="הקריאה האוטומטית כבויה">
            היא תופעל רק לאחר אישורך לשימוש בתשלום ב-API. בינתיים אפשר להזין את פרטי הקבלה ידנית לפי התמונה.
          </Notice>
        )}
        {r.ocrConfidence && r.ocrConfidence !== "high" && !verified && (
          <Notice tone="review" icon="alert" title={`הקבלה נקראה ב${CONFIDENCE_LABELS[r.ocrConfidence]}`}>
            השדות המסומנים בצהוב דורשים בדיקה מול התמונה. לא הושלמו ערכים חסרים.
          </Notice>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">פרטי הקבלה</h2>
              {canFreeOcr && (
                <Button variant="secondary" icon="sparkle" onClick={readFree} disabled={busy !== null}>
                  {busy === "free-ocr" ? "קורא…" : isFreeOcr ? "קריאה חינמית מחדש" : "קריאה חינמית במכשיר"}
                </Button>
              )}
              {canOcr && (
                <Button variant="secondary" icon="sparkle" onClick={readAutomatically} disabled={busy !== null}>
                  {busy === "ocr" ? "קורא…" : r.ocrStatus === "done" ? "קריאה מחדש" : "קריאה אוטומטית"}
                </Button>
              )}
            </div>
            <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
              <Field label="חנות" warn={headerLow.has("storeName") ? "ודאות נמוכה — בדקו" : undefined}>
                <input className={`${inputClass} ${headerLow.has("storeName") ? warnInputClass : ""}`} value={header.storeName} onChange={(e) => updateHeader({ storeName: e.target.value })} />
              </Field>
              <Field
                label="תאריך קנייה"
                hint="בפורמט DD/MM/YYYY"
                warn={
                  header.dateText.trim() && !headerDate
                    ? "תאריך לא תקין"
                    : !header.dateText.trim()
                      ? "חסר תאריך — הזינו אותו מהקבלה אם אפשר"
                      : headerLow.has("purchaseDate") ? "ודאות נמוכה — בדקו" : undefined
                }
              >
                <input
                  className={`${inputClass} num text-end ${!headerDate ? warnInputClass : ""}`}
                  inputMode="numeric"
                  placeholder="DD/MM/YYYY"
                  value={header.dateText}
                  onChange={(e) => updateHeader({ dateText: e.target.value })}
                />
              </Field>
              <Field label="מספר קבלה" warn={headerLow.has("receiptNumber") ? "ודאות נמוכה — בדקו" : undefined}>
                <input className={`${inputClass} num text-end ${headerLow.has("receiptNumber") ? warnInputClass : ""}`} value={header.receiptNumber} onChange={(e) => updateHeader({ receiptNumber: e.target.value })} />
              </Field>
              <Field label="סכום כולל מודפס (₪)" warn={header.totalText.trim() && headerTotal === null ? "סכום לא תקין" : !header.totalText.trim() ? "חסר סכום כולל" : headerLow.has("total") ? "ודאות נמוכה — בדקו" : undefined}>
                <input className={`${inputClass} num text-end ${headerTotal === null ? warnInputClass : ""}`} inputMode="decimal" value={header.totalText} onChange={(e) => updateHeader({ totalText: e.target.value })} />
              </Field>
              <Field label="קונה (רשות)">
                <input className={inputClass} value={header.shopper} onChange={(e) => updateHeader({ shopper: e.target.value })} />
              </Field>
              <Field label="הערות (רשות)">
                <input className={inputClass} value={header.notes} onChange={(e) => updateHeader({ notes: e.target.value })} />
              </Field>
            </fieldset>
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">שורות ({lines.length})</h2>
              {unmatched > 0 && <Chip tone="review">{unmatched} שורות לא שויכו למוצר</Chip>}
            </div>
            {!verified && data.ocrUnrecognized.length > 0 && (
              <div className="mb-4 rounded-xl border border-review-200 bg-review-50 p-3">
                <p className="font-semibold text-review-700">שורות שהקריאה לא הצליחה לפענח ({data.ocrUnrecognized.length})</p>
                <p className="mb-2 text-sm text-ink-soft">בדקו מול התמונה. אם זו שורת מוצר — הוסיפו אותה ותקנו.</p>
                <ul className="space-y-1">
                  {data.ocrUnrecognized.map((u, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-white px-2 py-1 font-mono text-sm" dir="rtl">{u}</span>
                      {isEditor && (
                        <button type="button" className="min-h-9 text-sm font-medium text-brand-700 underline" onClick={() => addUnrecognized(u)}>
                          הוספה כשורה
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <fieldset disabled={readOnly} className="space-y-3">
              {lines.map((l, i) => (
                <LineEditor
                  key={l.key}
                  index={i}
                  line={l}
                  parsed={parsed[i]}
                  arithmetic={rec.lineChecks.find((c) => c.index === i)}
                  suggestions={l.originalDescription.trim() ? suggestMatches(l.originalDescription, candidates) : []}
                  products={products}
                  productName={productName}
                  onChange={(patch, valueEdit) => updateLine(l.key, patch, valueEdit)}
                  onRemove={() => {
                    setLines((ls) => ls.filter((x) => x.key !== l.key));
                    setDirty(true);
                  }}
                />
              ))}
              {lines.length === 0 && <p className="rounded-xl bg-page p-4 text-center text-ink-soft">אין שורות. הוסיפו את פריטי הקבלה.</p>}
              <Button variant="secondary" icon="plus" onClick={addLine}>הוספת שורה</Button>
            </fieldset>
          </Card>

          <Card>
            <h2 className="mb-3 text-xl font-bold">התאמה לסכום המודפס</h2>
            <ReconciliationPanel rec={rec} />
          </Card>

          {isEditor && (
            <Card className="sticky bottom-2 z-10 border-brand-100 shadow-lg">
              {validation.length > 0 && (
                <ul className="mb-3 list-inside list-disc text-alert-600">
                  {validation.slice(0, 6).map((v) => <li key={v}>{v}</li>)}
                </ul>
              )}
              {error && <p className="mb-3 font-medium text-alert-600" role="alert">{error}</p>}
              {message && <p className="mb-3 font-medium text-ok-700" role="status">{message}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button icon="check" onClick={() => save(true)} disabled={busy !== null || validation.length > 0}>
                  {busy === "finalize" ? "שומר…" : verified ? "שמירת התיקונים" : "אישור ושמירה"}
                </Button>
                {!verified && (
                  <Button variant="secondary" onClick={() => save(false)} disabled={busy !== null || validation.length > 0}>
                    {busy === "draft" ? "שומר…" : "שמירה כטיוטה"}
                  </Button>
                )}
                <Button variant="danger" icon="trash" onClick={deleteReceipt} className="ms-auto">מחיקת קבלה</Button>
              </div>
              {unmatched > 0 && <p className="mt-2 text-sm text-ink-soft">שורות שלא שויכו למוצר יישמרו, אך לא ייכללו בספירת מופעי הרכישה.</p>}
            </Card>
          )}
        </div>

        <Card className="order-first h-fit lg:order-none lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-auto">
          <h2 className="mb-3 text-xl font-bold">הקבלה המקורית</h2>
          <ReceiptFileViewer receiptId={receiptId} hasFile={!!r.fileId} />
        </Card>
      </div>
    </>
  );
}

function LineEditor({
  index,
  line: l,
  parsed: p,
  arithmetic,
  suggestions,
  products,
  productName,
  onChange,
  onRemove,
}: {
  index: number;
  line: EditLine;
  parsed: ParsedLine;
  arithmetic?: { expectedAgorot?: number };
  suggestions: MatchSuggestion[];
  products: { _id: Id<"products">; canonicalName: string }[];
  productName: Map<string, string>;
  onChange: (patch: Partial<EditLine>, valueEdit?: boolean) => void;
  onRemove: () => void;
}) {
  const low = new Set(l.lowConfidenceFields);
  const cls = (field: string, invalid: boolean) => `${inputClass} ${invalid || low.has(field) ? warnInputClass : ""}`;
  const isDiscount = l.lineType === "discount";
  const selectValue = l.product.kind === "existing" ? l.product.productId : l.product.kind === "new" ? "__new" : "";

  return (
    <div className={`rounded-xl border p-3 ${l.confidence === "low" ? "border-review-200 bg-review-50/50" : "border-line"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-soft">#{index + 1}</span>
        {l.confidence !== "high" && <Chip tone="review">{CONFIDENCE_LABELS[l.confidence]}</Chip>}
        {[...low].map((f) => <Chip key={f} tone="review">לבדוק: {FIELD_LABELS[f] ?? f}</Chip>)}
        {l.corrected && <Chip tone="brand">תוקן ידנית</Chip>}
        <button type="button" onClick={onRemove} className="ms-auto inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-alert-600 hover:bg-alert-50" aria-label={`מחיקת שורה ${index + 1}`}>
          הסרה
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2 sm:col-span-3">
          <span className="mb-1 block text-sm font-medium">תיאור כפי שמודפס</span>
          <input className={cls("description", !l.originalDescription.trim())} value={l.originalDescription} onChange={(e) => onChange({ originalDescription: e.target.value })} />
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className="mb-1 block text-sm font-medium">סוג שורה</span>
          <select className={inputClass} value={l.lineType} onChange={(e) => onChange({ lineType: e.target.value as LineType })}>
            {Object.entries(LINE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium">כמות</span>
          <input className={`${cls("quantity", p.quantity === null)} num text-end`} inputMode="decimal" value={l.quantityText} onChange={(e) => onChange({ quantityText: e.target.value })} />
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium">יחידה</span>
          <select className={inputClass} value={l.unit} onChange={(e) => onChange({ unit: e.target.value as Unit })}>
            {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium">מחיר ליחידה ₪</span>
          <input className={`${cls("unitPrice", p.unitPriceAgorot === null)} num text-end`} inputMode="decimal" value={l.unitPriceText} onChange={(e) => onChange({ unitPriceText: e.target.value })} />
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium">סכום שורה ₪</span>
          <input className={`${cls("lineTotal", p.lineTotalAgorot === null)} num text-end`} inputMode="decimal" value={l.lineTotalText} onChange={(e) => onChange({ lineTotalText: e.target.value })} />
        </label>
        <label className="col-span-2">
          <span className="mb-1 block text-sm font-medium">הנחה לשורה ₪ (חיובי)</span>
          <input className={`${cls("discount", p.discountAgorot === null)} num text-end`} inputMode="decimal" value={l.discountText} onChange={(e) => onChange({ discountText: e.target.value })} />
        </label>
      </div>
      {arithmetic?.expectedAgorot !== undefined && (
        <p className="mt-2 text-sm font-medium text-review-700">
          ⚠ כמות × מחיר = {formatIls(arithmetic.expectedAgorot)}, אך סכום השורה הוא {formatIls(p.lineTotalAgorot)}. בדקו מול הקבלה.
        </p>
      )}

      {!isDiscount && (
        <div className="mt-3 rounded-lg bg-page p-3">
          <span className="mb-1 block text-sm font-medium">שיוך למוצר</span>
          {l.product.kind === "existing" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="ok" icon="check">{productName.get(l.product.productId) ?? "מוצר"}</Chip>
              <button type="button" className="min-h-9 text-sm text-brand-700 underline" onClick={() => onChange({ product: { kind: "none" } }, false)}>
                ביטול השיוך
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {suggestions.length > 0 && l.product.kind === "none" && (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onChange({ product: { kind: "existing", productId: s.id as Id<"products"> } }, false)}
                      className={`min-h-9 rounded-lg border px-2 text-sm font-medium ${s.kind === "weak" ? "border-line bg-white text-ink-soft" : "border-brand-500 bg-white text-brand-700"}`}
                      title={s.qualifiersConflict ? "שימו לב: הגודל או האחוז שונים" : undefined}
                    >
                      אישור: {s.canonicalName} <span className="num">({Math.round(s.score * 100)}%)</span>
                      {s.qualifiersConflict && " · גודל/אחוז שונה"}
                    </button>
                  ))}
                </div>
              )}
              <select
                className={inputClass}
                value={selectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") onChange({ product: { kind: "none" } }, false);
                  else if (v === "__new") onChange({ product: { kind: "new", canonicalName: l.originalDescription, unit: l.unit } }, false);
                  else onChange({ product: { kind: "existing", productId: v as Id<"products"> } }, false);
                }}
              >
                <option value="">— לא שויך —</option>
                <option value="__new">+ מוצר חדש…</option>
                {products.map((pr) => <option key={pr._id} value={pr._id}>{pr.canonicalName}</option>)}
              </select>
              {l.product.kind === "new" && (
                <input
                  className={inputClass}
                  placeholder="שם המוצר (למשל: חלב 3% 1 ליטר)"
                  value={l.product.canonicalName}
                  onChange={(e) => onChange({ product: { kind: "new", canonicalName: e.target.value, unit: l.unit } }, false)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ReconciliationPanel({ rec }: { rec: Pick<Reconciliation, "status" | "linesTotalAgorot" | "discountsAgorot" | "computedTotalAgorot" | "printedTotalAgorot" | "differenceAgorot"> }) {
  const tone =
    rec.status === "match" ? "border-ok-700/20 bg-ok-50" : rec.status === "mismatch" ? "border-review-200 bg-review-50" : "border-line bg-page";
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><dt className="text-sm text-ink-soft">סך השורות</dt><dd className="num font-semibold">{formatIls(rec.linesTotalAgorot)}</dd></div>
        <div><dt className="text-sm text-ink-soft">הנחות בשורות</dt><dd className="num font-semibold">{formatIls(-rec.discountsAgorot)}</dd></div>
        <div><dt className="text-sm text-ink-soft">סכום מחושב</dt><dd className="num font-semibold">{formatIls(rec.computedTotalAgorot)}</dd></div>
        <div><dt className="text-sm text-ink-soft">סכום מודפס</dt><dd className="num font-semibold">{formatIls(rec.printedTotalAgorot)}</dd></div>
      </dl>
      <p className="mt-3 font-semibold">
        {rec.status === "match" && <span className="text-ok-700">✓ הסכומים תואמים</span>}
        {rec.status === "mismatch" && (
          <span className="text-review-700">⚠ פער לא מוסבר של {formatIls(rec.differenceAgorot)} — הסכומים לא שונו. בדקו מול הקבלה.</span>
        )}
        {rec.status === "no_total" && <span className="text-ink-soft">אין סכום כולל מודפס להשוואה (קבלה חלקית).</span>}
        {rec.status === "no_lines" && <span className="text-ink-soft">אין שורות.</span>}
      </p>
    </div>
  );
}
