import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "../../convex/lib/config";
import { Icon } from "../components/Icon";
import { Button, Card, Notice, PageHeader } from "../components/ui";
import { errorMessage } from "../lib/format";
import { useAppState } from "../state/AppState";

/**
 * Makes a downscaled JPEG copy used only for automatic reading (smaller
 * upload, lower API cost). The original file is uploaded unchanged.
 */
async function makeOcrCopy(file: File): Promise<Blob | null> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  } catch {
    return null;
  }
}

async function uploadBlob(url: string, blob: Blob): Promise<string> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
  if (!res.ok) throw new Error("upload failed");
  return (await res.json()).storageId as string;
}

export function Upload() {
  const { dataset, isEditor, editorCode } = useAppState();
  const status = useQuery(api.app.status, {});
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const createDraft = useMutation(api.files.createDraftFromUpload);
  const createManual = useMutation(api.files.createManualDraft);
  const navigate = useNavigate();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ receiptId: string; reason: string; originalId: string } | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function choose(f: File | undefined) {
    setError(null);
    setDuplicate(null);
    if (!f) return;
    if (!ALLOWED_UPLOAD_TYPES.includes(f.type)) {
      setError("סוג הקובץ אינו נתמך. אפשר להעלות תמונה (JPEG, PNG, WebP, HEIC) או PDF.");
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError("הקובץ גדול מ-15MB.");
      return;
    }
    setFile(f);
  }

  async function upload() {
    if (!file || !editorCode) return;
    setBusy(true);
    setError(null);
    try {
      const storageId = await uploadBlob(await generateUploadUrl({ editorCode }), file);
      const copy = await makeOcrCopy(file);
      const ocrStorageId = copy && copy.size < 4.5 * 1024 * 1024 ? await uploadBlob(await generateUploadUrl({ editorCode }), copy) : undefined;
      const res = await createDraft({
        editorCode,
        dataset,
        storageId: storageId as Id<"_storage">,
        ocrStorageId: ocrStorageId as Id<"_storage"> | undefined,
        fileName: file.name || "receipt",
      });
      if (res.duplicate) setDuplicate({ receiptId: res.receiptId, reason: res.duplicate.reason, originalId: res.duplicate.id });
      else navigate(`/receipts/${res.receiptId}/review`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function manual() {
    if (!editorCode) return;
    try {
      const { receiptId } = await createManual({ editorCode, dataset });
      navigate(`/receipts/${receiptId}/review`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader title="העלאת קבלה" subtitle="צילום, תמונה או PDF. הקובץ המקורי נשמר כפי שהוא, ולפני השמירה מוצג מסך בדיקה." />
      <div className="space-y-4">
        {!isEditor && (
          <Notice tone="brand" icon="lock" title="צפייה בלבד">
            העלאת קבלות זמינה רק במצב עריכה. בתצוגה הציבורית אי אפשר להוסיף, לשנות או למחוק נתונים.
          </Notice>
        )}
        {dataset === "demo" && isEditor && (
          <Notice tone="review" title="מצב הדגמה">
            קבלות שמועלות עכשיו נשמרות כנתוני הדגמה ונמחקות באיפוס ההדגמה. אין להעלות קבלות אמיתיות לפני שתוגדר הזדהות.
          </Notice>
        )}
        <Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              disabled={!isEditor}
              onClick={() => cameraRef.current?.click()}
              className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-500 bg-brand-50 p-4 font-semibold text-brand-700 disabled:border-line disabled:bg-page disabled:text-ink-soft"
            >
              <Icon name="camera" className="size-8" />
              צילום במצלמה
            </button>
            <button
              type="button"
              disabled={!isEditor}
              onClick={() => fileRef.current?.click()}
              className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-500 bg-white p-4 font-semibold text-brand-700 disabled:border-line disabled:bg-page disabled:text-ink-soft"
            >
              <Icon name="file" className="size-8" />
              בחירת תמונה או PDF
            </button>
            <button
              type="button"
              disabled={!isEditor}
              onClick={manual}
              className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-white p-4 font-semibold text-ink disabled:bg-page disabled:text-ink-soft"
            >
              <Icon name="edit" className="size-8" />
              הזנה ידנית ללא קובץ
            </button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />

          {file && (
            <div className="mt-5 space-y-3">
              <p className="font-medium">
                נבחר: {file.name} <span className="num text-ink-soft">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
              </p>
              {preview && <img src={preview} alt="תצוגה מקדימה של הקבלה" className="max-h-96 rounded-xl border border-line" />}
              <div className="flex flex-wrap gap-2">
                <Button icon="upload" onClick={upload} disabled={busy}>{busy ? "מעלה…" : "העלאה והמשך לבדיקה"}</Button>
                <Button variant="ghost" onClick={() => setFile(null)} disabled={busy}>ביטול</Button>
              </div>
            </div>
          )}
          {error && <p className="mt-4 font-medium text-alert-600" role="alert">{error}</p>}
          {duplicate && (
            <div className="mt-4">
              <Notice tone="alert" icon="copy" title="ייתכן שהקבלה כבר הועלתה">
                <p>{duplicate.reason}. הקבלה נשמרה כטיוטה ולא תיספר עד שתאשרו שאינה כפולה.</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Link className="font-medium text-brand-700 underline" to={`/receipts/${duplicate.originalId}`}>לקבלה הקיימת</Link>
                  <Link className="font-medium text-brand-700 underline" to={`/receipts/${duplicate.receiptId}/review`}>להמשך בדיקת הקבלה החדשה</Link>
                </div>
              </Notice>
            </div>
          )}
        </Card>
        <Notice tone="neutral" title={status?.ocrEnabled ? "קריאה אוטומטית פעילה" : "קריאה אוטומטית כבויה"}>
          {status?.ocrEnabled
            ? "אחרי ההעלאה אפשר ללחוץ על 'קריאה אוטומטית' במסך הבדיקה. כל שדה בוודאות נמוכה יסומן לבדיקה."
            : "כרגע הקריאה האוטומטית (בתשלום) כבויה עד לאישורך. אחרי ההעלאה מזינים את הפריטים ידנית מול תמונת הקבלה."}
        </Notice>
      </div>
    </>
  );
}
