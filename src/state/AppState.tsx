import { useQuery } from "convex/react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";

export type Dataset = "demo" | "real";

type AppState = {
  dataset: Dataset;
  /** Arguments every read needs: the dataset, plus the editor code (required for real data). */
  readArgs: { dataset: Dataset; editorCode?: string };
  /** Editor code for this browser tab; null = read-only. */
  editorCode: string | null;
  setEditorCode: (code: string | null) => void;
  isEditor: boolean;
  /** The owner switched the editor code off: everyone can edit. */
  openEditing: boolean;
};

/** Sent instead of a code when editing is open; the server accepts any value then. */
const OPEN_EDITING_CODE = "open-editing";

const Ctx = createContext<AppState | null>(null);

function safeGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}
function safeSet(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); the app still works for this page view.
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const status = useQuery(api.app.status, {});
  const openEditing = status?.openEditing === true;
  const [storedCode, setCode] = useState<string | null>(() => safeGet(() => sessionStorage, "editorCode"));
  const editorCode = openEditing ? (storedCode ?? OPEN_EDITING_CODE) : storedCode;
  // The app works on real data only (the demo option was removed at the owner's request).
  const dataset: Dataset = "real";

  const setEditorCode = useCallback((code: string | null) => {
    safeSet(() => sessionStorage, "editorCode", code);
    setCode(code);
  }, []);

  const value = useMemo(
    () => ({
      dataset,
      readArgs: editorCode ? { dataset, editorCode } : { dataset },
      editorCode,
      setEditorCode,
      isEditor: editorCode !== null,
      openEditing,
    }),
    [dataset, editorCode, setEditorCode, openEditing],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppStateProvider missing");
  return v;
}
