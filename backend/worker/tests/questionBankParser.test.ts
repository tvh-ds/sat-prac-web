import { describe, expect, it } from "vitest";
import { looksLikeQuestionBank, parseQuestionBank } from "../src/questionBankParser";

describe("questionBankParser", () => {
  it("detects and parses the R&W bank export format", () => {
    const pages = [
      {
        pageNumber: 1,
        text: [
          "Question ID: f1bfbed3",
          "Assessment Test Domain Skill Difficulty",
          "SAT Reading and Writing Information and Ideas Inferences Hard",
          "Question",
          "Researchers found that species counts differed across surveys, suggesting that ______",
          "Which choice most logically completes the text?",
          "Answer",
          "A. one explanation",
          "B. the best explanation",
          "C. another explanation",
          "D. the wrong explanation",
          "Correct Answer: B",
          "Rationale",
          "Choice B is the best answer.",
        ].join("\n"),
      },
      {
        pageNumber: 2,
        text: [
          "Question ID: 87aa7bab",
          "Assessment Test Domain Skill Difficulty",
          "SAT Reading and Writing Information and Ideas Central Ideas and Details Medium",
          "Question",
          "A passage about portrait miniatures.",
          "Based on the text, what can be concluded about the portraits?",
          "Answer",
          "A. Correct conclusion",
          "B. Wrong conclusion",
          "C. Wrong conclusion",
          "D. Wrong conclusion",
          "Correct Answer: A",
        ].join("\n"),
      },
      {
        pageNumber: 3,
        text: [
          "Question ID: d73a908a",
          "Assessment Test Domain Skill Difficulty",
          "SAT Reading and Writing Craft and Structure Words in Context Easy",
          "Question",
          "A short vocabulary passage.",
          "As used in the text, example most nearly means",
          "Answer",
          "A. sample",
          "B. argument",
          "C. method",
          "D. result",
          "Correct Answer: A",
        ].join("\n"),
      },
    ];

    expect(looksLikeQuestionBank(pages)).toBe(true);
    const result = parseQuestionBank(pages);

    expect(result.errors).toEqual([]);
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0]).toMatchObject({
      sourceQuestionId: "f1bfbed3",
      sourceQuestionNumber: 1,
      pageNumber: 1,
      section: "reading_writing",
      questionType: "multiple_choice",
      domain: "Information and Ideas",
      skill: "Inferences",
      difficulty: 5,
      correctAnswer: "B",
      explanation: "Choice B is the best answer.",
    });
  });

  it("keeps a split inference stem with the prompt, not the passage", () => {
    const result = parseQuestionBank([
      {
        pageNumber: 14,
        text: [
          "Question ID: 458b4a11",
          "Assessment Test Domain Skill Difficulty",
          "SAT Reading and Writing Information and Ideas Central Ideas and Details Hard",
          "Question",
          "To understand temperature change, researchers transplanted plant-soil cores.",
          "It can most reasonably be inferred from the text that the finding about the microorganism community composition was important for which",
          "reason?",
          "Answer",
          "A. It provided preliminary evidence.",
          "B. It suggested a trend.",
          "C. It ruled out an alternative explanation.",
          "D. It clarified activity levels.",
          "Correct Answer: C",
        ].join("\n"),
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.questions[0]!.prompt).toBe(
      "It can most reasonably be inferred from the text that the finding about the microorganism community composition was important for which reason?",
    );
  });

  it("recovers a missing D choice label when the PDF text drops it", () => {
    const result = parseQuestionBank([
      {
        pageNumber: 1177,
        text: [
          "Question ID: e3bbf2bf",
          "Assessment Test Domain Skill Difficulty",
          "SAT Reading and Writing Expression of Ideas Rhetorical Synthesis Easy",
          "Question",
          "While researching a topic, a student has taken the following notes:",
          "The student wants to emphasize a similarity between two groups. Which choice most effectively uses relevant information from the notes to accomplish this goal?",
          "Answer",
          "A. Detail about the first group.",
          "B. Detail about the second group.",
          "C. Both groups transmitted coded military messages.",
          "The first group, not the second group, served earlier.",
          "Correct Answer: C",
        ].join("\n"),
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.questions[0]!.choices.map((c) => c.label)).toEqual(["A", "B", "C", "D"]);
    expect(result.questions[0]!.choices[3]!.text).toBe("The first group, not the second group, served earlier.");
  });

  it("recovers a mid-line stem and joins passage lines without newline artifacts", () => {
    const result = parseQuestionBank([
      {
        pageNumber: 62,
        text: [
          "Question ID: 44c88b8d",
          "Assessment Test Domain Skill Difficulty",
          "SAT Reading and Writing Information and Ideas Command of Evidence Hard",
          "Question",
          "Researchers assigned participants to a positive-feedback condition.",
          "Assuming participants had similar baseline fitness levels, which finding",
          "from the study, if true, would most strongly suggest that positive",
          "feedback had the predicted psychological effect but not the predicted physical effect?",
          "Answer",
          "A. One result.",
          "B. Second result.",
          "C. Third result.",
          "D. Fourth result.",
          "Correct Answer: A",
        ].join("\n"),
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.questions[0]!.prompt).toBe(
      "which finding from the study, if true, would most strongly suggest that positive feedback had the predicted psychological effect but not the predicted physical effect?",
    );
    expect(result.questions[0]!.passageText).toBe(
      "Researchers assigned participants to a positive-feedback condition. Assuming participants had similar baseline fitness levels,",
    );
    expect(result.questions[0]!.passageText!.includes("\n")).toBe(false);
  });

  it("flags graph/table prompts as visual stimulus questions", () => {
    const result = parseQuestionBank([
      {
        pageNumber: 7,
        text: [
          "Question ID: a15b3219",
          "Assessment Test Domain Skill Difficulty",
          "SAT Reading and Writing Information and Ideas Command of Evidence Hard",
          "Question",
          "1,300",
          "1,200",
          "1,100",
          "Number of municipalities",
          "Municipalities' Responses to Inquiries",
          "A team contacted officials in thousands of municipalities.",
          "Which choice best describes data from the graph that weaken the team's hypothesis?",
          "Answer",
          "A. A large majority did not respond.",
          "B. The proportion did not differ substantially.",
          "C. Only around half responded.",
          "D. More than 1,200 did not respond.",
          "Correct Answer: B",
        ].join("\n"),
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.questions[0]!.hasVisualStimulus).toBe(true);
    expect(result.questions[0]!.passageText).toBe("A team contacted officials in thousands of municipalities.");
  });

  it("drops axis labels, legend fragments, and titles but keeps the narrative tail", () => {
    const result = parseQuestionBank([
      {
        pageNumber: 7,
        text: [
          "Question ID: a15b3219",
          "Assessment Test Domain Skill Difficulty",
          "SAT Reading and Writing Information and Ideas Command of Evidence Hard",
          "Question",
          "1,300",
          "1,200",
          "1,100",
          "1,000",
          "900",
          "800",
          "700",
          "600",
          "500",
          "400",
          "300",
          "200",
          "100",
          "0",
          "Number of municipalities",
          "no response",
          "responded to inquiry",
          "offered incentive",
          "Municipalities' Responses to Inquiries",
          "about Potential Incentives for Firm",
          "announcement before election",
          "announcement after election",
          "In the United States, firms often seek incentives from municipal governments to expand to those municipalities. A team of political scientists",
          "hypothesized that municipalities are much more likely to respond to firms and offer incentives if expansions can be announced in time to benefit",
          "local elected officials than if they can't. The team contacted officials in thousands of municipalities, inquiring about incentives for a firm looking",
          "to expand and indicating that the firm would announce its expansion on a date either just before or just after the next election.",
          "Which choice best describes data from the graph that weaken the team's hypothesis?",
          "Answer",
          "A. A large majority did not respond.",
          "B. The proportion did not differ substantially.",
          "C. Only around half responded.",
          "D. More than 1,200 did not respond.",
          "Correct Answer: B",
        ].join("\n"),
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.questions[0]!.hasVisualStimulus).toBe(true);
    expect(result.questions[0]!.passageText).toBe(
      "In the United States, firms often seek incentives from municipal governments to expand to those municipalities. A team of political scientists hypothesized that municipalities are much more likely to respond to firms and offer incentives if expansions can be announced in time to benefit local elected officials than if they can't. The team contacted officials in thousands of municipalities, inquiring about incentives for a firm looking to expand and indicating that the firm would announce its expansion on a date either just before or just after the next election."
    );
  });

  it("leaves passageText null for a pure-bar-chart question with no narrative", () => {
    const result = parseQuestionBank([
      {
        pageNumber: 24,
        text: [
          "Question ID: c77f1a02",
          "Assessment Test Domain Skill Difficulty",
          "SAT Reading and Writing Information and Ideas Command of Evidence Easy",
          "Question",
          "9",
          "8",
          "7",
          "6",
          "5",
          "4",
          "3",
          "2",
          "1",
          "0",
          "Number of lizard species",
          "30–39",
          "40–49",
          "50–59",
          "60–69",
          "70–79",
          "80–89",
          "90–100",
          "Number of Lizard Species by Average Percent of Maximal Speed",
          "escaping pursuing",
          "Which choice most effectively uses data from the graph to complete the text?",
          "Answer",
          "A. More species move at maximal speed while escaping than while pursuing.",
          "B. Species are equally likely to move at maximal speed in either context.",
          "C. Few species ever approach maximal speed.",
          "D. Maximal speed is not an important factor.",
          "Correct Answer: A",
        ].join("\n"),
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.questions[0]!.hasVisualStimulus).toBe(true);
    expect(result.questions[0]!.passageText).toBeNull();
  });
});
