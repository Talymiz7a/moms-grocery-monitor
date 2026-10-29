import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useAppState } from "../state/AppState";
import { Button, Notice, inputClass } from "./ui";

export function EditorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { setEditorCode } = useAppState();
  const status = useQuery(api.app.status, {});
  const verify = useMutation(api.app.verifyEditorCode);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { valid } = await verify({ code: code.trim() });
      if (valid) {
        setEditorCode(code.trim());
        setCode("");
        onClose();
      } else setError("הקוד אינו נכון.");
    } catch {
      setError("לא ניתן לבדוק את הקוד כרגע.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-line p-0 shadow-xl backdrop:bg-ink/40"
      dir="rtl"
    >
      <form onSubmit={submit} className="space-y-4 p-6">
        <h2 className="text-xl font-bold">כניסה למצב עריכה</h2>
        <p className="text-ink-soft">
          התצוגה פתוחה לצפייה. כדי להעלות קבלות, לתקן או למחוק נתונים יש להזין את קוד העורך.
        </p>
        {status && !status.editingConfigured && (
          <Notice tone="review" title="קוד עורך לא הוגדר בשרת">כרגע כל השינויים חסומים.</Notice>
        )}
        <input
          className={inputClass}
          type="password"
          autoComplete="current-password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="קוד עורך"
          aria-label="קוד עורך"
        />
        {error && <p className="font-medium text-alert-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" disabled={busy || code.trim().length === 0}>
            כניסה
          </Button>
        </div>
      </form>
    </dialog>
  );
}
