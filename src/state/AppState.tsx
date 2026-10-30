import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

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
};

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
  const [editorCode, setCode] = useState<string | null>(() => safeGet(() => sessionStorage, "editorCode"));
  // Real data can only be opened in editor mode; the choice is kept for this tab.
  const [dataset, setDatasetState] = useState<Dataset>(() =>
    safeGet(() => sessionStorage, "dataset") === "real" && safeGet(() => sessionStorage, "editorCode") ? "real" : "demo",
  );

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
    }),
    [dataset, setDataset, editorCode, setEditorCode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppStateProvider missing");
  return v;
}
