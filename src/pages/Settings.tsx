import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button, Card, Chip, Notice, PageHeader } from "../components/ui";
import { errorMessage } from "../lib/format";
import { useAppState } from "../state/AppState";

export function Settings() {
  const { dataset, isEditor, editorCode, setEditorCode } = useAppState();
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
          <div className="space-y-2">
            <label className="flex items-start gap-3 rounded-xl border border-brand-500 bg-brand-50 p-3">
              <input type="radio" checked={dataset === "demo"} readOnly className="mt-1 size-5" />
              <span>
                <span className="font-semibold">נתוני הדגמה</span>
                <span className="block text-ink-soft">חמישה חודשים של רכישות בדיוניות (יוני–אוקטובר 2026). מופרדים לחלוטין מנתונים אמיתיים.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-line p-3 opacity-60">
              <input type="radio" disabled className="mt-1 size-5" />
              <span>
                <span className="font-semibold">נתונים אמיתיים</span>
                <span className="block text-ink-soft">יופעל רק לאחר שתוגדר הזדהות משתמשים ובאישורך.</span>
              </span>
            </label>
          </div>
        </Card>

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
          {status === undefined ? null : status.ocrEnabled ? (
            <Notice tone="ok" title="פעילה">מודל: {status.ocrModel}</Notice>
          ) : (
            <Notice tone="neutral" title="כבויה">
              הקריאה האוטומטית משתמשת ב-Claude (שירות בתשלום) ותופעל רק לאחר אישורך. עד אז מזינים פרטי קבלות ידנית.
            </Notice>
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
