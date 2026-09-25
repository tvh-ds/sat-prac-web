import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFullTest } from "../src/fullTestParser";
import type { PageText } from "../src/extractor";

const fixture = (path: string): PageText[] => {
  const raw = readFileSync(new URL(path, import.meta.url), "utf8");
  return raw
    .split("===== PAGE ")
    .slice(1)
    .map((chunk) => {
      const delimiter = chunk.indexOf("=====");
      return {
        pageNumber: Number(chunk.slice(0, delimiter).trim()),
        text: chunk.slice(delimiter + 5).trim(),
      };
    });
};

const parse = (path: string) => parseFullTest(fixture(path), { contentScope: "full_test" });
const mathInModule = (questions: ReturnType<typeof parse>["questions"], module: string) =>
  questions.filter((q) => q.section === "math" && q.sourceModuleName === module);

describe("saved OCR question-boundary regressions", () => {
  it("keeps the two unnumbered US05 prompts separate and fills the Math Module 1 count", () => {
    const result = parse("../../../Tests Unparsed/post_ocr/2025 09/202509us05.ocr.txt");
    const math1 = mathInModule(result.questions, "Math Module 1");

    expect(result.questions).toHaveLength(98);
    expect(result.modules.map((m) => m.questionCount)).toEqual([27, 27, 22, 22]);
    expect(math1.find((q) => q.sourceQuestionNumber === 9)?.prompt).toMatch(/graph.*value of.*f\(7\)/i);
    expect(math1.find((q) => q.sourceQuestionNumber === 13)?.prompt).toMatch(/triangle.*cos.*length/i);
  });

  it("splits the flattened Asia v1 table question from its following numbered question", () => {
    const result = parse("../../../Tests Unparsed/post_ocr/2025 10/202510asiav1-new.ocr.txt");
    const math2 = mathInModule(result.questions, "Math Module 2");
    const tableQuestion = math2.filter((q) => /table shows three values of x/i.test(q.prompt));
    const followingQuestion = math2.filter((q) => /Hannah and Wyatt are saving money/i.test(q.prompt));
    const cylinderQuestion = math2.filter((q) => /similar solids, right circular cylinder/i.test(q.prompt));
    const triangleQuestion = math2.filter((q) => /In triangle RST/i.test(q.prompt));

    expect(result.questions).toHaveLength(98);
    expect(result.modules.map((m) => m.questionCount)).toEqual([27, 27, 22, 22]);
    expect(tableQuestion).toHaveLength(1);
    expect(followingQuestion).toHaveLength(1);
    expect(cylinderQuestion).toHaveLength(1);
    expect(triangleQuestion).toHaveLength(1);
    expect(tableQuestion[0]!.prompt).not.toContain("Hannah and Wyatt");
    expect(cylinderQuestion[0]!.prompt).not.toContain("In triangle RST");
    expect(triangleQuestion[0]!.prompt).not.toContain("cylinder A");
    expect([tableQuestion[0], followingQuestion[0], cylinderQuestion[0], triangleQuestion[0]]
      .map((q) => q!.sourceQuestionNumber)).toEqual([9, 10, 19, 20]);
  });

  it("keeps the Asia v2 scatterplot and histogram items as separate Math Module 2 questions", () => {
    const result = parse("../../../Tests Unparsed/post_ocr/2025 10/202510asiav2-new.ocr.txt");
    const math2 = mathInModule(result.questions, "Math Module 2");
    const scatterplot = math2.filter((q) => /scatterplot shows the relationship/i.test(q.prompt));
    const histogram = math2.filter((q) => /histogram summarizes the distribution/i.test(q.prompt));

    expect(result.questions).toHaveLength(98);
    expect(result.modules.map((m) => m.questionCount)).toEqual([27, 27, 22, 22]);
    expect(scatterplot).toHaveLength(1);
    expect(histogram).toHaveLength(1);
    expect(scatterplot[0]!.prompt).not.toContain("histogram");
    expect(histogram[0]!.prompt).not.toContain("scatterplot");
  });

  it("keeps a numbered Math grid-in from stealing the next figure question's ID", () => {
    const result = parse("../../../Tests Unparsed/post_ocr/2026 06/202606asiav3.ocr.txt");
    const math2 = mathInModule(result.questions, "Math Module 2");
    const question5 = math2.find((q) => q.prompt.startsWith("5."));
    const question6 = math2.find((q) => /In the figure, line.*parallel to line/i.test(q.prompt));
    const question14 = math2.find((q) => q.prompt.startsWith("14."));
    const question15 = math2.find((q) => /histogram summarizes the distribution/i.test(q.prompt));

    expect(math2).toHaveLength(22);
    expect(question5?.sourceQuestionNumber).toBe(5);
    expect(question6?.sourceQuestionNumber).toBe(6);
    expect(question6?.parseFlags).not.toContain("source_question_id_unresolved");
    expect(question14?.sourceQuestionNumber).toBe(14);
    expect(question15?.sourceQuestionNumber).toBe(15);
    expect(question15?.parseFlags).not.toContain("source_question_id_unresolved");
    expect(result.keyMap.get("Math Module 2|6")?.answer).toBe("B");
    expect(result.keyMap.get("Math Module 2|15")?.answer).toBe("B");
  });

  it("reassigns the two RW Module 2 keys printed below the next Math answer heading", () => {
    const result = parse("../../../Tests Unparsed/post_ocr/2025 03/202503asiav3.ocr.txt");
    const spilled = result.keyEntries.filter((entry) => entry.pageNumber === 32 && [26, 27].includes(entry.questionNumber));

    expect(spilled).toHaveLength(2);
    expect(spilled.every((entry) => entry.moduleName === "Reading and Writing Module 2")).toBe(true);
    expect(result.keyMap.get("Reading and Writing Module 2|26")?.answer).toBe("C");
    expect(result.keyMap.get("Reading and Writing Module 2|27")?.answer).toBe("C");
    expect(result.keyMap.has("Math Module 1|26")).toBe(false);
    expect(result.keyMap.has("Math Module 1|27")).toBe(false);
  });

  it("recognizes shorthand Module 1/Module2 headings without merging the RW modules", () => {
    const result = parse("../../../Tests Unparsed/post_ocr/2025 09/202509asiav4.ocr.txt");
    expect(result.documentFamily).toBe("full_test");
    expect(result.modules.map((m) => [m.name, m.questionCount])).toEqual([
      ["Reading and Writing Module 1", 27],
      ["Reading and Writing Module 2", 27],
      ["Math Module 1", 22],
      ["Math Module 2", 22],
    ]);
    expect(result.keyEntries.filter((key) => key.moduleName === "Reading and Writing Module 1")).toHaveLength(27);
    expect(result.keyEntries.filter((key) => key.moduleName === "Reading and Writing Module 2")).toHaveLength(27);
    expect(result.keyEntries.filter((key) => key.moduleName === "Math Module 1")).toHaveLength(22);
    expect(result.keyEntries.filter((key) => key.moduleName === "Math Module 2")).toHaveLength(22);
    expect(result.questions.some((q) => q.pageNumber === 33)).toBe(false);
    expect(result.keyMap.get("Math Module 2|22")?.answer).toBe("97.5, 195/2");
    expect(result.questions.find((q) => q.sourceModuleName === "Reading and Writing Module 1" && q.sourceQuestionNumber === 13)
      ?.choices.find((choice) => choice.label === "D")?.text).toMatch(/Portuguese verb.*Spanish verb.*influence on/);
  });

  it("does not turn a short final answer-key continuation into questions", () => {
    const result = parse("../../../Tests Unparsed/post_ocr/2025 03/202503asiav1.ocr.txt");
    expect(result.questions).toHaveLength(98);
    expect(result.questions.some((q) => q.pageNumber === 35)).toBe(false);
  });

  const compactOcr = new URL("../tmp/refinement/new-ocr-5be74619-83d9-4847-8f86-1a3c7d3d6aa2.json", import.meta.url);
  it.skipIf(!existsSync(compactOcr))("recovers canonical modules from a heading-less four-column key grid", () => {
    const saved = JSON.parse(readFileSync(compactOcr, "utf8")) as { pages: PageText[] };
    const result = parseFullTest(saved.pages, { contentScope: "full_test" });
    expect(result.documentFamily).toBe("full_test");
    expect(result.modules.map((m) => m.questionCount)).toEqual([27, 27, 22, 22]);
    expect(result.keyEntries).toHaveLength(98);
    expect(result.questions.filter((q) => q.section === "math")).toHaveLength(44);
    const notesQuestion = result.questions.find((q) =>
      q.sourceModuleName === "Reading and Writing Module 2" && q.sourceQuestionNumber === 25);
    expect(notesQuestion?.prompt).toMatch(/student wants to emphasize a similarity between the two sculptures/i);
    expect(notesQuestion?.passageText).toContain("It is crafted from pink neon lighting");
  });

  const compactUsOcr = new URL("../tmp/refinement/new-ocr-1391b5fc-23a1-4b5a-bd26-b719bb0f656c.json", import.meta.url);
  it.skipIf(!existsSync(compactUsOcr))("keeps numbered Math grid-ins in their printed slots in a compact OCR full test", () => {
    const saved = JSON.parse(readFileSync(compactUsOcr, "utf8")) as { pages: PageText[] };
    const result = parseFullTest(saved.pages, { contentScope: "full_test" });
    const math1 = mathInModule(result.questions, "Math Module 1");
    const math2 = mathInModule(result.questions, "Math Module 2");

    expect(result.documentFamily).toBe("full_test");
    expect(result.modules.map((m) => m.questionCount)).toEqual([27, 27, 22, 22]);
    expect(result.questions).toHaveLength(98);
    expect(math1.map((q) => q.sourceQuestionNumber)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
    expect(math2.map((q) => q.sourceQuestionNumber)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
    expect(math1.find((q) => q.sourceQuestionNumber === 12)?.prompt).toMatch(/circle has center.*radius/i);
    expect(math1.find((q) => q.sourceQuestionNumber === 16)?.prompt).toMatch(/quadratic equation.*one real solution/i);
    expect(math1.find((q) => q.sourceQuestionNumber === 18)?.prompt).toMatch(/6x\^2.*exactly one solution/i);
    expect(math2.find((q) => q.sourceQuestionNumber === 16)?.prompt).toMatch(/mass of object A.*mass of object C/i);
    expect(result.keyEntries).toHaveLength(98);
    expect(result.keyMap.size).toBe(98);
  });
});
