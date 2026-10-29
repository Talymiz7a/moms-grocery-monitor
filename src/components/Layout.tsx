import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAppState } from "../state/AppState";
import { EditorDialog } from "./EditorDialog";
import { Icon } from "./Icon";

export const NAV_ITEMS = [
  { to: "/", label: "לוח בקרה", icon: "dashboard" },
  { to: "/upload", label: "העלאת קבלה", icon: "upload" },
  { to: "/receipts", label: "קבלות ורכישות", icon: "receipt" },
  { to: "/analysis", label: "ניתוח מוצרים", icon: "chart" },
  { to: "/alerts", label: "התראות ובקרה", icon: "bell" },
  { to: "/settings", label: "הגדרות", icon: "settings" },
] as const;

function navClass({ isActive }: { isActive: boolean }) {
  return `flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 font-medium whitespace-nowrap transition-colors ${
    isActive ? "bg-brand-500 text-white" : "text-ink hover:bg-brand-50"
  }`;
}

export function Layout({ children }: { children: ReactNode }) {
  const { dataset, isEditor, setEditorCode } = useAppState();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-9" />
            <div className="leading-tight">
              <p className="text-lg font-bold">מעקב קניות אמא</p>
              <p className="text-sm text-ink-soft">כלי מעקב ובקרה — לא תקציב</p>
            </div>
          </div>
          <div className="ms-auto flex items-center gap-2">
            {dataset === "demo" && (
              <span className="hidden rounded-full bg-review-50 px-3 py-1 text-sm font-semibold text-review-700 sm:inline">נתוני הדגמה</span>
            )}
            {isEditor ? (
              <button
                type="button"
                onClick={() => setEditorCode(null)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ok-700/30 bg-ok-50 px-3 font-medium text-ok-700"
                title="יציאה ממצב עריכה"
              >
                <Icon name="unlock" />
                <span className="hidden sm:inline">מצב עריכה</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-3 font-medium text-ink-soft hover:border-brand-500"
              >
                <Icon name="lock" />
                <span className="hidden sm:inline">צפייה בלבד</span>
              </button>
            )}
          </div>
        </div>
        {/* Navigation on phones and iPads: horizontal, scrollable. */}
        <nav className="border-t border-line lg:hidden" aria-label="ניווט ראשי">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 py-2">
            {NAV_ITEMS.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} className={navClass}>
                <Icon name={n.icon} />
                {n.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      {dataset === "demo" && (
        <div className="border-b border-review-200 bg-review-50">
          <p className="mx-auto max-w-7xl px-4 py-2 text-sm text-review-700">
            <strong>מצב הדגמה:</strong> כל הקבלות והמוצרים כאן בדיוניים (בין <span className="num">01/06/2026</span> ל-<span className="num">28/10/2026</span>) ואינם נכללים בנתונים אמיתיים.
            {!isEditor && " התצוגה לצפייה בלבד — לא ניתן לשנות או למחוק נתונים."}
          </p>
        </div>
      )}

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-24 flex flex-col gap-1" aria-label="ניווט ראשי">
            {NAV_ITEMS.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} className={navClass}>
                <Icon name={n.icon} />
                {n.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <EditorDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
