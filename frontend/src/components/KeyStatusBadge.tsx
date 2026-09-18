import type { PdfImport } from "../lib/types";
import { moduleTag } from "../lib/testTitle";

export type StructuralKeyStatus = "complete" | "partial" | "missing" | "low_confidence";

export interface KeyStatusInfo {
  status: StructuralKeyStatus | null;
  label: string;
  tone: "green" | "amber" | "red" | "gray";
  /** "98/98 keys · RW M1 27/27 · …" */
  detail: string | null;
  warnings: string[];
}

/**
 * Structural answer-key status for an import: do parsed keys match detected
 * questions in total AND per module? Prefers the worker's structural value
 * in text_quality, falls back to the answer_key_status column.
 */
export function keyStatusInfo(imp: PdfImport): KeyStatusInfo {
  const tq = imp.text_quality;
  const raw = (tq?.answer_key_status ?? imp.answer_key_status ?? null) as StructuralKeyStatus | null;
  const summary = (imp.answer_key_summary ?? tq?.answer_key_summary ?? null) as Record<
    string,
    { questions: number; keys: number; status: string }
  > | null;
  const warnings = (tq?.answer_key_warnings ?? []) as string[];
  if (!raw && !summary) return { status: null, label: "—", tone: "gray", detail: null, warnings: [] };

  let questions = 0;
  let keys = 0;
  const parts: string[] = [];
  if (summary) {
    for (const [mod, s] of Object.entries(summary)) {
      questions += s.questions;
      keys += s.keys;
      parts.push(`${moduleTag(mod)} ${s.keys}/${s.questions}`);
    }
  }
  const status: StructuralKeyStatus = raw ?? (keys === 0 ? "missing" : keys >= questions && questions > 0 ? "complete" : "partial");
  const label =
    status === "complete" ? "Complete" : status === "partial" ? "Partial" : status === "low_confidence" ? "Low confidence" : "Missing";
  const tone = status === "complete" ? "green" : status === "missing" ? "red" : status === "low_confidence" ? "amber" : "amber";
  const detail = summary ? `${keys}/${questions} keys${parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}` : null;
  return { status, label, tone, detail, warnings };
}

export default function KeyStatusBadge({ imp, showDetail }: { imp: PdfImport; showDetail?: boolean }) {
  const info = keyStatusInfo(imp);
  if (!info.status) return <span className="muted">—</span>;
  return (
    <span title={[...(info.detail ? [info.detail] : []), ...info.warnings].join("\n") || info.label}>
      <span className={`pill pill-${info.tone}`}>{info.label}</span>
      {showDetail && info.detail && (
        <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 4 }}>{info.detail}</span>
      )}
      {showDetail && info.warnings.length > 0 && (
        <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 2 }}>{info.warnings[0]}</span>
      )}
    </span>
  );
}
