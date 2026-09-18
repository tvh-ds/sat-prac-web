import { describe, it, expect } from "vitest";
import { normalizeTextString, hasSpacedText, normalizeText } from "../src/textNormalize";

describe("normalizeTextString", () => {
  it("fixes spaced-out question words", () => {
    expect(normalizeTextString("Q u e st i on 1")).toBe("Question 1");
    expect(normalizeTextString("Q u e st i on 2")).toBe("Question 2");
  });

  it("fixes spaced-out module headings", () => {
    expect(normalizeTextString("R eading and W riting Module 1")).toBe("Reading and Writing Module 1");
    expect(normalizeTextString("M ath Module 2")).toBe("Math Module 2");
  });

  it("normalizes choice markers", () => {
    expect(normalizeTextString("A) first\nB) second")).toBe("A. first\nB. second");
    expect(normalizeTextString("A) first")).toBe("A. first");
    expect(normalizeTextString("A . first\nB . second")).toBe("A. first\nB. second");
  });

  it("normalizes key entries with spaced periods", () => {
    expect(normalizeTextString("1 . A\n2 . B\n3 . 24")).toBe("1. A\n2. B\n3. 24");
  });

  it("splits Module N: Section Question N format", () => {
    const normalized = normalizeTextString("Module 1: Reading and Writing Question 1");
    expect(normalized).toBe("Reading and Writing Module 1\nQuestion 1");
  });

  it("splits Module N: Math Question N", () => {
    const normalized = normalizeTextString("Module 1: Math Question 5");
    expect(normalized).toBe("Math Module 1\nQuestion 5");
  });

  it("converts Module N: Section to heading format", () => {
    expect(normalizeTextString("Module 2: Reading and Writing")).toBe("Reading and Writing Module 2");
  });

  it("collapses repeated escaped-underscore blanks, preserving length", () => {
    expect(normalizeTextString("tended to \\_\\_\\_\\_\\_\\_ the scores")).toBe("tended to ______ the scores");
    expect(normalizeTextString("a \\_\\_\\_ b")).toBe("a ___ b");
  });

  it("keeps standalone escaped underscores and LaTeX backslashes", () => {
    expect(normalizeTextString("a \\_ b")).toBe("a \\_ b");
    expect(normalizeTextString("If $x = \\frac{1}{2}$ then y")).toBe("If $x = \\frac{1}{2}$ then y");
    expect(normalizeTextString("What is $\\sqrt{16}$?")).toBe("What is $\\sqrt{16}$?");
  });
});

describe("hasSpacedText", () => {
  it("detects spaced text", () => {
    expect(hasSpacedText("Q u e st i on 1")).toBe(true);
  });
  it("does not flag normal text", () => {
    expect(hasSpacedText("Question 1 is a normal sentence.")).toBe(false);
  });
});

describe("normalizeText", () => {
  it("normalizes all pages", () => {
    const pages = [
      { pageNumber: 1, text: "Q u e st i on 1\nA) a\nB) b" },
      { pageNumber: 2, text: "1 . A\n2 . B" },
    ];
    const out = normalizeText(pages);
    expect(out[0]!.text).toContain("Question 1");
    expect(out[0]!.text).toContain("A. a");
    expect(out[1]!.text).toContain("1. A");
  });
});