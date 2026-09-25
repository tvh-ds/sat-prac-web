import { describe, expect, it } from "vitest";
import type { ImportReadiness } from "../../supabase/functions/_shared/importReadiness";
import { readinessPromotionDecision } from "../src/refinementReadiness";

const moduleNames = ["Reading and Writing Module 1", "Reading and Writing Module 2", "Math Module 1", "Math Module 2"];
function metric(status: "complete" | "partial", actual: number, counts: number[]) {
  return {
    status,
    actual,
    expected: 98 as const,
    matchedQuestions: actual,
    modules: moduleNames.map((name, i) => ({ name, actual: counts[i]!, expected: i < 2 ? 27 : 22, inferred: false })),
    details: [],
  };
}
function readiness(keyStatus: "complete" | "partial", keyModuleCounts = [27, 27, 22, 20]): ImportReadiness {
  return {
    questions: metric("complete", 98, [27, 27, 22, 22]),
    answer_key: metric(keyStatus, 98, keyModuleCounts),
  };
}

describe("readinessPromotionDecision", () => {
  it("allows a source-verified status gain when total rows are unchanged", () => {
    const before = readiness("partial", [27, 27, 22, 22]);
    const after = readiness("complete", [27, 27, 22, 22]);
    expect(before.answer_key.actual).toBe(after.answer_key.actual);
    expect(readinessPromotionDecision(before, after)).toEqual({
      allowed: true,
      reason: "readiness improved without a count or status regression",
    });
  });

  it("rejects a module regression even when the aggregate status improves", () => {
    const before = readiness("partial");
    const after = readiness("complete", [27, 27, 21, 23]);
    expect(readinessPromotionDecision(before, after)).toMatchObject({ allowed: false, reason: expect.stringContaining("Math Module 1 fell") });
  });

  it("rejects an unchanged replay", () => {
    const unchanged = readiness("partial");
    expect(readinessPromotionDecision(unchanged, unchanged)).toEqual({ allowed: false, reason: "no measured readiness improvement" });
  });

  it("allows a computed overflow bucket to disappear when exact modules absorb it", () => {
    const before = readiness("partial");
    before.questions = metric("partial", 91, [27, 27, 22, 0]);
    before.questions.modules.push({ name: "More than two Reading and Writing modules were detected.", actual: 15, expected: 0, inferred: true });
    const after = readiness("complete", [27, 27, 22, 22]);
    expect(readinessPromotionDecision(before, after).allowed).toBe(true);
  });

  it("allows only source-verified duplicate crop removal into an exact module", () => {
    const before = readiness("partial");
    before.questions = metric("partial", 100, [27, 28, 23, 22]);
    const after = readiness("partial");
    expect(readinessPromotionDecision(before, after).allowed).toBe(false);
    expect(readinessPromotionDecision(before, after, 1).allowed).toBe(false);
    expect(readinessPromotionDecision(before, after, 2).allowed).toBe(true);
  });
});
