import type { ReactNode } from "react";

export function Button({
  children,
  variant = "primary",
  size,
  className,
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "outline" | "secondary" | "ghost" | "danger";
  size?: "sm" | "lg";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn-${variant}${size ? ` btn-${size}` : ""}${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </button>
  );
}

export function Pill({ tone = "gray", children }: { tone?: "gray" | "green" | "amber" | "red" | "blue"; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="center-fill">
      <div className="spinner" />
      <span>Loading…</span>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {body && <p>{body}</p>}
    </div>
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}