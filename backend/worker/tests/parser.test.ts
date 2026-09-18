import { describe, it, expect } from "vitest";
import { parseQuestions, type ParsedQuestion } from "../src/parser";

const READING_FIXTURE = `
Reading and Writing

Passage for questions 1-2:

The canal system transformed inland trade. Before its construction,
merchants carried goods by wagon along rutted roads, a journey that
took weeks and cost a fortune. When the canal opened, cargo moved
in days and at a fraction of the price, remaking the fortunes of
port cities overnight. Historians still debate whether the economic
boom that followed should be credited to the engineers who built
the canal or to the merchants who rushed to use it.

1. Which choice best states the main idea of the passage?
A. Canals were more expensive to build than roads.
B. The canal system dramatically changed inland commerce.
C. Merchants opposed the construction of canals.
D. Port cities declined after the canal opened.

2. As used in the passage, "rutted" most nearly means
A. paved
B. worn
C. flooded
D. widened

3. The architect designed the building ______ the surrounding
landscape, blending modern materials with traditional forms.
A. to complement
B. for complement
C. at complement
D. of complement
`;

const MATH_FIXTURE = `
Math

1. If 3x + 7 = 22, what is the value of x?
A. 4
B. 5
C. 6
D. 7

2. A rectangle has length 12 and width 5. What is the area?
A. 30
B. 48
C. 60
D. 72

3. If 2(x + 3) = x + 10, what is the value of x?

4. What is the slope of the line y = 2x - 3?
`;

const MIXED_FIXTURE = READING_FIXTURE + "\n\nMath\n\n" + MATH_FIXTURE.split("Math\n\n")[1];

describe("parseQuestions", () => {
  it("parses reading and writing questions with choices", () => {
    const qs = parseQuestions([{ pageNumber: 1, text: READING_FIXTURE }]);
    expect(qs).toHaveLength(3);
    expect(qs[0]).toMatchObject({
      sourceQuestionNumber: 1,
      section: "reading_writing",
      questionType: "multiple_choice",
    });
    expect(qs[0]!.choices).toHaveLength(4);
    expect(qs[0]!.choices[0]).toMatchObject({ label: "A", position: 1 });
    expect(qs[0]!.confidence).toBeGreaterThan(0.5);
  });

  it("detects math student-produced questions when no choices exist", () => {
    const qs = parseQuestions([{ pageNumber: 1, text: MATH_FIXTURE }]);
    expect(qs).toHaveLength(4);
    expect(qs[2]).toMatchObject({ questionType: "student_produced", section: "math" });
    expect(qs[3]).toMatchObject({ questionType: "student_produced" });
  });

  it("handles a combined two-section PDF", () => {
    const qs = parseQuestions([{ pageNumber: 1, text: MIXED_FIXTURE }]);
    const rw = qs.filter((q) => q.section === "reading_writing");
    const math = qs.filter((q) => q.section === "math");
    expect(rw).toHaveLength(3);
    expect(math).toHaveLength(4);
  });

  it("attaches passage text to passage-based questions", () => {
    const qs = parseQuestions([{ pageNumber: 1, text: READING_FIXTURE }]);
    const withPassage = qs.filter((q): q is ParsedQuestion => q.passageText !== null);
    expect(withPassage.length).toBeGreaterThanOrEqual(1);
    expect(withPassage[0]!.passageText).toContain("canal");
  });

  it("ignores answer key sections while parsing questions", () => {
    const text = READING_FIXTURE + "\n\nAnswer Key\n1. B\n2. A\n3. B\n";
    const qs = parseQuestions([{ pageNumber: 1, text }]);
    expect(qs).toHaveLength(3);
    expect(qs.map((q) => q.sourceQuestionNumber)).toEqual([1, 2, 3]);
  });

  it("skips page-number-like lines that are not sequential questions", () => {
    const text = "Math\n\n1. What is 2 + 2?\nA. 3\nB. 4\n\n2026 was a busy year for maritime trade.\n\n3. What is 6 / 2?\nA. 2\nB. 3\n";
    const qs = parseQuestions([{ pageNumber: 1, text }]);
    expect(qs.map((q) => q.sourceQuestionNumber)).toEqual([1]);
  });
});