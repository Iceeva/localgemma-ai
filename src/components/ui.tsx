"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ErrorPayload } from "@/types";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-soft disabled:bg-accent/40",
  secondary: "border border-surface-border bg-surface-raised text-slate-200 hover:border-accent/60 disabled:opacity-50",
  danger: "bg-red-600/90 text-white hover:bg-red-500 disabled:bg-red-600/40",
  ghost: "text-slate-300 hover:bg-white/5 disabled:opacity-40",
};

export function Button({
  variant = "secondary",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className = "" }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-surface-border bg-surface-raised p-5 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const TONES = {
  ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  error: "bg-red-500/15 text-red-300 border-red-500/30",
  info: "bg-accent/15 text-accent-soft border-accent/30",
  muted: "bg-white/5 text-slate-300 border-white/10",
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function ErrorBox({ error, onClose }: { error: ErrorPayload | null | undefined; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/40 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-red-200">{error.message}</p>
        {onClose && (
          <button onClick={onClose} className="text-red-300/70 hover:text-red-200" aria-label="Fermer">
            ✕
          </button>
        )}
      </div>
      {error.hint && <p className="mt-1.5 text-slate-300">👉 {error.hint}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-slate-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-200">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-300">{error}</span>}
    </label>
  );
}

export const inputClass = "w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent disabled:opacity-50";

export function statusTone(state: string): Tone {
  return state === "running" || state === "active" ? "ok" : state === "starting" || state === "stopping" ? "warn" : state === "error" || state === "missing" ? "error" : "muted";
}
