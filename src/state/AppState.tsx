import { useQuery } from "convex/react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";

export type Dataset = "demo" | "real";

type AppState = {
  dataset: Dataset;
  /** Arguments every read needs: the dataset, plus the editor code (required for real data). */
  readArgs: { dataset: Dataset; editorCode?: string };
  setDataset: (d: Dataset) => void;
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
  // The chosen dataset is kept for this tab; real data only opens in editor mode.
  const [storedDataset, setDatasetState] = useState<Dataset>(() => (safeGet(() => sessionStorage, "dataset") === "real" ? "real" : "demo"));
  const editorCode = openEditing ? (storedCode ?? OPEN_EDITING_CODE) : storedCode;
  const dataset: Dataset = storedDataset === "real" && editorCode !== null ? "real" : "demo";

  const setDataset = useCallback((d: Dataset) => {
    safeSet(() => sessionStorage, "dataset", d);
    setDatasetState(d);
  }, []);
  const setEditorCode = useCallback((code: string | null) => {
    safeSet(() => sessionStorage, "editorCode", code);
    setCode(code);
    if (code === null) {
      safeSet(() => sessionStorage, "dataset", "demo");
      setDatasetState("demo");
    }
  }, []);

  const value = useMemo(
    () => ({
      dataset,
      readArgs: editorCode ? { dataset, editorCode } : { dataset },
      setDataset,
      editorCode,
      setEditorCode,
      isEditor: editorCode !== null,
      openEditing,
    }),
    [dataset, setDataset, editorCode, setEditorCode, openEditing],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppStateProvider missing");
  return v;
}
