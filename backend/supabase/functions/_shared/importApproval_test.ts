import { importApprovalWarnings } from "./importApproval.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("ready imports have no approval warnings", () => {
  const warnings = importApprovalWarnings([{
    review_state: "complete", status: "approved", suggested_answer: "B",
    has_visual_stimulus: true, stimulus_crop_status: "confirmed",
    question_type: "multiple_choice", choices: [{}, {}, {}, {}],
  }], "passed", null);
  assert(warnings.length === 0, JSON.stringify(warnings));
});

Deno.test("all missing quality requirements are reported together", () => {
  const warnings = importApprovalWarnings([{
    review_state: "failed", status: "rejected", suggested_answer: "  ",
    has_visual_stimulus: true, stimulus_crop_status: null,
    question_type: "multiple_choice", choices: [],
  }], "failed", "Module counts differ");
  for (const text of ["Structural", "not Complete", "no usable answer", "unconfirmed crops", "rejected", "fewer than two choices", "Module counts differ"]) {
    assert(warnings.some((w) => w.includes(text)), `Missing warning: ${text}`);
  }
});

Deno.test("missing review results and empty imports produce warnings", () => {
  const warnings = importApprovalWarnings([], null, null);
  assert(warnings.some((w) => w.includes("Structural")), "Missing structural warning");
  assert(warnings.some((w) => w.includes("No questions")), "Missing empty warning");
});

Deno.test("text questions do not require crops or choices", () => {
  assert(importApprovalWarnings([{
    review_state: "complete", status: "needs_review", suggested_answer: "0",
    question_type: "numeric", has_visual_stimulus: false,
  }], "passed", null).length === 0, "Unexpected warning for a text question");
});
