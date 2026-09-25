#!/usr/bin/env tsx
/** Read-only source/content audit of a staged live-import refinement. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config.ts";
import { extractText } from "../src/extractor.ts";
import { parseKeyRow } from "../src/answerKey.ts";
import { readinessPromotionDecision } from "../src/refinementReadiness.ts";
import { extractModuleScopedAnswerKeys, oldChoiceTextsPreserved, sourceAnswersEquivalent, sourceEvidenceIncludes } from "../src/refinementSourceAudit.ts";

type Row = Record<string, any>;
const root = path.resolve(import.meta.dirname, "../../..");
const out = path.join(root, "backend/worker/tmp/refinement");
const id = process.argv[2];
const manifest = JSON.parse(readFileSync(path.join(out, "cohort.json"), "utf8"));
const record = manifest.cohort.find((r: Row) => r.row.id === id);
if (!record) throw new Error("usage: audit-refinement.ts <frozen cohort import id>");
const state = JSON.parse(readFileSync(path.join(out, `stage-${id}.json`), "utf8"));
if (state.state !== "staged") throw new Error("no completed staging run");
const replay = JSON.parse(readFileSync(path.join(out, "replay-current.json"), "utf8")).results.find((r: Row) => r.id === id);
const positionalMode = (replay?.questions ?? []).length === 98 &&
  replay.questions.every((question: Row) => (question.flags ?? []).includes("source_global_id_positional_slot"));
const manualEvidencePath = path.join(out, "manual-source-evidence.json");
const manualEvidence = existsSync(manualEvidencePath) ? JSON.parse(readFileSync(manualEvidencePath, "utf8")) as Record<string, Row[]> : {};
const manualChecks = new Map((manualEvidence[id] ?? []).map((check) => [String(check.slot), check]));
const cfg = loadConfig();
const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
const { data, error } = await sb.from("draft_questions")
  .select("*,choices:draft_question_choices(*),answer_keys:draft_answer_keys(*)")
  .eq("pdf_import_id", state.stageId);
if (error) throw new Error(error.message);
const staged = (data ?? []) as Row[];
const slot = (q: Row) => `${q.source_module_name ?? q.module}|${q.source_question_number ?? q.number}`;
const stageBySlot = new Map(staged.map((q) => [slot(q), q]));
const replayBySlot = new Map(replay.questions.map((q: Row) => [slot(q), q]));
const moduleCounts = Object.fromEntries(replay.replay.questions.modules.map((m: Row) => [m.name, m.actual]));
const mismatches: Row[] = [];
for (const [key, question] of replayBySlot) {
  const saved = stageBySlot.get(key);
  const choiceText = (items: Row[]) => items.map((c) => [c.label, c.text, c.position]).sort((a, b) => Number(a[2]) - Number(b[2]));
  if (!saved || saved.prompt !== question.prompt || saved.suggested_answer !== question.answer ||
    JSON.stringify(choiceText(saved.choices ?? [])) !== JSON.stringify(choiceText(question.choices ?? []))) {
    mismatches.push({ slot: key, missing: !saved, prompt: saved?.prompt !== question.prompt,
      answer: saved?.suggested_answer !== question.answer, choices: saved ?
        JSON.stringify(choiceText(saved.choices ?? [])) !== JSON.stringify(choiceText(question.choices ?? [])) : true });
  }
}
const oldChoiceLoss: Row[] = [];
for (const old of record.drafts as Row[]) {
  const oldChoices = (old.choices ?? []).map((choice: Row) => ({
    label: String(choice.label), text: String(choice.text),
  }));
  if (!oldChoices.length) continue;
  const preserved = staged.some((question) =>
    Math.abs(Number(question.page_number) - Number(old.page_number)) <= 1 &&
    oldChoiceTextsPreserved(oldChoices, (question.choices ?? []).map((choice: Row) => ({
      label: String(choice.label), text: String(choice.text),
    }))));
  if (!preserved) oldChoiceLoss.push({ oldSlot: slot(old), oldPage: old.page_number });
}
let sourceKeyGrid: Row | null = null;
let sourcePdfQuestionPages: Row[] = [];
let sourcePages: Array<{ pageNumber: number; text: string }> = [];
const sourceKeysByModule = new Map<string, string[]>();
const sourceKeysByGlobalId = new Map<string, string>();
const newOcrPath = path.join(out, `new-ocr-${id}.json`);
if ((record.source.ocr || replay.sourceKind === "new_ocr") && record.source.pdf) {
  const pdf = readFileSync(path.join(root, record.source.pdf));
  if (createHash("sha256").update(pdf).digest("hex") !== record.source.pdfSha256) throw new Error("PDF checksum changed");
  const sourceOcrText = record.source.ocr
    ? readFileSync(path.join(root, record.source.ocr), "utf8")
    : null;
  if (sourceOcrText && createHash("sha256").update(sourceOcrText).digest("hex") !== record.source.ocrSha256) {
    throw new Error("OCR checksum changed");
  }
  sourcePages = sourceOcrText
    ? (() => {
      const chunks = sourceOcrText.split(/^===== PAGE (\d+) =====\s*$/m);
      return Array.from({ length: Math.floor(chunks.length / 2) }, (_, index) => ({
        pageNumber: Number(chunks[index * 2 + 1]), text: chunks[index * 2 + 2] ?? "",
      }));
    })()
    : (JSON.parse(readFileSync(newOcrPath, "utf8")) as { pages: Array<{ pageNumber: number; text: string }> }).pages;
  const ocr = sourcePages.map((page) => `===== PAGE ${page.pageNumber} =====\n${page.text}`).join("\n");
  const scopedKeys = extractModuleScopedAnswerKeys(sourcePages);
  const keyLines = ocr.split(/^===== PAGE \d+ =====\s*$/m).at(-1)!.split("\n").map((line) => line.trim()).filter(Boolean);
  const rows = keyLines.map(parseKeyRow).filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (scopedKeys.columns.some((count) => count > 0)) {
    for (const [name, answers] of scopedKeys.answersByModule) sourceKeysByModule.set(name, answers);
    sourceKeyGrid = { columns: scopedKeys.columns, exact: scopedKeys.exact,
      sequenceValid: [...scopedKeys.sequencesByModule].every(([name, sequence]) => {
        const expectedCount = scopedKeys.answersByModule.get(name)?.length ?? 0;
        return sequence.length === expectedCount && sequence.every((number, index) => number === index + 1);
      }), firstRow: scopedKeys.firstRow, lastRow: scopedKeys.lastRow };
  } else if (rows.length > 0) {
    const cols = [0, 1, 2, 3].map((column) => rows.map((row) => row[column]).filter(Boolean));
    for (const row of rows) for (const entry of row) {
      const globalId = String(entry.n);
      if (sourceKeysByGlobalId.has(globalId)) throw new Error(`duplicate source key ID ${globalId}`);
      sourceKeysByGlobalId.set(globalId, String(entry.answer));
    }
    ["Reading and Writing Module 1", "Reading and Writing Module 2", "Math Module 1", "Math Module 2"]
      .forEach((name, index) => sourceKeysByModule.set(name, cols[index]!.map((entry) => String(entry!.answer))));
    const positionalShape = rows.length === 27 && rows.every((row, index) => row.length === (index < 22 ? 4 : 2));
    sourceKeyGrid = { columns: cols.map((col) => col.length), exact:
      positionalMode && positionalShape ||
      cols.every((col, index) => col.length === [27, 27, 22, 22][index] && col.every((entry, position) => entry!.n === position + 1)),
      sequenceValid: positionalMode && positionalShape || cols.every((col) => col.every((entry, position) => entry!.n === position + 1)),
      firstRow: rows[0], lastRow: rows.at(-1) };
  } else {
    // A page with four vertical single-column runs, optionally separated by
    // compact Math headings (M1:/M2:). The source order is the key evidence.
    const runs: Array<Array<{ n: number; answer: string }>> = [];
    for (const line of keyLines) {
      const match = line.match(/^(\d{1,3})[.)]\s+(.+)$/);
      if (!match) continue;
      const n = Number(match[1]);
      if (n === 1 || !runs.length) runs.push([]);
      runs.at(-1)!.push({ n, answer: match[2]!.trim() });
    }
    sourceKeyGrid = { columns: runs.map((run) => run.length), exact:
      runs.length === 4 && runs.every((run, index) =>
        run.length === [27, 27, 22, 22][index] && run.every((entry, position) => entry.n === position + 1)),
      sequenceValid: runs.every((run) => run.every((entry, position) => entry.n === position + 1)),
      firstRow: runs.map((run) => run[0]), lastRow: runs.map((run) => run.at(-1)) };
    ["Reading and Writing Module 1", "Reading and Writing Module 2", "Math Module 1", "Math Module 2"]
      .forEach((name, index) => sourceKeysByModule.set(name, (runs[index] ?? []).map((entry) => entry.answer)));
  }
  const pdfText = await extractText(new Uint8Array(pdf));
  const inferred = replay.questions.filter((q: Row) => q.origin === "inferred");
  sourcePdfQuestionPages = inferred.map((q: Row) => {
    const check = manualChecks.get(slot(q));
    const pdfHasPrintedNumber = new RegExp(`\\bQuestion\\s+${q.number}\\b`, "i")
      .test(pdfText.find((page) => page.pageNumber === q.page)?.text ?? "");
    return { slot: slot(q), page: q.page, pdfHasPrintedNumber,
      manualVisualCheck: check && Number(check.page) === Number(q.page) && Number(check.questionNumber) === Number(q.number) &&
        check.visualConfirmed === true ? check : null,
      promptStart: q.prompt.slice(0, 100) };
  });
} else if (record.source.storedPages) {
  sourcePages = record.source.storedPages;
}
const sourceEvidenceFailures: Row[] = [];
const sourceKeyMismatches: Row[] = [];
for (const [questionIndex, question] of (replay.questions as Row[]).entries()) {
  const sourcePage = sourcePages.find((page) => page.pageNumber === Number(question.page));
  const pageText = sourcePage?.text ?? "";
  const nextQuestionPage = Number(replay.questions[questionIndex + 1]?.page ?? question.page);
  const sourceEndPage = positionalMode && question.sourceGlobalQuestionId
    ? Math.min(nextQuestionPage, Number(question.page) + 5)
    : Number(question.page) + 1;
  const nearbySourcePages = sourcePages.filter((page) => page.pageNumber >= Number(question.page) - 1 &&
      page.pageNumber <= sourceEndPage)
    .map((page) => page.text.split("\n").filter((line) => !/^\s*(?:file:\/\/|\d+\/\d+\s*$|Document\s*$|\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})/i.test(line)).join("\n"));
  const prompt = String(question.prompt).replace(/^\s*\d{1,3}[.)]?\s*/, "");
  const promptAnchor = prompt.slice(0, Math.min(48, prompt.length));
  const promptPresent = promptAnchor.length >= 20 && sourceEvidenceIncludes(nearbySourcePages, promptAnchor);
  const number = Number(question.number);
  const hasPrintedNumber = pageText.split("\n").some((line) => {
    const marker = line.match(/^\s*\*{0,2}(\d{1,3})[.)]?\*{0,2}(?:\s|$)/);
    return marker ? Number(marker[1]) === number : false;
  });
  const choices = (question.choices ?? []) as Row[];
  const missingChoices = choices.filter((choice) => {
    const normalized = String(choice.text);
    if (normalized.length < 8 || sourceEvidenceIncludes(nearbySourcePages, normalized)) return false;
    const stagedVisual = stageBySlot.get(slot(question))?.has_visual_stimulus === true;
    const figureAndBullets = stagedVisual && normalized.length > 160 &&
      sourceEvidenceIncludes(nearbySourcePages, normalized.slice(0, 110)) &&
      sourceEvidenceIncludes(nearbySourcePages, normalized.slice(-90));
    return !figureAndBullets;
  }).map((choice) => String(choice.label));
  const moduleKeys = sourceKeysByModule.get(String(question.module));
  const expectedAnswer = positionalMode && sourceKeysByGlobalId.size === 54
    ? sourceKeysByGlobalId.get(String(question.sourceGlobalQuestionId ?? ""))
    : moduleKeys?.[Number(question.number) - 1];
  const actualAnswer = String(question.answer ?? "");
  if (expectedAnswer !== undefined && !sourceAnswersEquivalent(expectedAnswer, actualAnswer)) {
    sourceKeyMismatches.push({ slot: slot(question), expected: expectedAnswer, actual: actualAnswer });
  }
  const idResolved = !(question.flags ?? []).some((flag: string) =>
    ["source_question_id_unresolved", "duplicate_source_number_conflict"].includes(flag));
  const visualCheck = manualChecks.get(slot(question));
  const manualMarkerVerified = visualCheck && Number(visualCheck.page) === Number(question.page) &&
    Number(visualCheck.questionNumber) === number && visualCheck.visualConfirmed === true &&
    typeof visualCheck.note === "string" && visualCheck.note.trim().length > 15;
  const positionalSourceIdentity = positionalMode && promptPresent &&
    (Boolean(question.sourceGlobalQuestionId) || (question.flags ?? []).includes("source_global_id_ocr_unresolved"));
  if (!promptPresent || missingChoices.length || ((question.origin === "inferred" || !idResolved) &&
      !hasPrintedNumber && !manualMarkerVerified && !positionalSourceIdentity)) {
    sourceEvidenceFailures.push({ slot: slot(question), page: question.page, promptPresent,
      hasPrintedNumber, manualMarkerVerified: Boolean(manualMarkerVerified), origin: question.origin, missingChoices });
  }
}
const approved = (record.drafts as Row[]).filter((q) => ["approved", "rejected"].includes(q.status)).length;
const linked = (record.drafts as Row[]).filter((q) => q.question_id).length;
const expectedKeyColumns = [27, 27, 22, 22];
const sourceKeyColumns = Array.isArray(sourceKeyGrid?.columns) ? sourceKeyGrid.columns.map(Number) : [];
const sourceKeyEntries = sourceKeyColumns.reduce((sum, count) => sum + count, 0);
const moduleNames = ["Reading and Writing Module 1", "Reading and Writing Module 2", "Math Module 1", "Math Module 2"];
const observedSourceModules = moduleNames.filter((_, index) => (sourceKeyColumns[index] ?? 0) > 0);
const manualKeyScope = (manualEvidence[id] ?? []).find((check) => check.kind === "answer_key_scope");
const manualKeyScopeConfirmed = Boolean(manualKeyScope?.visualConfirmed === true &&
  typeof manualKeyScope.note === "string" && manualKeyScope.note.trim().length > 15 &&
  JSON.stringify(manualKeyScope.confirmedModules) === JSON.stringify(observedSourceModules));
const manualKeyAbsence = (manualEvidence[id] ?? []).find((check) => check.kind === "answer_key_absent");
const manualKeyAbsenceConfirmed = Boolean(manualKeyAbsence?.visualConfirmed === true &&
  Number(manualKeyAbsence.page) === sourcePages.at(-1)?.pageNumber &&
  typeof manualKeyAbsence.note === "string" && manualKeyAbsence.note.trim().length > 15);
const positionalPartialKeyScope = positionalMode && sourceKeyEntries === 54 &&
  sourceKeysByGlobalId.size === 54 &&
  replay.questions.filter((question: Row) => sourceKeysByGlobalId.has(String(question.sourceGlobalQuestionId ?? ""))).length === 54 &&
  replay.questions.filter((question: Row) => sourceKeysByGlobalId.has(String(question.sourceGlobalQuestionId ?? "")))
    .every((question: Row) => /^Reading and Writing Module [12]$/.test(String(question.module)));
const sourceKeyCoverage = {
  columns: sourceKeyColumns,
  expectedColumns: expectedKeyColumns,
  observedEntries: sourceKeyEntries,
  sequenceValid: sourceKeyGrid?.sequenceValid === true,
  exactFullGrid: sourceKeyGrid?.exact === true,
  manualScopeConfirmed: manualKeyScopeConfirmed,
  positionalPartialKeyScope,
  manualKeyAbsenceConfirmed,
  completeForVerifiedSource: sourceKeyColumns.length === 4 &&
    sourceKeyColumns.every((count, index) => count >= 0 && count <= expectedKeyColumns[index]!) &&
    (sourceKeyGrid?.sequenceValid === true || positionalPartialKeyScope) && sourceKeyEntries > 0 &&
    replay.keyEntries === sourceKeyEntries && replay.replay.answer_key.actual === sourceKeyEntries &&
    replay.unmatchedKeys === 0 && sourceKeyMismatches.length === 0 &&
    (sourceKeyGrid?.exact === true || manualKeyScopeConfirmed || positionalPartialKeyScope) ||
    (manualKeyAbsenceConfirmed && sourceKeyEntries === 0 && replay.keyEntries === 0 &&
      replay.replay.answer_key.actual === 0 && replay.unmatchedKeys === 0),
};
const verifiedDuplicateRemoval = oldChoiceLoss.length === 0 && sourceEvidenceFailures.length === 0 &&
  sourceKeyMismatches.length === 0 ? Number(replay.flags.repeated_source_question_coalesced ?? 0) : 0;
const promotionReadiness = readinessPromotionDecision(record.readiness, replay.replay, verifiedDuplicateRemoval);
const audit = { id, name: record.row.original_filename, stageId: state.stageId, stageDrafts: staged.length,
  replayQuestions: replay.questions.length, stageReplayMismatches: mismatches,
  oldChoiceLoss, approvedOrRejectedReset: approved, linkedQuestionRecordsUnchanged: linked,
  sourceKeyGrid, sourceKeyCoverage, promotionReadiness, verifiedDuplicateRemoval,
  sourcePdfQuestionPages, sourceEvidenceFailures, sourceKeyMismatches, moduleCounts,
  parserFlags: replay.flags, unmatchedKeys: replay.unmatchedKeys,
  sourceKind: replay.sourceKind, status: replay.replay,
  accepted: mismatches.length === 0 && sourceEvidenceFailures.length === 0 && sourceKeyMismatches.length === 0 &&
    staged.length === replay.questions.length &&
    replay.replay.questions.status !== "failed" &&
    (replay.replay.answer_key.status !== "failed" || manualKeyAbsenceConfirmed) &&
    replay.unmatchedKeys === 0 && Object.keys(replay.flags).every((flag) =>
      ["question_id_recovered_from_neighbors", "repeated_source_question_coalesced",
        "recovered_from_page_replay", "recovered_from_global_marker_block", "source_global_id_ocr_unresolved",
        "source_global_id_positional_slot", "positional_answer_review_required",
        "source_choice_table_truncated_review_required"].includes(flag)) &&
    sourceKeyCoverage.completeForVerifiedSource && promotionReadiness.allowed,
  generatedAt: new Date().toISOString() };
const auditPath = path.join(out, `audit-${id}.json`);
writeFileSync(auditPath, JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ auditPath, ...audit }));
