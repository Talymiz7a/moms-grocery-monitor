import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Dataset = "demo" | "real";

type AppState = {
  dataset: Dataset;
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
  // Real data stays disabled until authentication is decided, so the
  // dataset is always "demo" for now.
  const [dataset, setDatasetState] = useState<Dataset>("demo");
  const [editorCode, setCode] = useState<string | null>(() => safeGet(() => sessionStorage, "editorCode"));

  const setDataset = useCallback((d: Dataset) => setDatasetState(d), []);
  const setEditorCode = useCallback((code: string | null) => {
    safeSet(() => sessionStorage, "editorCode", code);
    setCode(code);
  }, []);

  const value = useMemo(
    () => ({ dataset, setDataset, editorCode, setEditorCode, isEditor: editorCode !== null }),
    [dataset, setDataset, editorCode, setEditorCode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppStateProvider missing");
  return v;
}
