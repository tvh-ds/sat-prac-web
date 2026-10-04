import { describe, expect, it } from "vitest";
import { emptyAnnotation, strokePath, touchesStroke, validAnnotation, commentSize, commentConnector } from "../../../frontend/src/lib/reviewAnnotations";

describe("review annotation document and geometry", () => {
  const stroke = { points: [[0, 10], [100, 10]] as [number, number][], color: "#c43d4b", width: 3, opacity: 1 };
  it("accepts an editable drawing and plain-text notes", () => {
    expect(validAnnotation({ ...emptyAnnotation(), strokes: [stroke], notes: "<script>plain text</script>" })).toBe(true);
    expect(strokePath(stroke)).toBe("M0.00,10.00 L100.00,10.00");
  });
  it("rejects corrupted, oversized and non-finite coordinates", () => {
    for (const strokes of [[null], [{ ...stroke, points: [[Infinity, 0]] }], [{ ...stroke, color: "url(javascript:alert(1))" }], [{ ...stroke, points: [[961, 0]] }]]) {
      expect(validAnnotation({ ...emptyAnnotation(), strokes })).toBe(false);
    }
    expect(validAnnotation({ ...emptyAnnotation(), notes: "x".repeat(10001) })).toBe(false);
    expect(validAnnotation({ ...emptyAnnotation(), theme: null })).toBe(false);
  });
  it("erases a stroke between its sampled points, without removing distant strokes", () => {
    expect(touchesStroke(stroke, [50, 12])).toBe(true);
    expect(touchesStroke(stroke, [50, 80])).toBe(false);
  });
  it("keeps legacy boards valid and bounds linked comment boxes and highlights", () => {
    const comment = { id: "comment-1", x: 650, y: 800, text: "Plain text", highlights: [{ x: 30, y: 100, width: 200, height: 20 }] };
    expect(validAnnotation({ ...emptyAnnotation(), comments: [comment] })).toBe(true);
    for (const c of [{ ...comment, x: 701 }, { ...comment, y: 821 }, { ...comment, text: "a".repeat(2001) }, { ...comment, highlights: [{ x: 900, y: 100, width: 200, height: 20 }] }]) {
      expect(validAnnotation({ ...emptyAnnotation(), comments: [c] })).toBe(false);
    }
    expect(validAnnotation({ ...emptyAnnotation(), comments: [comment, comment] })).toBe(false);
  });
  it("anchors arrows below the selected words and validates resized comment bounds", () => {
    const c = { id: "resize", x: 500, y: 600, text: "Note", width: 400, height: 300, highlights: [{ x: 100, y: 100, width: 150, height: 25 }] };
    expect(commentSize(c)).toEqual({ width: 400, height: 300 });
    expect(commentConnector(c).y).toBe(133);
    expect(commentConnector(c).path).toContain("175,173 175,133");
    expect(validAnnotation({ ...emptyAnnotation(), comments: [c] })).toBe(true);
    for (const invalid of [{ ...c, width: 601 }, { ...c, width: null }, { ...c, height: 119 }, { ...c, x: 650 }, { ...c, y: 750 }]) {
      expect(validAnnotation({ ...emptyAnnotation(), comments: [invalid] })).toBe(false);
    }
  });
});
