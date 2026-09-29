import type { TextAnnotation } from "../lib/types";
import MathText from "./MathText";

interface Segment {
  text: string;
  annotations: TextAnnotation[];
}

interface MarkRange {
  start: number;
  end: number;
  annotation: TextAnnotation;
}

/** Split prose into ranges with the annotations that cover each range. */
export function splitAnnotatedText(
  text: string,
  annotations: TextAnnotation[],
  legacyHighlights: string[],
  target: string,
): Segment[] {
  const legacy = [...new Set((legacyHighlights ?? []).filter(Boolean))].map((quote, index): TextAnnotation => ({
    id: `legacy-${index}`,
    target,
    quote,
    color: "yellow",
    underline: false,
  }));
  // Legacy yellow highlights are the base layer. Scoped annotations from later
  // saves take precedence when ranges overlap.
  const active = [...legacy, ...(annotations ?? []).filter((item) => item.target === target)];
  const ranges: MarkRange[] = [];
  const boundaries = new Set<number>([0, text.length]);

  for (const annotation of active) {
    if (
      annotation.target === target && Number.isInteger(annotation.start) &&
      Number.isInteger(annotation.end) && annotation.start! >= 0 &&
      annotation.end! > annotation.start! && annotation.end! <= text.length
    ) {
      ranges.push({ start: annotation.start!, end: annotation.end!, annotation });
      boundaries.add(annotation.start!);
      boundaries.add(annotation.end!);
      continue;
    }
    const quote = annotation.quote.trim();
    if (!quote) continue;
    let from = 0;
    let occurrence = 0;
    while (from < text.length) {
      const start = text.indexOf(quote, from);
      if (start < 0) break;
      const end = start + quote.length;
      if (annotation.occurrence === undefined || annotation.occurrence === occurrence) {
        ranges.push({ start, end, annotation });
        boundaries.add(start);
        boundaries.add(end);
        if (annotation.occurrence !== undefined) break;
      }
      occurrence += 1;
      from = end;
    }
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const covering = ranges
      .filter((range) => range.start <= start && range.end >= end)
      .map((range) => range.annotation);
    const signature = covering.map((item) => item.id).sort().join("|");
    const previous = segments[segments.length - 1];
    const previousSignature = previous?.annotations.map((item) => item.id).sort().join("|");
    if (previous && previousSignature === signature) previous.text += text.slice(start, end);
    else segments.push({ text: text.slice(start, end), annotations: covering });
  }
  return segments;
}

export default function HighlightableText({
  text,
  annotations,
  legacyHighlights,
  target,
  className,
  style,
}: {
  text: string;
  annotations: TextAnnotation[] | undefined | null;
  legacyHighlights?: string[] | undefined | null;
  target: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const segments = splitAnnotatedText(text, annotations ?? [], legacyHighlights ?? [], target);
  const wrapperClass = ["annotatable-text", className].filter(Boolean).join(" ");
  return (
    <span className={wrapperClass} style={style} data-annotation-scope={target}>
      {segments.map((segment, index) => {
        if (segment.annotations.length === 0) return <MathText key={index} text={segment.text} />;
        const color = [...segment.annotations].reverse().find((item) => item.color !== "none")?.color;
        const hasUnderline = segment.annotations.some((item) => item.underline);
        const classNames = [
          "text-annotation",
          color && color !== "none" ? `text-annotation-${color}` : "",
          hasUnderline ? "text-annotation-underline" : "",
        ].filter(Boolean).join(" ");
        return (
          <mark key={index} className={classNames}>
            <MathText text={segment.text} />
          </mark>
        );
      })}
    </span>
  );
}
