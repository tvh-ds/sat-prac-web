import { describe, expect, it } from "vitest";
import { extractModuleScopedAnswerKeys, normalizeChoiceForPreservation, oldChoiceTextsPreserved, sourceAnswersEquivalent, sourceEvidenceIncludes } from "../src/refinementSourceAudit";

describe("refinement source audit helpers", () => {
  it("collects canonical answer-key modules across OCR page boundaries", () => {
    const pages = [
      { pageNumber: 30, text: "# Reading and Writing Module 1 Answers\n1. D\n2. A\n# Reading and Writing Module 2 Answers\n1. A" },
      { pageNumber: 31, text: "# Math Module 1 Answers\n1. 62\n2. D\n# Math Module 2 Answers\n1. B" },
    ];
    const keys = extractModuleScopedAnswerKeys(pages);
    expect(keys.exact).toBe(false); // short fixture, but scopes must be retained
    expect(keys.columns).toEqual([2, 1, 2, 1]);
    expect(keys.answersByModule.get("Reading and Writing Module 1")).toEqual(["D", "A"]);
    expect(keys.sequencesByModule.get("Reading and Writing Module 1")).toEqual([1, 2]);
    expect(keys.answersByModule.get("Math Module 1")).toEqual(["62", "D"]);
  });

  it("reattributes keys 26–27 when an OCR heading appears before the final RW2 answers", () => {
    const rw1 = Array.from({ length: 27 }, (_, i) => `${i + 1}. A`).join("\n");
    const rw2First25 = Array.from({ length: 25 }, (_, i) => `${i + 1}. B`).join("\n");
    const math1 = Array.from({ length: 22 }, (_, i) => `${i + 1}. C`).join("\n");
    const math2 = Array.from({ length: 22 }, (_, i) => `${i + 1}. D`).join("\n");
    const keys = extractModuleScopedAnswerKeys([
      { pageNumber: 1, text: `# Reading and Writing Module 1 Answers\n${rw1}\n# Reading and Writing Module 2 Answers\n${rw2First25}` },
      { pageNumber: 2, text: `26. C\n27. C\n# Math Module 1 Answers\n${math1}\n# Math Module 2 Answers\n${math2}` },
    ]);
    expect(keys.exact).toBe(true);
    expect(keys.columns).toEqual([27, 27, 22, 22]);
    expect(keys.answersByModule.get("Reading and Writing Module 2")?.slice(-2)).toEqual(["C", "C"]);
    expect(keys.answersByModule.get("Math Module 1")?.slice(0, 2)).toEqual(["C", "C"]);
  });

  it("matches source choices split over adjacent OCR pages", () => {
    expect(sourceEvidenceIncludes([
      "Choice D ends with a low",
      "percentage of shoreline coverage.",
    ], "Choice D ends with a low percentage of shoreline coverage.")).toBe(true);
  });

  it("ignores saved-OCR visual arrows when checking choice preservation", () => {
    expect(normalizeChoiceForPreservation("A) 7x^2 ↔ (x^4 − 2)↔"))
      .toBe(normalizeChoiceForPreservation("A) 7x^2 (x^4 − 2)"));
  });

  it("does not report a corrected non-empty choice as loss of a previously blank choice", () => {
    expect(oldChoiceTextsPreserved(
      [{ label: "A", text: "A preserved non-empty choice." }, { label: "D", text: "" }],
      [{ label: "A", text: "A preserved non-empty choice." }, { label: "D", text: "Newly recovered source text." }],
    )).toBe(true);
    expect(oldChoiceTextsPreserved(
      [{ label: "A", text: "A preserved non-empty choice." }],
      [{ label: "A", text: "" }],
    )).toBe(false);
  });

  it("compares equivalent math answer forms without mistaking LaTeX commands for content", () => {
    expect(sourceAnswersEquivalent("$1/4 \\mid 0.25$", "1/4, 0.25")).toBe(true);
  });
});
