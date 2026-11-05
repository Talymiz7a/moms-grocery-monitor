import { useAction, useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button, Card, Chip, Notice, PageHeader } from "../components/ui";
import { errorMessage } from "../lib/format";
import { useAppState } from "../state/AppState";

export function Settings() {
  const { dataset, setDataset, isEditor, editorCode, setEditorCode } = useAppState();
  const status = useQuery(api.app.status, {});
  const resetDemo = useAction(api.demo.reset);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function reset() {
    if (!editorCode || !window.confirm("לאפס את נתוני ההדגמה? כל קבלות ההדגמה (כולל כאלה שהועלו ידנית במצב הדגמה) יימחקו וייטענו מחדש. נתונים אמיתיים אינם מושפעים.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await resetDemo({ editorCode });
      setMsg(`נטענו מחדש ${r.receipts} קבלות הדגמה.`);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="הגדרות" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-xl font-bold">סוג הנתונים</h2>
          <div className="space-y-2" role="radiogroup" aria-label="סוג הנתונים">
            <label className={`flex items-start gap-3 rounded-xl border p-3 ${dataset === "demo" ? "border-brand-500 bg-brand-50" : "border-line"}`}>
              <input type="radio" name="dataset" checked={dataset === "demo"} onChange={() => setDataset("demo")} className="mt-1 size-5" />
              <span>
                <span className="font-semibold">נתוני הדגמה</span>
                <span className="block text-ink-soft">חמישה חודשים של רכישות בדיוניות (יוני–אוקטובר 2026). מופרדים לחלוטין מנתונים אמיתיים.</span>
              </span>
            </label>
            <label className={`flex items-start gap-3 rounded-xl border p-3 ${dataset === "real" ? "border-review-200 bg-review-50" : "border-line"} ${!isEditor ? "opacity-60" : ""}`}>
              <input type="radio" name="dataset" checked={dataset === "real"} disabled={!isEditor} onChange={() => setDataset("real")} className="mt-1 size-5" />
              <span>
                <span className="font-semibold">נתונים אמיתיים (ניסוי)</span>
                <span className="block text-ink-soft">
                  לבדיקת קבלות אמיתיות. זמין רק במצב עריכה: גם הצפייה בנתונים ובקבלות האמיתיים דורשת את קוד העורך. זו עדיין לא הזדהות מלאה — כל מי שיודע את הקוד יכול לראות אותם.
                </span>
              </span>
            </label>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-xl font-bold">מוצרים ורשימת קניות צפויה</h2>
          <p className="mb-3 text-ink-soft">כמות רגילה, מרווח צפוי, מקסימום בחודש וסיווג צפוי / מזדמן / לא צפוי / לבדיקה ידנית לכל מוצר. וגם איחוד ופיצול מוצרים.</p>
          <Link to="/settings/products" className="inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-medium text-white hover:bg-brand-600">ניהול מוצרים וציפיות</Link>
        </Card>

        <AlertSensitivity />

        <Card>
          <h2 className="mb-3 text-xl font-bold">גישה ועריכה</h2>
          <p className="mb-3 text-ink-soft">
            התצוגה פתוחה לצפייה ללא כניסה. כל שינוי דורש קוד עורך שמוגדר בשרת. זהו פתרון זמני לתצוגה המקדימה — לפני שימוש בקבלות אמיתיות תוגדר הזדהות מלאה.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {isEditor ? <Chip tone="ok">מצב עריכה פעיל</Chip> : <Chip>צפייה בלבד</Chip>}
            {status && !status.editingConfigured && <Chip tone="review">קוד עורך לא הוגדר בשרת</Chip>}
            {isEditor && <Button variant="ghost" onClick={() => setEditorCode(null)}>יציאה ממצב עריכה</Button>}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-xl font-bold">קריאה אוטומטית של קבלות (OCR)</h2>
          {status === undefined ? null : (
            <div className="space-y-3">
              {status.gemini.enabled ? (
                <Notice tone="ok" title="קריאה חכמה (Gemini, שכבה חינמית) — פעילה">
                  נוצלו החודש <span className="num">{status.gemini.usedThisMonth}</span> מתוך <span className="num">{status.gemini.monthlyLimit}</span> קריאות. ללא חיוב: המפתח שייך לפרויקט Google ללא חשבון חיוב.
                </Notice>
              ) : (
                <Notice tone="review" title="קריאה חכמה (Gemini, שכבה חינמית) — לא הוגדרה">
                  חסר המשתנה GEMINI_API_KEY בהגדרות השרת (Convex → Production → Settings → Environment Variables). עד שיוגדר זמינות הקריאה החינמית במכשיר (Tesseract) והזנה ידנית.
                </Notice>
              )}
              <Notice tone="neutral" title="קריאה בתשלום (Claude)">
                {status.ocrEnabled ? `פעילה · מודל: ${status.ocrModel}` : "כבויה, ולא תופעל ללא אישורך."}
              </Notice>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-xl font-bold">איפוס נתוני ההדגמה</h2>
          <p className="mb-3 text-ink-soft">טוען מחדש את חמשת חודשי ההדגמה. נתונים אמיתיים לעולם אינם נמחקים בפעולה זו.</p>
          <Button variant="secondary" onClick={reset} disabled={!isEditor || busy}>{busy ? "טוען…" : "איפוס נתוני ההדגמה"}</Button>
          {!isEditor && <p className="mt-2 text-sm text-ink-soft">זמין במצב עריכה בלבד.</p>}
          {msg && <p className="mt-2 font-medium">{msg}</p>}
        </Card>
      </div>
    </>
  );
}

function AlertSensitivity() {
  const { dataset, isEditor, editorCode, readArgs } = useAppState();
  const settings = useQuery(api.alerts.settings, { ...readArgs });
  const setSensitivity = useMutation(api.alerts.setSensitivity);
  const [msg, setMsg] = useState<string | null>(null);
  if (!settings) return null;
  return (
    <Card>
      <h2 className="mb-1 text-xl font-bold">רגישות ההתראות</h2>
      <p className="mb-3 text-ink-soft">
        קובעת כמה חריג צריך להיות דפוס לעומת ההיסטוריה של המוצר כדי שתיווצר התראה. השוואה להיסטוריה נעשית רק כשיש לפחות 3 חודשים / 5 רכישות קודמות; אחרת מסומן "ראיות מוגבלות".
      </p>
      <div className="space-y-2" role="radiogroup" aria-label="רגישות">
        {settings.options.map((o) => (
          <label key={o.key} className={`flex min-h-11 items-center gap-3 rounded-xl border p-3 ${settings.sensitivity === o.key ? "border-brand-500 bg-brand-50" : "border-line"}`}>
            <input
              type="radio"
              className="size-5"
              checked={settings.sensitivity === o.key}
              disabled={!isEditor}
              onChange={async () => {
                setMsg(null);
                try {
                  await setSensitivity({ editorCode: editorCode!, dataset, sensitivity: o.key });
                  setMsg("נשמר — ההתראות מחושבות מחדש");
                } catch (e) {
                  setMsg(errorMessage(e));
                }
              }}
            />
            {o.label}
          </label>
        ))}
      </div>
      {!isEditor && <p className="mt-2 text-sm text-ink-soft">שינוי זמין במצב עריכה בלבד.</p>}
      {msg && <p className="mt-2 font-medium">{msg}</p>}
    </Card>
  );
}
