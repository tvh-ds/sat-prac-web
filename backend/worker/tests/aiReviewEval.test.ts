import { describe, expect, it } from "vitest";
import { evaluateIngestion, rate, type EvaluationRun, type GoldQuestion } from "../src/aiReviewEval";

const gold: GoldQuestion[] = [{
  id: "q1", documentId: "test-a", section: "math", visual: false, scanType: "selectable_text",
  prompt: "What is x?", passage: null, choices: ["1", "2", "3", "4"], answer: "B",
  issues: [{ issueType: "answer_key_conflict", severity: "major", field: "suggested_answer", sourcePage: 9 }],
}];

const run: EvaluationRun = {
  runId: "candidate-1", gitCommit: "abc123", createdAt: "2026-09-27T00:00:00Z", model: "review-model",
  promptVersion: "v1", riskPolicyVersion: "v1",
  questions: [{
    id: "q1", prompt: "What is x?", passage: null, choices: ["1", "2", "3", "4"], answer: "B",
    reviewState: "review", findings: [{ issueType: "answer_key_conflict", severity: "major", field: "suggested_answer", sourcePage: 9 }],
  }],
};

describe("AI ingestion evaluation", () => {
  it("reports exact extraction and serious issue detection", () => {
    const result = evaluateIngestion(gold, run);
    expect(result.extraction.questionRecall!.value).toBe(1);
    expect(result.extraction.answerKeyAccuracy!.value).toBe(1);
    expect(result.review.seriousIssueRecall!.value).toBe(1);
    expect(result.review.seriousDefectCompleteRate!.denominator).toBe(0);
  });

  it("uses Wilson intervals and preserves empty denominators", () => {
    expect(rate(0, 0).value).toBeNull();
    const interval = rate(5, 10).ci95!;
    expect(interval[0]).toBeLessThan(0.5);
    expect(interval[1]).toBeGreaterThan(0.5);
  });
});
