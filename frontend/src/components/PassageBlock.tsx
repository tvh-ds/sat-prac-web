import MathText from "./MathText";

export interface PassageLike {
  id?: string;
  title?: string | null;
  content?: string | null;
}

export default function PassageBlock({
  passage,
  compact = false,
}: {
  passage: PassageLike | null | undefined;
  compact?: boolean;
}) {
  const content = (passage?.content ?? "").trim();
  if (!content) return null;
  const title = (passage?.title ?? "").trim();
  return (
    <div
      className="card card-pad"
      style={{
        background: "var(--bg-raise, #16181d)",
        padding: compact ? 12 : undefined,
      }}
    >
      <div className="section-label" style={{ marginBottom: 6 }}>[Passage]</div>
      {title && <p className="muted" style={{ fontWeight: 600, margin: "0 0 8px" }}>{title}</p>}
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: compact ? 13 : 13.5 }}>
        <MathText text={content} />
      </div>
    </div>
  );
}
