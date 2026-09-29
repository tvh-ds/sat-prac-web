import type { TextAnnotation } from "./types";

export type AnnotationAction =
  | { kind: "color"; color: Exclude<TextAnnotation["color"], "none"> }
  | { kind: "underline" }
  | { kind: "erase" };

export interface TextRange {
  start: number;
  end: number;
}

interface ResolvedAnnotation {
  annotation: TextAnnotation;
  range: TextRange;
}

/** Map a visible selection back to the source string, including bold markers. */
export function findSourceRange(source: string, quote: string, occurrence: number): TextRange | null {
  const displayCharacters: string[] = [];
  const sourceOffsets: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("**", index) || source.startsWith("__", index)) {
      index += 1;
      continue;
    }
    displayCharacters.push(source[index]);
    sourceOffsets.push(index);
  }

  const visibleSource = displayCharacters.join("");
  let from = 0;
  let seen = 0;
  while (from < visibleSource.length) {
    const index = visibleSource.indexOf(quote, from);
    if (index < 0) break;
    if (seen === occurrence) {
      const last = index + quote.length - 1;
      return { start: sourceOffsets[index], end: sourceOffsets[last] + 1 };
    }
    seen += 1;
    from = index + quote.length;
  }

  // MathText and other inline renderers can make the visible text differ from
  // the source. Preserve support for ordinary exact matches as a fallback.
  from = 0;
  seen = 0;
  while (from < source.length) {
    const index = source.indexOf(quote, from);
    if (index < 0) break;
    if (seen === occurrence) return { start: index, end: index + quote.length };
    seen += 1;
    from = index + quote.length;
  }
  return null;
}

export function rangesForAnnotation(annotation: TextAnnotation, source: string): TextRange[] {
  if (
    Number.isInteger(annotation.start) && Number.isInteger(annotation.end) &&
    annotation.start! >= 0 && annotation.end! > annotation.start! && annotation.end! <= source.length
  ) {
    return [{ start: annotation.start!, end: annotation.end! }];
  }

  const quote = annotation.quote.trim();
  if (!quote) return [];
  const found: TextRange[] = [];
  let from = 0;
  let occurrence = 0;
  while (from < source.length) {
    const start = source.indexOf(quote, from);
    if (start < 0) break;
    if (annotation.occurrence === undefined || annotation.occurrence === occurrence) {
      found.push({ start, end: start + quote.length });
      if (annotation.occurrence !== undefined) break;
    }
    occurrence += 1;
    from = start + quote.length;
  }
  return found;
}

/** Turn old substring-only highlights into scoped, editable ranges. */
export function materializeLegacyHighlights(
  highlights: string[],
  targets: Array<{ target: string; text: string }>,
  existing: TextAnnotation[],
): { annotations: TextAnnotation[]; remaining: string[] } {
  const annotations: TextAnnotation[] = [];
  const remaining: string[] = [];
  const maxMaterialized = 500;

  for (const legacyQuote of [...new Set(highlights ?? [])]) {
    const quote = legacyQuote.trim();
    if (quote.length < 1) continue;
    const additions: TextAnnotation[] = [];
    let found = false;
    let overflow = false;
    for (const target of targets) {
      const occupied = existing
        .filter((annotation) => annotation.target === target.target && annotation.color !== "none")
        .flatMap((annotation) => rangesForAnnotation(annotation, target.text));
      let from = 0;
      while (from < target.text.length) {
        const start = target.text.indexOf(quote, from);
        if (start < 0) break;
        const end = start + quote.length;
        found = true;
        if (!occupied.some((range) => range.start <= start && range.end >= end)) {
          additions.push({
            id: crypto.randomUUID(),
            target: target.target,
            quote,
            start,
            end,
            color: "yellow",
            underline: false,
          });
        }
        if (annotations.length + additions.length > maxMaterialized) {
          overflow = true;
          break;
        }
        from = end;
      }
      if (overflow) break;
    }
    if (overflow) remaining.push(legacyQuote);
    else if (found) annotations.push(...additions);
    else remaining.push(legacyQuote);
  }

  return { annotations, remaining };
}

function makeRangeAnnotation(
  target: string,
  source: string,
  range: TextRange,
  color: TextAnnotation["color"],
  underline: boolean,
): TextAnnotation | null {
  if (range.end <= range.start) return null;
  return {
    id: crypto.randomUUID(),
    target,
    quote: source.slice(range.start, range.end),
    start: range.start,
    end: range.end,
    color,
    underline,
  };
}

function annotationSignature(annotation: TextAnnotation): string {
  return `${annotation.color}:${annotation.underline}`;
}

function pushCoalesced(
  result: TextAnnotation[],
  target: string,
  source: string,
  range: TextRange,
  color: TextAnnotation["color"],
  underline: boolean,
): void {
  if (color === "none" && !underline) return;
  const previous = result[result.length - 1];
  const next = makeRangeAnnotation(target, source, range, color, underline);
  if (!next) return;
  if (
    previous && previous.target === target && previous.end === range.start &&
    annotationSignature(previous) === annotationSignature(next)
  ) {
    previous.end = range.end;
    previous.quote = source.slice(previous.start!, range.end);
  } else {
    result.push(next);
  }
}

/** Apply a color, underline, or eraser to a character range. */
export function updateAnnotationsForRange(
  annotations: TextAnnotation[],
  target: string,
  source: string,
  selected: TextRange,
  action: AnnotationAction,
): TextAnnotation[] {
  const start = Math.max(0, Math.min(source.length, selected.start));
  const end = Math.max(start, Math.min(source.length, selected.end));
  if (end <= start) return annotations;

  const resolved: ResolvedAnnotation[] = [];
  const untouched: TextAnnotation[] = [];
  for (const annotation of annotations ?? []) {
    if (annotation.target !== target) {
      untouched.push(annotation);
      continue;
    }
    const ranges = rangesForAnnotation(annotation, source);
    if (ranges.length === 0) {
      untouched.push(annotation);
      continue;
    }
    for (const range of ranges) {
      resolved.push({
        range,
        annotation: {
          ...annotation,
          quote: source.slice(range.start, range.end),
          start: range.start,
          end: range.end,
        },
      });
    }
  }

  const overlapping = resolved.filter(({ range }) => range.start < end && range.end > start);
  const result = [...untouched];
  const selectionPieces: TextAnnotation[] = [];

  for (const item of resolved) {
    if (item.range.end <= start || item.range.start >= end) {
      result.push(item.annotation);
      continue;
    }
    if (item.range.start < start) {
      const left = makeRangeAnnotation(
        target,
        source,
        { start: item.range.start, end: start },
        item.annotation.color,
        item.annotation.underline,
      );
      if (left) result.push(left);
    }
    if (item.range.end > end) {
      const right = makeRangeAnnotation(
        target,
        source,
        { start: end, end: item.range.end },
        item.annotation.color,
        item.annotation.underline,
      );
      if (right) result.push(right);
    }
  }

  const boundaries = new Set<number>([start, end]);
  for (const { range } of overlapping) {
    boundaries.add(Math.max(start, range.start));
    boundaries.add(Math.min(end, range.end));
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const selectedSegments = points.slice(0, -1).map((segmentStart, index) => {
    const segmentEnd = points[index + 1];
    const active = overlapping.filter(({ range }) => range.start <= segmentStart && range.end >= segmentEnd);
    return { range: { start: segmentStart, end: segmentEnd }, active };
  });

  const allSelectedTextAlreadyUnderlined = selectedSegments.length > 0 && selectedSegments.every(
    ({ active }) => active.some(({ annotation }) => annotation.underline),
  );
  for (const { range, active } of selectedSegments) {
    if (action.kind === "erase") {
      pushCoalesced(selectionPieces, target, source, range, "none", active.some(({ annotation }) => annotation.underline));
    } else if (action.kind === "color") {
      pushCoalesced(selectionPieces, target, source, range, action.color, active.some(({ annotation }) => annotation.underline));
    } else {
      const color = [...active].reverse().find(({ annotation }) => annotation.color !== "none")?.annotation.color ?? "none";
      const underline = !allSelectedTextAlreadyUnderlined;
      pushCoalesced(selectionPieces, target, source, range, color, underline);
    }
  }

  result.push(...selectionPieces);
  return result;
}

export function isRangeUnderlined(
  annotations: TextAnnotation[],
  target: string,
  source: string,
  selected: TextRange,
): boolean {
  const start = Math.max(0, Math.min(source.length, selected.start));
  const end = Math.max(start, Math.min(source.length, selected.end));
  if (end <= start) return false;
  const ranges = (annotations ?? [])
    .filter((annotation) => annotation.target === target && annotation.underline)
    .flatMap((annotation) => rangesForAnnotation(annotation, source));
  const boundaries = new Set<number>([start, end]);
  for (const range of ranges) {
    if (range.start < end && range.end > start) {
      boundaries.add(Math.max(start, range.start));
      boundaries.add(Math.min(end, range.end));
    }
  }
  const points = [...boundaries].sort((a, b) => a - b);
  return points.slice(0, -1).every((segmentStart, index) => {
    const segmentEnd = points[index + 1];
    return ranges.some((range) => range.start <= segmentStart && range.end >= segmentEnd);
  });
}
