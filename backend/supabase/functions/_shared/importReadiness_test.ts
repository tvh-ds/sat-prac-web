import { summarizePdfImportReadiness, type ImportReadinessDraft } from "./importReadiness.ts";

const moduleSpecs = [
  { name: "Reading and Writing Module 1", section: "reading_writing", count: 27 },
  { name: "Reading and Writing Module 2", section: "reading_writing", count: 27 },
  { name: "Math Module 1", section: "math", count: 22 },
  { name: "Math Module 2", section: "math", count: 22 },
] as const;

function draftsForCounts(counts: number[], options: { modules?: boolean; keyed?: boolean } = {}): ImportReadinessDraft[] {
  const drafts: ImportReadinessDraft[] = [];
  for (let moduleIndex = 0; moduleIndex < counts.length; moduleIndex++) {
    const spec = moduleSpecs[moduleIndex]!;
    for (let questionIndex = 0; questionIndex < counts[moduleIndex]!; questionIndex++) {
      drafts.push({
        id: `q-${drafts.length + 1}`,
        page_number: drafts.length + 1,
        section: spec.section,
        source_question_number: questionIndex + 1,
        source_module_name: options.modules === false ? null : spec.name,
        source_module_position: options.modules === false ? null : moduleIndex + 1,
        suggested_answer: options.keyed === false ? null : "A",
        answer_keys: options.keyed === false ? [] : [{ detected_answer: "A", status: "suggested" }],
      });
    }
  }
  return drafts;
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("exact 98 questions and keys with exact module counts are complete", () => {
  const summary = summarizePdfImportReadiness({
    importStatus: "completed",
    drafts: draftsForCounts([27, 27, 22, 22]),
    rawKeyEntries: 98,
  });
  assertEquals(summary.questions.status, "complete", "question status");
  assertEquals(summary.answer_key.status, "complete", "answer-key status");
  assertEquals(summary.questions.modules.map((module) => module.actual), [27, 27, 22, 22], "question module counts");
  assertEquals(summary.answer_key.modules.map((module) => module.actual), [27, 27, 22, 22], "key module counts");
});

Deno.test("a one-question module mismatch is partial even when total is 98", () => {
  const summary = summarizePdfImportReadiness({
    importStatus: "completed",
    drafts: draftsForCounts([26, 28, 22, 22]),
    rawKeyEntries: 98,
  });
  assertEquals(summary.questions.status, "partial", "question status");
  assertEquals(summary.answer_key.status, "partial", "answer-key status");
});

Deno.test("an exact subset of modules remains partial until all 98 questions are present", () => {
  const summary = summarizePdfImportReadiness({
    importStatus: "completed",
    drafts: draftsForCounts([27, 27, 22, 0]),
    rawKeyEntries: 76,
  });
  assertEquals(summary.questions.status, "partial", "question status");
  assertEquals(summary.answer_key.status, "partial", "answer-key status");
});

Deno.test("headingless 98-question imports infer the canonical 27/27/22/22 split", () => {
  const drafts = draftsForCounts([27, 27, 22, 22], { modules: false });
  for (const draft of drafts) draft.section = "reading_writing";
  const summary = summarizePdfImportReadiness({ importStatus: "completed", drafts, rawKeyEntries: 98 });
  assertEquals(summary.questions.status, "complete", "question status");
  assertEquals(summary.answer_key.status, "complete", "answer-key status");
  assertEquals(summary.questions.modules.map((module) => module.inferred), [true, true, true, true], "inferred module flags");
});

Deno.test("headingless two-module Math imports report exact module counts but remain partial", () => {
  const drafts = draftsForCounts([0, 0, 22, 22], { modules: false });
  const summary = summarizePdfImportReadiness({ importStatus: "completed", drafts, rawKeyEntries: 44 });
  assertEquals(summary.questions.status, "partial", "question status");
  assertEquals(summary.questions.modules.map((module) => module.actual), [0, 0, 22, 22], "question module counts");
  assertEquals(summary.answer_key.status, "partial", "answer-key status");
});

Deno.test("headingless mixed RW and Math modules are inferred from section and order", () => {
  const drafts = draftsForCounts([27, 0, 22, 0], { modules: false });
  const summary = summarizePdfImportReadiness({ importStatus: "completed", drafts, rawKeyEntries: 49 });
  assertEquals(summary.questions.modules.map((module) => module.actual), [27, 0, 22, 0], "question module counts");
  assertEquals(summary.questions.status, "partial", "question status");
});

Deno.test("an answer-key shortfall is partial, not complete", () => {
  const drafts = draftsForCounts([27, 27, 22, 22]);
  drafts[0]!.suggested_answer = null;
  drafts[0]!.answer_keys = [];
  const summary = summarizePdfImportReadiness({ importStatus: "completed", drafts, rawKeyEntries: 97 });
  assertEquals(summary.questions.status, "complete", "question status");
  assertEquals(summary.answer_key.status, "partial", "answer-key status");
  assertEquals(summary.answer_key.actual, 97, "matched key count");
});

Deno.test("unmatched extra key entries prevent Complete", () => {
  const summary = summarizePdfImportReadiness({
    importStatus: "completed",
    drafts: draftsForCounts([27, 27, 22, 22]),
    rawKeyEntries: 99,
  });
  assertEquals(summary.answer_key.status, "partial", "answer-key status");
  assertEquals(summary.answer_key.details.length > 0, true, "extra-key diagnostic");
});

Deno.test("duplicate key rows prevent Complete even when question counts are exact", () => {
  const drafts = draftsForCounts([27, 27, 22, 22]);
  drafts[27]!.answer_keys!.push({ detected_answer: "B", status: "suggested" });
  const summary = summarizePdfImportReadiness({ importStatus: "completed", drafts, rawKeyEntries: 98 });
  assertEquals(summary.questions.status, "complete", "question status");
  assertEquals(summary.answer_key.status, "partial", "answer-key status");
});

Deno.test("duplicate question numbers prevent Complete despite exact module totals", () => {
  const drafts = draftsForCounts([27, 27, 22, 22]);
  drafts[1]!.source_question_number = 1;
  const summary = summarizePdfImportReadiness({ importStatus: "completed", drafts, rawKeyEntries: 98 });
  assertEquals(summary.questions.status, "partial", "question status");
  assertEquals(summary.answer_key.status, "partial", "answer-key status");
});

Deno.test("zero results fail while active ingestion remains processing", () => {
  const failed = summarizePdfImportReadiness({ importStatus: "completed", drafts: [] });
  assertEquals(failed.questions.status, "failed", "zero-question status");
  assertEquals(failed.answer_key.status, "failed", "zero-key status");

  const processing = summarizePdfImportReadiness({ importStatus: "ocr_running", drafts: [] });
  assertEquals(processing.questions.status, "processing", "in-flight question status");
  assertEquals(processing.answer_key.status, "processing", "in-flight key status");
});

Deno.test("ambiguous ordering cannot be marked complete from inferred counts", () => {
  const drafts = draftsForCounts([27, 27, 22, 22], { modules: false });
  drafts[0]!.page_number = 1;
  drafts[1]!.page_number = 1;
  drafts[0]!.source_question_number = null;
  drafts[1]!.source_question_number = null;
  const summary = summarizePdfImportReadiness({ importStatus: "completed", drafts, rawKeyEntries: 98 });
  assertEquals(summary.questions.status, "partial", "question status");
  assertEquals(summary.answer_key.status, "partial", "answer-key status");
});
