import { describe, expect, it } from "vitest";
import { validatePrediction } from "../src/classification";

const field = (value: string | number | null, probabilities: Record<string, number>) => ({ value, confidence: .95, probabilities, abstention_reason: value === null ? "below_validated_threshold" : null });
const prediction = () => ({ model_version: "baseline-fixture", input_hash: "hash", taxonomy_version: "tax-v1", preprocessing_version: "content-v1", latency_ms: 5,
  domain: field("Algebra", { Algebra: 1 }), skill: field("Linear equations in one variable", { "Linear equations in one variable": 1 }), difficulty: field(3, { "3": 1 }) });

describe("classification output boundary", () => {
  it("accepts valid section-constrained predictions", () => expect(validatePrediction(prediction(), "math", "baseline-fixture")).toBeTruthy());
  it("rejects impossible skill/domain combinations", () => {
    const p = prediction(); p.domain = field("Geometry and Trigonometry", { "Geometry and Trigonometry": 1 });
    expect(() => validatePrediction(p, "math", "baseline-fixture")).toThrow("invalid_taxonomy_pair");
  });
  it("rejects cross-section, stale model, and invalid probabilities", () => {
    expect(() => validatePrediction(prediction(), "reading_writing", "baseline-fixture")).toThrow();
    expect(() => validatePrediction(prediction(), "math", "new-version")).toThrow();
    const p = prediction(); p.skill.probabilities = { "Linear equations in one variable": NaN };
    expect(() => validatePrediction(p, "math", "baseline-fixture")).toThrow();
  });
});
