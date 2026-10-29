import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-100 disabled:text-brand-700/60",
  secondary: "border border-brand-500 bg-white text-brand-700 hover:bg-brand-50 disabled:border-line disabled:text-ink-soft/60",
  ghost: "text-brand-700 hover:bg-brand-50 disabled:text-ink-soft/60",
  danger: "border border-alert-600 bg-white text-alert-600 hover:bg-alert-50",
};

export function Button({
  variant = "primary",
  icon,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: string }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function LinkButton({ to, children, icon, variant = "secondary" }: { to: string; children: ReactNode; icon?: string; variant?: Variant }) {
  return (
    <Link to={to} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 font-medium ${VARIANTS[variant]}`}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

type Tone = "neutral" | "ok" | "review" | "alert" | "brand";
const TONES: Record<Tone, string> = {
  neutral: "bg-page text-ink-soft border-line",
  ok: "bg-ok-50 text-ok-700 border-ok-700/20",
  review: "bg-review-50 text-review-700 border-review-200",
  alert: "bg-alert-50 text-alert-600 border-alert-600/30",
  brand: "bg-brand-50 text-brand-700 border-brand-100",
};

export function Chip({ tone = "neutral", children, icon }: { tone?: Tone; children: ReactNode; icon?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap ${TONES[tone]}`}>
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </span>
  );
}

export function Notice({ tone = "brand", title, children, icon = "info" }: { tone?: Tone; title?: string; children?: ReactNode; icon?: string }) {
  return (
    <div className={`flex gap-3 rounded-xl border p-4 ${TONES[tone]}`} role={tone === "alert" ? "alert" : "status"}>
      <Icon name={icon} className="mt-0.5 size-5 shrink-0" />
      <div className="text-ink">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-soft">{children}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, hint, to }: { label: string; value: ReactNode; hint?: string; to?: string }) {
  const body = (
    <div className="h-full rounded-2xl border border-line bg-white p-4 shadow-sm transition-colors hover:border-brand-500">
      <p className="text-ink-soft">{label}</p>
      <p className="mt-1 text-right text-3xl font-bold text-ink tabular-nums [unicode-bidi:plaintext]">{value}</p>
      {hint && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function Field({ label, hint, children, warn }: { label: string; hint?: ReactNode; children: ReactNode; warn?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {warn && <span className="mt-1 block text-sm font-medium text-review-700">⚠ {warn}</span>}
      {hint && !warn && <span className="mt-1 block text-sm text-ink-soft">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full min-h-11 rounded-xl border border-line bg-white px-3 py-2 text-ink placeholder:text-ink-soft/60 focus:border-brand-500 disabled:bg-page disabled:text-ink-soft";
export const warnInputClass = "border-review-200 bg-review-50";

export function Loading() {
  return <p className="py-10 text-center text-ink-soft">טוען…</p>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-ink-soft">{children}</div>}
    </div>
  );
}
