import { describe, it, expect } from "vitest";
import { parseAnswerKey, answerMap, answerMapGlobal } from "../src/answerKey";

const KEY_PAGES = [
  { pageNumber: 4, text: "Continue" },
  { pageNumber: 5, text: "Answer Key\n1. B\n2. A\n3. D\n4. C\n5. B" },
];

const PAIRED_FIXTURE = { pageNumber: 5, text: "Answer Key\n1 A  2 C\n3 B  4 D\n5 C" };

const MATH_KEY = { pageNumber: 6, text: "Correct Answers\n1. 24\n2. 3/5\n3. -2\n4. 0.25" };

const MISSING_KEY = [{ pageNumber: 5, text: "End of test. Please review your answers." }];

const MODULE_SCOPED_KEY = [
  { pageNumber: 10, text: "Reading and Writing Module 1 Answers\n1 . A\n2 . B\n3 . D\n4 . C\n5 . B" },
  { pageNumber: 11, text: "Math Module 1 Answers\n1 . 24\n2 . 3/5\n3 . -2" },
];

const QUESTIONS_COUNT_KEY = [
  { pageNumber: 12, text: "Answer Key\n33 QUESTIONS\n1. B\n2. A\n3. D" },
];

describe("parseAnswerKey", () => {
  it("parses single-column letter keys", () => {
    const key = parseAnswerKey(KEY_PAGES, 5);
    expect(key.entries).toHaveLength(5);
    expect(key.entries[0]).toMatchObject({ questionNumber: 1, answer: "B", pageNumber: 5 });
    expect(key.confidence).toBeGreaterThan(0.7);
  });

  it("parses paired two-column keys", () => {
    const key = parseAnswerKey([PAIRED_FIXTURE], 5);
    expect(key.entries).toHaveLength(5);
    expect(key.entries[1]).toMatchObject({ questionNumber: 2, answer: "C" });
  });

  it("parses numeric grid-in answers for math", () => {
    const key = parseAnswerKey([MATH_KEY], 4);
    expect(key.entries.map((e) => e.answer)).toEqual(["24", "3/5", "-2", "0.25"]);
    expect(key.confidence).toBeGreaterThan(0.8);
  });

  it("returns empty when no key section exists", () => {
    const key = parseAnswerKey(MISSING_KEY);
    expect(key.entries).toHaveLength(0);
    expect(key.confidence).toBe(0);
  });

  it("parses module-scoped keys with spaced-period entries", () => {
    const key = parseAnswerKey(MODULE_SCOPED_KEY);
    expect(key.entries).toHaveLength(8);
    expect(key.entries[0]).toMatchObject({ questionNumber: 1, answer: "A", moduleName: "Reading and Writing Module 1" });
    expect(key.entries[5]).toMatchObject({ questionNumber: 1, answer: "24", moduleName: "Math Module 1" });
    expect(key.entries[6]).toMatchObject({ questionNumber: 2, answer: "3/5", moduleName: "Math Module 1" });
  });

  it("handles QUESTIONS-COUNT stub that starts a key block", () => {
    const key = parseAnswerKey(QUESTIONS_COUNT_KEY);
    expect(key.entries.length).toBeGreaterThanOrEqual(3);
    expect(key.entries[0]?.answer).toBe("B");
  });

  it("infers the module for a bare Answer Key after a module", () => {
    const key = parseAnswerKey([
      { pageNumber: 1, text: "Math Module 1\n22 QUESTIONS\n1. If x = 2, what is x?\nA. 1\nB. 2" },
      { pageNumber: 2, text: "Answer Key\n1. B\n2. C" },
    ]);
    expect(key.entries).toHaveLength(2);
    expect(key.entries[0]?.moduleName).toBeUndefined();
    expect(key.entries[0]?.inferredModule).toBe("Math Module 1");
  });

  it("recognizes mangled OCR key headings", () => {
    const key = parseAnswerKey([
      { pageNumber: 26, text: "iting Module AnswReading and Wr ers\n1. B\n2. C\n3. A" },
    ]);
    expect(key.entries).toHaveLength(3);
    expect(key.entries[0]).toMatchObject({ questionNumber: 1, answer: "B" });
  });

  it("parses ragged 4-column key tables (27/27/22/22) with grid-ins", () => {
    const rows = [
      "Answer Key",
      "1 C 1 C 1 19 1 B",
      "2 A 2 C 2 D 2 3/2",
      "3 C 3 A 3 D 3 C",
      "4 B 4 A 4 A 4 B",
      "5 B 5 C 5 A 5 -9",
      "6 C 6 D 6 C 6 B",
      "7 C 7 D 7 20 7 A",
      "8 A 8 A 8 A 8 B",
      "9 A 9 C 9 0.18 9 C",
      "10 C 10 B 10 A 10 312",
      "11 D 11 B 11 C 11 D",
      "12 C 12 B 12 13/4 12 A",
      "13 B 13 C 13 B 13 C",
      "14 B 14 A 14 C 14 D",
      "15 B 15 A 15 B 15 2",
      "16 C 16 B 16 100 16 C",
      "17 A 17 A 17 D 17 198.9",
      "18 D 18 A 18 C 18 72/7",
      "19 C 19 C 19 D 19 D",
      "20 A 20 B 20 B 20 D",
      "21 D 21 D 21 D 21 C",
      "22 D 22 C 22 D 22 D",
      "23 B 23 A",
      "24 B 24 C",
      "25 A 25 D",
      "26 C 26 D",
      "27 C 27 B",
    ];
    const key = parseAnswerKey([{ pageNumber: 1, text: rows.join("\n") }], 98);
    expect(key.entries).toHaveLength(98);
    const byCol = new Map<number, typeof key.entries>();
    for (const e of key.entries) {
      const c = e.column ?? -1;
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c)!.push(e);
    }
    expect(byCol.get(0)).toHaveLength(27);
    expect(byCol.get(1)).toHaveLength(27);
    expect(byCol.get(2)).toHaveLength(22);
    expect(byCol.get(3)).toHaveLength(22);
    expect(byCol.get(0)![0]).toMatchObject({ questionNumber: 1, answer: "C" });
    expect(byCol.get(2)![0]).toMatchObject({ questionNumber: 1, answer: "19" });
    expect(byCol.get(3)![1]).toMatchObject({ questionNumber: 2, answer: "3/2" });
    expect(byCol.get(3)![4]).toMatchObject({ questionNumber: 5, answer: "-9" });
    expect(byCol.get(2)![8]).toMatchObject({ questionNumber: 9, answer: "0.18" });
    expect(byCol.get(3)![17]).toMatchObject({ questionNumber: 18, answer: "72/7" });
    expect(byCol.get(3)![16]).toMatchObject({ questionNumber: 17, answer: "198.9" });
  });
});

describe("answerMap", () => {
  it("builds a module-scoped question->answer map", () => {
    const map = answerMap(parseAnswerKey(KEY_PAGES, 5));
    expect(map.get("g|3")).toMatchObject({ answer: "D" });
    expect(map.size).toBe(5);
  });

  it("scopes key entries by module name when present", () => {
    const map = answerMap(parseAnswerKey(MODULE_SCOPED_KEY));
    expect(map.get("Reading and Writing Module 1|1")?.answer).toBe("A");
    expect(map.get("Math Module 1|2")?.answer).toBe("3/5");
  });
});

describe("answerMapGlobal", () => {
  it("builds a legacy global map keyed by question number", () => {
    const map = answerMapGlobal(parseAnswerKey(KEY_PAGES, 5));
    expect(map.get(3)).toMatchObject({ answer: "D" });
  });
});