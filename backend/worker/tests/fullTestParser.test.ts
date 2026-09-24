import { describe, it, expect } from "vitest";
import { parseFullTest } from "../src/fullTestParser";
import { evaluateModuleCompleteness, normalizeSectionHeading, parseScraperQuestions } from "../src/scraperParser";
import { normalizeText } from "../src/textNormalize";

// Format observed in 202605usv1-rw.pdf: "Module 1: Reading and Writing Question N"
const MODULE_HEADER_PREFIXED = `
Module 1: Reading and Writing Question 1

The canal system transformed inland trade. Before its construction,
merchants carried goods by wagon along rutted roads, a journey that
took weeks and cost a fortune.

Which choice best states the main idea of the passage?
A) Canals were more expensive to build than roads.
B) The canal system dramatically changed inland commerce.
C) Merchants opposed the construction of canals.
D) Port cities declined after the canal opened.

Question 2

As used in the passage, "rutted" most nearly means
A) paved
B) worn
C) flooded
D) widened

Module 2: Reading and Writing Question 1

The architect designed the building to complement the surrounding landscape.
Which choice most improves the flow of the sentence?
A) to complement
B) for complement
C) at complement
D) of complement
`;

// Standard Bluebook format with module-scoped answer keys
const STANDARD_BLUEBOOK = `
Reading and Writing Module 1

27 QUESTIONS

1. Which choice best states the main idea of the passage?
A. Canals changed inland commerce.
B. Canals were expensive.
C. Merchants built the canals.
D. Ports declined.

2. As used in the passage, "rutted" most nearly means
A. paved
B. worn
C. flooded
D. widened

Math Module 1

22 QUESTIONS

1. If 3x + 7 = 22, what is the value of x?
A. 4
B. 5
C. 6
D. 7

2. What is 2/5 as a decimal?
A. 0.2
B. 0.4
C. 0.5
D. 2.5

Reading and Writing Module 1 Answers

1 . A
2 . B

Math Module 1 Answers

3 . B
4 . B
`;

describe("parseFullTest", () => {
  it("parses Module N: Section Question N prefixed format", () => {
    const pages = normalizeText([{ pageNumber: 1, text: MODULE_HEADER_PREFIXED }]);
    const result = parseFullTest(pages, { contentScope: "full_test" });

    expect(result.questions.length).toBeGreaterThanOrEqual(3);
    const rw1 = result.questions.filter((q) => q.sourceModuleName.includes("Module 1") && q.section === "reading_writing");
    expect(rw1.length).toBe(2);
    const rw2 = result.questions.filter((q) => q.sourceModuleName.includes("Module 2"));
    expect(rw2.length).toBeGreaterThanOrEqual(1);
  });

  it("parses standard Bluebook format with spaced key entries", () => {
    const pages = normalizeText([{ pageNumber: 1, text: STANDARD_BLUEBOOK }]);
    const result = parseFullTest(pages, { contentScope: "full_test" });

    // Math module 1 - verify section detection
    const math = result.questions.filter((q) => q.section === "math");
    expect(math.length).toBe(2);

    // Verify module-scoped questions have module names
    const rw1 = result.questions.filter((q) => q.sourceModuleName === "Reading and Writing Module 1");
    expect(rw1.length).toBe(2);

    // The answer key map should have entries scoped to "Reading and Writing Module 1" and "Math Module 1"
    // Note: the question numbers in the key (1,2,3,4) repeat across modules since they're per-module.
    // The map uses "moduleName|questionNumber".
    const rwKey = result.keyMap.get("Reading and Writing Module 1|1");
    expect(rwKey?.answer).toBe("A");
  });

  it("filters by content scope: reading_writing only", () => {
    const pages = normalizeText([{ pageNumber: 1, text: STANDARD_BLUEBOOK }]);
    const result = parseFullTest(pages, { contentScope: "reading_writing" });

    const sections = new Set(result.questions.map((q) => q.section));
    expect(sections.has("math")).toBe(false);
    expect(sections.has("reading_writing")).toBe(true);
  });

  it("filters by content scope: math only", () => {
    const pages = normalizeText([{ pageNumber: 1, text: STANDARD_BLUEBOOK }]);
    const result = parseFullTest(pages, { contentScope: "math" });

    const sections = new Set(result.questions.map((q) => q.section));
    expect(sections.has("reading_writing")).toBe(false);
    expect(sections.has("math")).toBe(true);
  });

  it("filters by single module target", () => {
    const pages = normalizeText([{ pageNumber: 1, text: STANDARD_BLUEBOOK }]);
    const result = parseFullTest(pages, { contentScope: "single_module", targetModule: "rw1" });

    expect(result.questions.every((q) => q.sourceModuleName === "Reading and Writing Module 1")).toBe(true);
    expect(result.questions.length).toBe(2);
  });

  it("filters by single math module target", () => {
    const pages = normalizeText([{ pageNumber: 1, text: STANDARD_BLUEBOOK }]);
    const result = parseFullTest(pages, { contentScope: "single_module", targetModule: "math2" });

    // Math2 doesn't exist in fixture, so no questions.
    expect(result.questions).toHaveLength(0);
  });

  it("recognizes College Board Section-prefix headings", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Section: Section 1, Module 1: Reading and Writing,\n1. What is the main idea?\nA. One\nB. Two\n\nSection: Section 2, Module 1: Math,\n1. If x = 1, what is x?\nA. 1\nB. 2",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    const names = result.modules.map((m) => m.name);
    expect(names).toContain("Reading and Writing Module 1");
    expect(names).toContain("Math Module 1");
    const math = result.questions.filter((q) => q.section === "math");
    expect(math.length).toBeGreaterThanOrEqual(1);
  });

  it("records module page ranges and evaluates completeness", () => {
    const pages = normalizeText([
      { pageNumber: 1, text: STANDARD_BLUEBOOK },
      { pageNumber: 2, text: STANDARD_BLUEBOOK },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });

    for (const m of result.modules) {
      expect(m.startPage).toBeGreaterThanOrEqual(1);
      expect(m.endPage).toBeGreaterThanOrEqual(m.startPage);
    }
    const completeness = evaluateModuleCompleteness(result.modules);
    const rw = completeness.find((c) => c.name === "Reading and Writing Module 1");
    expect(rw?.expected).toBe(27);
    expect(rw?.missing).toBe(27 - (rw?.actual ?? 0));
    const math = completeness.find((c) => c.name === "Math Module 1");
    expect(math?.expected).toBe(22);
  });

  it("treats an overfull module as invalid instead of complete", () => {
    const result = evaluateModuleCompleteness([
      { name: "Math Module 1", section: "math", questionCount: 23, startPage: 1, endPage: 20 },
    ]);
    expect(result[0]).toMatchObject({ expected: 22, actual: 23, missing: -1, complete: false });
  });
});

describe("OCR boundary regressions", () => {
  it("keeps adjacent math prompts separate when OCR drops their number markers", () => {
    const firstFourteen = Array.from({ length: 14 }, (_, i) =>
      `${i + 1}. If x + ${i + 1} = 10, what is the value of x?\nA. 1\nB. 2\nC. 3\nD. 4`,
    ).join("\n\n");
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: `Math Module 1\n22 QUESTIONS\n${firstFourteen}\n\n15\nThe given expression is equivalent to $-5x^2 + ax - 3$, where a is a constant. What is the value of a?`,
      },
      {
        pageNumber: 2,
        text: `The kinetic energy K of an object is given by K = (1/2)mv^2. What is the mass of the object?\nA) 9,604\nB) 196\nC) 98\nD) 49\n[figure: a graph of newsletter subscribers over time]\nThe graph models the number of online newsletter subscribers. Which statement best interprets the point (1, 600)?\nA) The estimated number at the end of the first six-month period was 600.\nB) It increased by 600 every six months.\nC) There were 600 subscribers in January 1995.\nD) There were 600 subscribers in January 1996.\n18`,
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    const math = result.questions.filter((q) => q.section === "math");
    const kinetic = math.find((q) => q.prompt.includes("kinetic energy"));
    const newsletter = math.find((q) => q.prompt.includes("newsletter subscribers"));
    expect(kinetic).toBeDefined();
    expect(newsletter).toBeDefined();
    expect(kinetic?.prompt).not.toContain("newsletter");
    expect(newsletter?.prompt).not.toContain("kinetic energy");
    expect(kinetic?.sourceQuestionNumberOrigin).toBe("inferred");
    expect(newsletter?.sourceQuestionNumberOrigin).toBe("inferred");
  });

  it("emits a markerless visual math question instead of dropping its buffered prompt", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: `Math Module 1\n22 QUESTIONS\n1\nWhat is the value of x?\nA) 1\nB) 2\nC) 3\nD) 4\n[figure: a circle centered at the origin]\nCircle A is defined by an equation. What is the value of 4a?\n2\nh(t) = -16t^2 + b. How many seconds until the object hits the ground?`,
      },
    ]);
    const result = parseScraperQuestions(pages);
    expect(result.questions).toHaveLength(3);
    expect(result.questions[1]?.prompt).toContain("Circle A");
    expect(result.questions[1]?.hasVisualStimulus).toBe(true);
  });

  it("coalesces repeated Bluebook screenshots with the same observed question ID", () => {
    const repeated = `1 Mark for Review\nWhich choice best describes the data in the table?\nA. The first choice is long enough to identify the same question.\nB. The second choice is long enough to identify the same question.\nC. The third choice is long enough to identify the same question.\nD. The fourth choice is long enough to identify the same question.\nQuestion 1 of 27`;
    const result = parseScraperQuestions([
      { pageNumber: 1, text: `Reading and Writing Module 1\n${repeated}` },
      { pageNumber: 2, text: repeated },
    ]);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.sourceQuestionNumber).toBe(1);
    expect(result.questions[0]?.parseFlags).toContain("repeated_source_question_coalesced");
    expect(result.modules.find((m) => m.name === "Reading and Writing Module 1")?.questionCount).toBe(1);
  });
});

describe("parseFullTest universal patterns (post-OCR corpus)", () => {
  it("splits markdown modules and reads ** bars", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "# Reading and Writing Module 1\n\n## 27 QUESTIONS\n\n**1**\n\nWhich choice completes the text?\nA) One\nB) Two\n\n**2**\n\nAs used in the text, what does lig mean?\nA) Bind\nB) Cut",
      },
      {
        pageNumber: 2,
        text: "# Reading and Writing Module 2\n\n27 QUESTIONS\n\n1\n\nWhich choice completes the text?\nA) Red\nB) Blue",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    const counts = new Map(result.modules.map((m) => [m.name, m.questionCount]));
    expect(counts.get("Reading and Writing Module 1")).toBe(2);
    expect(counts.get("Reading and Writing Module 2")).toBe(1);
  });

  it("handles Module N: Section headings with ** choices and **Question N** markers", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "# Module 1: Reading and Writing\n\n## Question 1\n\nWhich choice completes the text?\n\n**A.** One\n\n**B.** Two\n\n**Question 2**\n\nAs used in the text, what does lig mean?\n\n**A.** Bind\n\n**B.** Cut",
      },
      { pageNumber: 2, text: "# Module 2: Reading and Writing\n\n# Question 1\n\nWhich choice completes the text?\n\n**A.** Red\n\n**B.** Blue" },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    const counts = new Map(result.modules.map((m) => [m.name, m.questionCount]));
    expect(counts.get("Reading and Writing Module 1")).toBe(2);
    expect(counts.get("Reading and Writing Module 2")).toBe(1);
    expect(result.questions[0]!.choices.map((c) => c.label)).toEqual(["A", "B"]);
    expect(result.questions[0]!.choices[0]!.text).toBe("One");
  });

  it("handles Section N, Module M: Subject headings", () => {
    const pages = normalizeText([
      { pageNumber: 1, text: "Section 1, Module 1: Reading and Writing,\n1. What is the main idea?\nA. One\nB. Two" },
      { pageNumber: 2, text: "# Section 2, Module 1: Math\n1. If x = 1, what is x?\nA. 1\nB. 2" },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    const names = result.modules.map((m) => m.name);
    expect(names).toContain("Reading and Writing Module 1");
    expect(names).toContain("Math Module 1");
  });

  it("reads bare N. bars and skips --- rules", () => {
    const pages = normalizeText([
      {
        pageNumber: 4,
        text: "Math Module 1\n\n1. For the linear function $g$, which defines $g$?\nA. One\nB. Two\n\n---\n\n2.\n$x$ $f(x)$\nFor the linear function $f$, what is $rs$?\n\n---\n\n3. Solve $x(x + 11) = 0$.\nA. One\nB. Two",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(3);
    expect(result.questions[1]!.questionType).toBe("student_produced");
    expect(result.questions[2]!.prompt).not.toMatch(/---/);
  });

  it("attributes heading-less paired columns to modules in order", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Module 1: Reading and Writing\n1. First question here?\nA. One\nB. Two\n\nModule 2: Reading and Writing\n1. Second module question?\nA. Red\nB. Blue",
      },
      { pageNumber: 2, text: "1 C 1 B\n2 D 2 A\n3 B 3 C" },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.keyMap.get("Reading and Writing Module 1|1")?.answer).toBe("C");
    expect(result.keyMap.get("Reading and Writing Module 2|1")?.answer).toBe("B");
    expect(result.keyMap.get("Reading and Writing Module 1|2")?.answer).toBe("D");
    expect(result.keyMap.get("Reading and Writing Module 2|2")?.answer).toBe("A");
    expect(result.keyMap.get("Reading and Writing Module 1|3")?.answer).toBe("B");
    expect(result.keyMap.get("Reading and Writing Module 2|3")?.answer).toBe("C");
  });

  it("parses multi-answer singles and single-module multi-column rows", () => {
    const pages = normalizeText([
      {
        pageNumber: 8,
        text: "Math Module 1 Answers\n1. D\n2. B\n3. 43/3, 14.33\n\nMath Module 2 Answers\n1 A 2 B\n3 C 4 D\n5 20",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.keyMap.get("Math Module 1|3")?.answer).toBe("43/3, 14.33");
    expect(result.keyMap.get("Math Module 2|1")?.answer).toBe("A");
    expect(result.keyMap.get("Math Module 2|4")?.answer).toBe("D");
    expect(result.keyMap.get("Math Module 2|5")?.answer).toBe("20");
    expect(result.keyMap.get("g|2")).toBeUndefined();
  });

  it("parses pipe rows with LaTeX numberless answers", () => {
    const pages = normalizeText([
      {
        pageNumber: 50,
        text: "# Math Module 1 Answers\n\n1 A | 2 C | 3 B | $4 \\frac{4}{31}$ | 5 D",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.keyMap.get("Math Module 1|1")?.answer).toBe("A");
    expect(result.keyMap.get("Math Module 1|4")?.answer).toBe("4 4/31");
    expect(result.keyMap.get("Math Module 1|5")?.answer).toBe("D");
  });

  it("drops student-produced directions without consuming numbers", () => {
    const pages = normalizeText([
      {
        pageNumber: 20,
        text: "Math Module 1\n\n22 QUESTIONS\n\n# Question 4\n\n**Student-produced response directions**\n\n* If you find **more than one correct answer**, enter only one answer.\n* You can enter up to 5 characters for a **positive** answer.\n\n$y = -0.5$\n\n# Question 5\n\nWhich expression is equivalent?\nA. One\nB. Two",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]!.prompt).toContain("y = -0.5");
    expect(result.questions[0]!.prompt).not.toMatch(/directions/i);
    expect(result.questions[1]!.prompt).toContain("Which expression");
  });

  it("resyncs bars after dropped number lines", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Math Module 1\n\n22 QUESTIONS\n\n1\n\nFirst prompt here?\nA. One\nB. Two\n\n2\n\nSecond prompt here?\nA. One\nB. Two",
      },
      {
        pageNumber: 2,
        text: "10\n\nTenth prompt here?\nA. One\nB. Two\n\n11\n\nEleventh prompt here?\nA. One\nB. Two",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    // bars 3-9 missing: resync at 10 via lookahead confirmation
    expect(result.questions).toHaveLength(4);
    expect(result.questions[2]!.prompt).toContain("Tenth");
  });

  it("splits a choiceless prompt from a following visual question, not a lead-in", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Math Module 1\n\n22 QUESTIONS\n\n1\n\nWhat is the value of k?\n\n[figure: The graph shows height over time.]\n\nThe graph shows height over time. Which statement is best?\nA. One\nB. Two",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[1]!.prompt).toContain("Which statement");
  });

  it("renumbers bank compilations by printed prefix and matches keys safely", () => {
    const lines: string[] = [];
    for (let n = 321; n <= 326; n++) {
      lines.push(`**${n}** Which choice completes the text?\nA) One\nB) Two`);
    }
    lines.push("321 C 322 A\n323 B 324 D\n325 A 326 B");
    const pages = normalizeText([{ pageNumber: 1, text: lines.join("\n") }]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    // bank mode: section pool, printed numbers, keys by printed number
    expect(result.modules[0]!.name).toMatch(/Question Bank/);
    const q321 = result.questions.find((q) => q.sourceQuestionNumber === 321);
    expect(q321).toBeDefined();
    expect(q321!.prompt).not.toMatch(/^\*\*321\*\*/);
    expect(result.keyMap.get(`${q321!.sourceModuleName}|321`)?.answer).toBe("C");
    // unnumbered questions never auto-match
    const stray = result.questions.filter((q) => q.sourceQuestionNumber === -1);
    for (const q of stray) {
      expect(result.keyMap.get(`${q.sourceModuleName}|-1`)).toBeUndefined();
    }
  });

  it("restarts runs for consecutive heading-less single blocks", () => {
    const q = (n: number) => `${n}. Question number ${n} here?\nA. One\nB. Two`;
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: `Module 1: Reading and Writing\n${q(1)}\n\n${q(2)}\n\n${q(3)}\n\nModule 2: Reading and Writing\n${q(1)}\n\n${q(2)}\n\n${q(3)}`,
      },
      { pageNumber: 2, text: "1. B\n2. C\n3. D\n\n1. A\n2. B\n3. C" },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    // Both blocks parsed and attributed in order, not swallowed or merged.
    expect(result.keyMap.get("Reading and Writing Module 1|1")?.answer).toBe("B");
    expect(result.keyMap.get("Reading and Writing Module 1|3")?.answer).toBe("D");
    expect(result.keyMap.get("Reading and Writing Module 2|1")?.answer).toBe("A");
    expect(result.keyMap.get("Reading and Writing Module 2|3")?.answer).toBe("C");
  });

  it("ignores index stubs but honors repeat headings with content", () => {
    const stub = normalizeText([
      { pageNumber: 1, text: "Math Module 1\n\n22 QUESTIONS\n\nMath Module 2\n\n1. First real question?\nA. One\nB. Two" },
    ]);
    const stubRes = parseFullTest(stub, { contentScope: "full_test" });
    expect(stubRes.modules.map((m) => m.name)).toEqual(["Math Module 2"]);

    const repeat = normalizeText([
      {
        pageNumber: 1,
        text: "Section 2, Module 1: Math\n\n1 Mark for Review\n\nDirections\n\nHide\n\nCalculator Reference More\n\nMark for Review\n\nIn triangle ABC, what is angle C?\n\nA 34\nB 56\nC 60\nD 90\n\nQuestion 1 of 22",
      },
      { pageNumber: 2, text: "Section 2, Module 1: Math\n\n2 Mark for Review\n\n1. Second question here?\nA. One\nB. Two" },
    ]);
    const repeatRes = parseFullTest(repeat, { contentScope: "full_test" });
    expect(repeatRes.modules.map((m) => m.name)).toEqual(["Math Module 1"]);
    expect(repeatRes.questions).toHaveLength(2);
  });

  it("does not mistake graph ticks for keys after a count stub", () => {
    const pages = normalizeText([
      {
        pageNumber: 13,
        text: "# Reading and Writing Module 2\n\n27 QUESTIONS\n\n1. Which choice completes the text?\nA. One\nB. Two",
      },
      { pageNumber: 14, text: "11\n12\nSome graph axis leftovers with no key meaning." },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.keyEntries).toHaveLength(0);
  });

  it("preserves math equations verbatim in prompts and choices", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Math Module 1\n\n22 QUESTIONS\n\n1\n\nWhich expression is equivalent to $(8yz)(y)(3z)$?\nA. $24y^2z^2$\nB. $24y^2z$\n\n2\n\nThe function f is defined by $f(x) = x^2 + 86$. What is the value of $f(x)$ when $x = 10$?\nA. 186\nB. 96\n\n3\n\nIf $x = \\sqrt[2n]{7x^n + 30}$ where n is a positive integer, what is $x^n$?\nA. 5\nB. 6",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0]!.prompt).toContain("$(8yz)(y)(3z)$");
    expect(result.questions[0]!.choices[0]!.text).toContain("$24y^2z^2$");
    expect(result.questions[1]!.prompt).toContain("$f(x) = x^2 + 86$");
    expect(result.questions[2]!.prompt).toContain("\\sqrt");
  });

  it("strips figure descriptions from passages and flags the visual block", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Reading and Writing Module 1\n\n27 QUESTIONS\n\nPrices of Nuts Sold by Growers\n\n[figure: The chart displays price per pound on the y-axis ranging from 0 to 3, with pistachios, hazelnuts, and walnuts compared across four seasons in great detail.]\n\nNut growers in the United States sold their harvest at varying prices over several seasons, with pistachios commanding the highest values and walnuts remaining relatively affordable for consumers everywhere.\n\nWhich choice best states the main idea of the passage?\nA. One\nB. Two",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.passageText ?? "").not.toContain("[figure");
    expect(result.questions[0]!.passageText ?? "").not.toContain("figure:");
    expect(result.questions[0]!.passageText ?? "").toContain("pistachios");
    expect(result.questions[0]!.prompt).not.toContain("[figure");
    expect(result.questions[0]!.hasVisualStimulus).toBe(true);
  });

  it("removes long figure descriptions from math prompts without a placeholder", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Math Module 1\n\n22 QUESTIONS\n\n1\n\n[figure: The graph shows a function with a local maximum at (0, 10) and a local minimum at (6, -30) with axes and gridlines described at length.]\n\nThe y-intercept of the graph shown is $(0, y)$. What is the value of y?\nA. 10\nB. -30",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.prompt).not.toContain("local maximum");
    expect(result.questions[0]!.prompt).not.toContain("[figure");
    expect(result.questions[0]!.prompt).not.toContain("figure:");
    expect(result.questions[0]!.prompt).toContain("$(0, y)$");
    expect(result.questions[0]!.hasVisualStimulus).toBe(true);
  });

  it("strips markers wedged between choices and still flags the visual", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Math Module 1\n\n22 QUESTIONS\n\n1\n\nWhich value is shown?\nA. is\n[figure: A small color bar associated with the answer.]\nB. were",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(1);
    const q = result.questions[0]!;
    expect(q.choices).toHaveLength(2);
    expect(q.choices.map((c) => c.text).join(" ")).not.toContain("[figure");
    expect(q.hasVisualStimulus).toBe(true);
  });

  it("flags visual answer options while removing their marker text", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Math Module 1\n\n22 QUESTIONS\n\n1\n\nWhich graph shows the line?\nA. Rises\nB [figure: The graph shows a line with positive slope and labeled axes in detail.]",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(1);
    const q = result.questions[0]!;
    expect(q.choices).toHaveLength(2);
    expect(q.choices[1]!.text).not.toContain("[figure");
    expect(q.hasVisualStimulus).toBe(true);
  });

  it("standardizes section headings and discards trailing metadata", () => {
    expect(normalizeSectionHeading("# Section: Section 1, Module 1: Reading and Writing, Difficulty: unknown (27 questions)")).toBe(
      "Section 1, Module 1: Reading and Writing",
    );
    expect(normalizeSectionHeading("## Section: Section 2, Module 1: Math, Difficulty: hard (22 questions)")).toBe(
      "Section 2, Module 1: Math",
    );
    expect(normalizeSectionHeading("Section: Section 1, Module 2: Reading and Writing,")).toBe(
      "Section 1, Module 2: Reading and Writing",
    );
    expect(normalizeSectionHeading("Section 2, Module 1: Math")).toBe("Section 2, Module 1: Math");
    expect(normalizeSectionHeading("Which choice completes the text?")).toBeNull();
  });

  it("splits metadata section headings into four modules with column keys", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "# Section: Section 1, Module 1: Reading and Writing, Difficulty: unknown (27 questions)\n\n1. First RW question here?\nA. One\nB. Two\n\n2. Second RW question here?\nA. One\nB. Two",
      },
      {
        pageNumber: 2,
        text: "# Section: Section 1, Module 2: Reading and Writing, Difficulty: hard (27 questions)\n\n1. Third RW question here?\nA. One\nB. Two",
      },
      {
        pageNumber: 3,
        text: "## Section: Section 2, Module 1: Math, Difficulty: unknown (22 questions)\n\n1. First math question here?\nA. 1\nB. 2",
      },
      {
        pageNumber: 4,
        text: "# Section: Section 2, Module 2: Math, Difficulty: hard (22 questions)\n\n1. Second math question here?\nA. 3\nB. 4\n\nAnswer Key\n1 C 1 A 1 19 1 B\n2 D 2 B 2 7 2 5",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.modules.map((m) => m.name)).toEqual([
      "Reading and Writing Module 1",
      "Reading and Writing Module 2",
      "Math Module 1",
      "Math Module 2",
    ]);
    expect(result.modules.map((m) => m.name)).not.toContain("Question Bank – Reading and Writing");
    expect(result.questions).toHaveLength(5);
    expect(result.keyMap.get("Reading and Writing Module 1|1")?.answer).toBe("C");
    expect(result.keyMap.get("Reading and Writing Module 1|2")?.answer).toBe("D");
    expect(result.keyMap.get("Reading and Writing Module 2|1")?.answer).toBe("A");
    expect(result.keyMap.get("Math Module 1|1")?.answer).toBe("19");
    expect(result.keyMap.get("Math Module 1|2")?.answer).toBe("7");
    expect(result.keyMap.get("Math Module 2|1")?.answer).toBe("B");
    expect(result.keyMap.get("Math Module 2|2")?.answer).toBe("5");
  });

  it("flags only the question block that owns the visual marker", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Math Module 1\n\n22 QUESTIONS\n\n1\n\nIf $x + 5 = 95$, what value of $x$ is the solution to the given equation?\nA. 90\nB. 100\n\n2\n\n[figure: The graph shows height above ground in meters versus time in seconds with axes and gridlines described at length.]\n\nThe graph shows height over time. Which statement is best supported by the data?\nA. One\nB. Two",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]!.hasVisualStimulus).toBe(false);
    expect(result.questions[0]!.prompt).not.toContain("[figure");
    expect(result.questions[1]!.hasVisualStimulus).toBe(true);
    expect(result.questions[1]!.prompt).not.toContain("[figure");
    expect(result.questions[1]!.prompt).toContain("Which statement is best");
  });

  it("splits an instruction-first R&W block at the question mark (blank passage)", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Reading and Writing Module 1\n\n27 QUESTIONS\n\n1\n\nWhich choice completes the text with the most logical and precise word or phrase?\n\nA study by Augusta D. Gaspar and Joana Carneiro Pinto found that a bank's corporate social responsibility efforts, including environmental and social campaigns, improve its corporate image. When CSR was mentioned in bank marketing strategies, favorability scores assigned by study participants tended to ______ the scores assigned by participants when CSR was not mentioned at all.\nA. exceed\nB. match\nC. reduce\nD. ignore",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(1);
    const q = result.questions[0]!;
    expect(q.prompt).toBe("Which choice completes the text with the most logical and precise word or phrase?");
    expect(q.passageText ?? "").toContain("A study by Augusta D. Gaspar");
    expect(q.passageText ?? "").toContain("______");
    expect(q.choices).toHaveLength(4);
  });

  it("splits instruction-first R&W blocks even when the passage has no blank", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Reading and Writing Module 1\n\n27 QUESTIONS\n\n1\n\nWhich choice best states the main idea of the passage?\n\nMarine biologists have long debated whether deep sea trenches host unique ecosystems that differ substantially from surrounding abyssal plains in species composition and overall ecological productivity today, according to several recent published research papers.\nA. Trenches are unique\nB. Plains are richer\nC. No difference exists\nD. More study is needed",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(1);
    const q = result.questions[0]!;
    expect(q.prompt).toBe("Which choice best states the main idea of the passage?");
    expect(q.passageText ?? "").toContain("Marine biologists");
  });

  it("keeps note-taking bullets in the passage with the prompt separate", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Reading and Writing Module 1\n\n27 QUESTIONS\n\n1\n\nWhile researching a topic, a student has taken the following notes:\n* Atoms in a solid state are ordered and cannot move freely in any direction at all.\n* Under high pressure and heat, potassium forms an unusual dual structure with host and guest atoms.\n* Chain melt was determined to be a stable and fully distinct state of matter today.\n\nThe student wants to summarize the study. Which choice most effectively uses relevant information from the notes to accomplish this goal?\nA. One\nB. Two\nC. Three\nD. Four",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(1);
    const q = result.questions[0]!;
    expect(q.prompt).toBe("The student wants to summarize the study. Which choice most effectively uses relevant information from the notes to accomplish this goal?");
    expect(q.passageText ?? "").toContain("* Atoms in a solid state");
    expect(q.passageText ?? "").toContain("While researching a topic");
  });

  it("normalizes escaped blank runs in passages (CSR case)", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Reading and Writing Module 1\n\n27 QUESTIONS\n\n1\n\nWhich choice completes the text with the most logical and precise word or phrase?\n\nA study by Augusta D. Gaspar and Joana Carneiro Pinto found that a bank's corporate social responsibility efforts, including environmental and social campaigns, improve its corporate image. When CSR was mentioned in bank marketing strategies, favorability scores assigned by study participants tended to \\_\\_\\_\\_\\_\\_ the scores assigned by participants when CSR was not mentioned at all.\nA. exceed\nB. match\nC. reduce\nD. ignore",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(1);
    const q = result.questions[0]!;
    expect(q.prompt).toBe("Which choice completes the text with the most logical and precise word or phrase?");
    expect(q.passageText ?? "").toContain("______");
    expect(q.passageText ?? "").not.toContain("\\_");
    expect(q.choices).toHaveLength(4);
  });

  it("drops a trailing bold fence when the prompt is wrapped in **", () => {
    const pages = normalizeText([
      {
        pageNumber: 1,
        text: "Reading and Writing Module 1\n\n27 QUESTIONS\n\n1\n\n**Which choice completes the text with the most logical and precise word or phrase?**\n\nResearchers studied honeybee navigation across several seasons and recorded detailed flight paths showing remarkable consistency in orientation behavior over very long distances traveled daily during extensive fieldwork observations.\nA. One\nB. Two\nC. Three\nD. Four",
      },
    ]);
    const result = parseFullTest(pages, { contentScope: "full_test" });
    expect(result.questions).toHaveLength(1);
    const q = result.questions[0]!;
    expect(q.prompt.endsWith("?")).toBe(true);
    expect(q.prompt).not.toContain("**");
    expect(q.passageText ?? "").toContain("Researchers studied honeybee");
  });
});
