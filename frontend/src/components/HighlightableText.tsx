import MathText from "./MathText";

interface Seg {
  text: string;
  hl: string | null;
}

/**
 * Render text with yellow highlights. Highlight entries are exact substrings
 * of the raw text; each chunk (highlighted or not) renders through MathText
 * so equations keep working. Clicking a highlight removes it.
 */
export function splitHighlighted(text: string, highlights: string[]): Seg[] {
  const marks = [...new Set((highlights ?? []).filter(Boolean))].sort((a, b) => b.length - a.length);
  const segs: Seg[] = [];
  let i = 0;
  while (i < text.length) {
    let best: { idx: number; h: string } | null = null;
    for (const h of marks) {
      const idx = text.indexOf(h, i);
      if (idx === -1) continue;
      if (!best || idx < best.idx || (idx === best.idx && h.length > best.h.length)) best = { idx, h };
    }
    if (!best) {
      segs.push({ text: text.slice(i), hl: null });
      break;
    }
    if (best.idx > i) segs.push({ text: text.slice(i, best.idx), hl: null });
    segs.push({ text: best.h, hl: best.h });
    i = best.idx + best.h.length;
  }
  return segs;
}

export default function HighlightableText({
  text,
  highlights,
  onRemoveHighlight,
  className,
  style,
}: {
  text: string;
  highlights: string[] | undefined | null;
  onRemoveHighlight?: (entry: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const segs = splitHighlighted(text, highlights ?? []);
  if (!segs.some((s) => s.hl)) return <MathText text={text} className={className} style={style} />;
  return (
    <span className={className} style={style}>
      {segs.map((s, i) =>
        s.hl ? (
          <mark
            key={i}
            className="t-hl"
            title="Click to remove highlight"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveHighlight?.(s.hl as string);
            }}
          >
            <MathText text={s.text} />
          </mark>
        ) : (
          <MathText key={i} text={s.text} />
        ),
      )}
    </span>
  );
}
