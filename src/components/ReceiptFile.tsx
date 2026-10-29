import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "../lib/format";
import { useAppState } from "../state/AppState";
import { Button } from "./ui";

/** Fetches a short-lived signed link to the original receipt file. */
function useFileLink(receiptId: Id<"receipts">, enabled: boolean) {
  const getLink = useMutation(api.files.getFileLink);
  const { editorCode } = useAppState();
  const [state, setState] = useState<{ url?: string; type?: string; error?: string; loading: boolean }>({ loading: enabled });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ loading: true });
    getLink({ receiptId, editorCode: editorCode ?? undefined })
      .then((r) => !cancelled && setState({ url: r?.url, type: r?.fileType, loading: false, error: r ? undefined : "לקבלה זו אין קובץ" }))
      .catch((e) => !cancelled && setState({ loading: false, error: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [receiptId, enabled, editorCode, getLink]);
  return state;
}

export function ReceiptFileViewer({ receiptId, hasFile }: { receiptId: Id<"receipts">; hasFile: boolean }) {
  const link = useFileLink(receiptId, hasFile);
  if (!hasFile) return <p className="rounded-xl bg-page p-6 text-center text-ink-soft">קבלה זו הוזנה ידנית — אין קובץ מקורי.</p>;
  if (link.loading) return <p className="p-6 text-center text-ink-soft">טוען את הקבלה המקורית…</p>;
  if (link.error || !link.url) return <p className="p-6 text-center text-alert-600">{link.error}</p>;
  return (
    <div className="space-y-2">
      {link.type === "application/pdf" ? (
        <iframe src={link.url} title="הקבלה המקורית" className="h-[70vh] w-full rounded-xl border border-line bg-white" />
      ) : (
        <img src={link.url} alt="הקבלה המקורית" className="mx-auto max-h-[75vh] w-auto rounded-xl border border-line bg-white" />
      )}
      <a href={link.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center font-medium text-brand-700 underline">
        פתיחה בחלון חדש (הקישור בתוקף 10 דקות)
      </a>
    </div>
  );
}

/** A button that opens the original receipt in a new tab. */
export function OpenReceiptButton({ receiptId, compact = false }: { receiptId: Id<"receipts">; compact?: boolean }) {
  const getLink = useMutation(api.files.getFileLink);
  const { editorCode } = useAppState();
  const [error, setError] = useState<string | null>(null);
  async function open() {
    // Open the window synchronously so pop-up blockers allow it, then point it at the signed link.
    const w = window.open("", "_blank");
    try {
      const r = await getLink({ receiptId, editorCode: editorCode ?? undefined });
      if (!r) {
        w?.close();
        setError("אין קובץ");
        return;
      }
      if (w) {
        w.opener = null;
        w.location.href = r.url;
      } else window.location.href = r.url;
    } catch (e) {
      w?.close();
      setError(errorMessage(e));
    }
  }
  return (
    <span className="inline-flex flex-col">
      <Button variant={compact ? "ghost" : "secondary"} icon="external" onClick={open} className={compact ? "min-h-9 px-2 py-1 text-sm" : ""}>
        {compact ? "קבלה" : "פתיחת הקבלה המקורית"}
      </Button>
      {error && <span className="text-sm text-alert-600">{error}</span>}
    </span>
  );
}
