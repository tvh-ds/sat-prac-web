#!/usr/bin/env tsx
/** Read-only aggregate and per-import metrics for the frozen refinement cohort. */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { summarizePdfImportReadiness, type ImportReadinessDraft } from "../../supabase/functions/_shared/importReadiness.ts";
import { loadConfig } from "../src/config.ts";

type Row = Record<string, any>;
const worker = path.resolve(import.meta.dirname, "..");
const root = path.resolve(worker, "../..");
const out = path.join(worker, "tmp/refinement");
const manifest = JSON.parse(readFileSync(path.join(out, "cohort.json"), "utf8"));
const baseline = JSON.parse(readFileSync(path.join(out, "replay-baseline.json"), "utf8"));
const current = JSON.parse(readFileSync(path.join(out, "replay-current.json"), "utf8"));
const mapById = (report: Row) => new Map(report.results.map((result: Row) => [result.id, result]));
const beforeById = mapById(baseline);
const afterById = mapById(current);
const cfg = loadConfig();
const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
const ids = manifest.cohort.map((entry: Row) => entry.row.id);
const { data: importRows, error: importError } = await sb.from("pdf_imports").select("*").in("id", ids);
if (importError) throw new Error(importError.message);
const draftRows: Row[] = [];
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await sb.from("draft_questions")
    .select("id,pdf_import_id,status,page_number,section,source_question_number,source_module_name,source_module_position,suggested_answer,parser_metadata,created_at,answer_keys:draft_answer_keys(detected_answer,status)")
    .in("pdf_import_id", ids).order("id", { ascending: true }).range(offset, offset + 999);
  if (error) throw new Error(error.message);
  draftRows.push(...((data ?? []) as Row[]));
  if ((data?.length ?? 0) < 1000) break;
}
const draftsByImport = new Map<string, Row[]>();
for (const draft of new Map(draftRows.map((row) => [row.id, row])).values()) {
  const group = draftsByImport.get(draft.pdf_import_id) ?? [];
  group.push(draft);
  draftsByImport.set(draft.pdf_import_id, group);
}
const importById = new Map((importRows ?? []).map((row: Row) => [row.id, row]));
const liveById = new Map<string, ReturnType<typeof summarizePdfImportReadiness>>();
for (const [id, row] of importById) {
  liveById.set(id, summarizePdfImportReadiness({ importStatus: row.status,
    drafts: (draftsByImport.get(id) ?? []) as ImportReadinessDraft[], rawKeyEntries: row.text_quality?.key_entries }));
}
const pair = (result: Row) => `${result.replay.questions.status}/${result.replay.answer_key.status}`;
const counts = (entries: Row[]) => Object.fromEntries([...new Set(entries.map(pair))]
  .map((key) => [key, entries.filter((entry) => pair(entry) === key).length]));
const sum = (entries: Row[], f: (entry: Row) => number) => entries.reduce((total, entry) => total + f(entry), 0);
const cohortRows = manifest.cohort.map((entry: Row) => {
  const before = beforeById.get(entry.row.id) as Row;
  const after = afterById.get(entry.row.id) as Row;
  const live = liveById.get(entry.row.id)!;
  const promotions = existsSync(path.join(out, `promotion-${entry.row.id}.json`));
  return { id: entry.row.id, name: entry.row.original_filename,
    liveQ: `${live.questions.actual}/${live.questions.expected}:${live.questions.status}`,
    liveKey: `${live.answer_key.actual}/${live.answer_key.expected}:${live.answer_key.status}`,
    beforeQ: `${before.replay.questions.actual}/${before.replay.questions.expected}:${before.replay.questions.status}`,
    beforeKey: `${before.replay.answer_key.actual}/${before.replay.answer_key.expected}:${before.replay.answer_key.status}`,
    afterQ: `${after.replay.questions.actual}/${after.replay.questions.expected}:${after.replay.questions.status}`,
    afterKey: `${after.replay.answer_key.actual}/${after.replay.answer_key.expected}:${after.replay.answer_key.status}`,
    qModules: after.replay.questions.modules.map((module: Row) => `${module.actual}/${module.expected}`).join(","),
    keyModules: after.replay.answer_key.modules.map((module: Row) => `${module.actual}/${module.expected}`).join(","),
    matchedKeys: Number(after.keyEntries) - after.unmatchedKeys, rawKeys: Number(after.keyEntries),
    unmatchedKeys: after.unmatchedKeys, lowKeyMatches: after.lowKeyMatches,
    unresolvedIds: (after.flags.source_question_id_unresolved ?? 0) + (after.flags.duplicate_source_number_conflict ?? 0),
    flags: after.flags, sourceKind: after.sourceKind, replayMs: after.elapsedMs,
    promoted: promotions, verified: existsSync(path.join(out, `audit-${entry.row.id}.json`)) &&
      JSON.parse(readFileSync(path.join(out, `audit-${entry.row.id}.json`), "utf8")).accepted === true,
    answerQ: after.replay.questions.actual, answerKeys: after.replay.answer_key.actual };
});
const controlRows = manifest.controls.map((entry: Row) => ({ before: beforeById.get(entry.row.id) as Row,
  after: afterById.get(entry.row.id) as Row }));
const ocrRuns = manifest.cohort.filter((entry: Row) => existsSync(path.join(out, `new-ocr-${entry.row.id}.json`)))
  .map((entry: Row) => {
    const ocr = JSON.parse(readFileSync(path.join(out, `new-ocr-${entry.row.id}.json`), "utf8"));
    return { id: entry.row.id, name: entry.row.original_filename, attemptedPages: ocr.pages.length,
    billedPages: ocr.billedPages ?? ocr.billedParsePages ?? ocr.pages.reduce((total: number, page: Row) => total + Number(page.billedPages ?? 0), 0),
      elapsedMs: ocr.elapsedMs ?? ocr.ocrMs };
  });
const sourceVerification = existsSync(path.join(out, "source-verification.json"))
  ? JSON.parse(readFileSync(path.join(out, "source-verification.json"), "utf8")) : null;
const livePair = (row: Row) => row.liveQ.split(":")[1] + "/" + row.liveKey.split(":")[1];
const liveDistribution = Object.fromEntries([...new Set(cohortRows.map(livePair))]
  .map((key) => [key, cohortRows.filter((row) => livePair(row) === key).length]));
const sameSourceRows = cohortRows.filter((row) => {
  const before = beforeById.get(row.id)!; const after = afterById.get(row.id)!;
  return before.sourceKind === after.sourceKind && after.sourceKind !== "new_ocr";
});
const controlRegressions = controlRows.filter(({ before, after }) =>
  after.replay.questions.actual < before.replay.questions.actual ||
  Number(after.keyEntries) - after.unmatchedKeys < Number(before.keyEntries) - before.unmatchedKeys)
  .map(({ before, after }) => after.name);
if (process.argv.includes("--table")) {
  console.log("| Import | Live now | Before Q/K | After Q/K | Q modules RW1/RW2/Math1/Math2* | Key modules | Matched/raw/unmatched | Low | Unresolved | Verified/promoted |");
  console.log("| --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | --- | ");
  for (const row of cohortRows) {
    const before = beforeById.get(row.id)!;
    const qModules = row.qModules;
    const keyModules = row.keyModules;
    console.log("| " + row.name + " | " + livePair(row) + " | " + before.replay.questions.actual + "/" +
      (Number(before.keyEntries) - before.unmatchedKeys) + " | " + row.answerQ + "/" + row.matchedKeys + " | " +
      qModules + " | " + keyModules + " | " + row.matchedKeys + "/" + row.rawKeys + "/" + row.unmatchedKeys + " | " +
      row.lowKeyMatches + " | " + row.unresolvedIds + " | " + (row.verified ? "yes" : "no") + "/" + (row.promoted ? "yes" : "no") + " |");
  }
  process.exit(0);
}
if (process.argv.includes("--compact")) {
  console.log(JSON.stringify({ totalImports: cohortRows.length,
    baseline: { questions: sum(cohortRows, (row) => beforeById.get(row.id)!.replay.questions.actual),
      matchedKeys: sum(cohortRows, (row) => Number(beforeById.get(row.id)!.keyEntries) - beforeById.get(row.id)!.unmatchedKeys),
      statuses: counts(manifest.cohort.map((entry: Row) => beforeById.get(entry.row.id))) },
    currentReplay: { questions: sum(cohortRows, (row) => row.answerQ), matchedKeys: sum(cohortRows, (row) => row.matchedKeys),
      statuses: counts(manifest.cohort.map((entry: Row) => afterById.get(entry.row.id))),
      uiPasses: cohortRows.filter((row) => row.afterQ.endsWith(":complete") && row.afterKey.endsWith(":complete")).length,
      verifiedPasses: cohortRows.filter((row) => row.verified && row.afterQ.endsWith(":complete") && row.afterKey.endsWith(":complete")).length,
      unresolvedIds: sum(cohortRows, (row) => row.unresolvedIds), unmatchedKeys: sum(cohortRows, (row) => row.unmatchedKeys),
      lowKeyMatches: sum(cohortRows, (row) => row.lowKeyMatches) },
    live: { statuses: liveDistribution, promoted: cohortRows.filter((row) => row.promoted).length },
    sameSourceParserGain: { imports: sameSourceRows.length,
      questions: sum(sameSourceRows, (row) => afterById.get(row.id)!.replay.questions.actual - beforeById.get(row.id)!.replay.questions.actual),
      matchedKeys: sum(sameSourceRows, (row) => (Number(afterById.get(row.id)!.keyEntries) - afterById.get(row.id)!.unmatchedKeys) -
        (Number(beforeById.get(row.id)!.keyEntries) - beforeById.get(row.id)!.unmatchedKeys)) },
    freshOcrJointGain: sum(cohortRows.filter((row) => row.sourceKind === "new_ocr"), (row) =>
      row.answerQ - beforeById.get(row.id)!.replay.questions.actual),
    freshOcrMatchedKeys: sum(cohortRows.filter((row) => row.sourceKind === "new_ocr"), (row) => row.answerKeys),
    controls: { count: controlRows.length, statuses: counts(controlRows.map(({ after }) => after)), regressions: controlRegressions },
    newOcr: { files: ocrRuns.map((run) => ({ name: run.name, pages: run.attemptedPages, billed: run.billedPages, ms: run.elapsedMs })),
      attemptedPages: sum(ocrRuns, (run) => run.attemptedPages), billedPages: sum(ocrRuns, (run) => run.billedPages),
      runtimeMs: sum(ocrRuns, (run) => run.elapsedMs) },
    sourceStorage: sourceVerification && { checked: sourceVerification.checked, exactMatches: sourceVerification.exactMatches,
      unavailable: sourceVerification.unavailable.length },
    imports: cohortRows.map((row) => ({ name: row.name, live: livePair(row), baselineQ: row.beforeQ, baselineKey: row.beforeKey,
      replayQ: row.afterQ, replayKey: row.afterKey, qModules: row.qModules, keyModules: row.keyModules,
      matchedKeys: row.matchedKeys, rawKeys: row.rawKeys, unmatchedKeys: row.unmatchedKeys,
      lowKeyMatches: row.lowKeyMatches, unresolvedIds: row.unresolvedIds, sourceKind: row.sourceKind,
      flags: row.flags, replayMs: row.replayMs, verified: row.verified, promoted: row.promoted })) }, null, 2));
  process.exit(0);
}
console.log(JSON.stringify({ cohort: {
  imports: cohortRows.length,
  parserOnlyBefore: { questions: sum(cohortRows, (row) => beforeById.get(row.id)!.replay.questions.actual),
    matchedKeys: sum(cohortRows, (row) => Number(beforeById.get(row.id)!.keyEntries) - beforeById.get(row.id)!.unmatchedKeys),
    distribution: counts(manifest.cohort.map((entry: Row) => beforeById.get(entry.row.id))) },
  finalReplay: { questions: sum(cohortRows, (row) => row.answerQ), matchedKeys: sum(cohortRows, (row) => row.answerKeys),
    distribution: counts(manifest.cohort.map((entry: Row) => afterById.get(entry.row.id))),
    fullUiPass: cohortRows.filter((row) => row.afterQ.endsWith(":complete") && row.afterKey.endsWith(":complete")).length,
    flaggedIds: sum(cohortRows, (row) => row.unresolvedIds), unmatchedKeys: sum(cohortRows, (row) => row.unmatchedKeys),
    lowKeyMatches: sum(cohortRows, (row) => row.lowKeyMatches) },
  liveNow: { distribution: Object.fromEntries([...new Set(cohortRows.map((row) => `${row.liveQ.split(":")[1]}/${row.liveKey.split(":")[1]}`))]
    .map((key) => [key, cohortRows.filter((row) => `${row.liveQ.split(":")[1]}/${row.liveKey.split(":")[1]}` === key).length])),
    promoted: cohortRows.filter((row) => row.promoted).length },
  sameOcrQuestionsGained: sum(cohortRows, (row) => {
    const before = beforeById.get(row.id)!; const after = afterById.get(row.id)!;
    return before.sourceKind === after.sourceKind && before.sourceKind !== "new_ocr"
      ? after.replay.questions.actual - before.replay.questions.actual : 0;
  }),
  sameOcrMatchedKeysGained: sum(cohortRows, (row) => {
    const before = beforeById.get(row.id)!; const after = afterById.get(row.id)!;
    return before.sourceKind === after.sourceKind && before.sourceKind !== "new_ocr"
      ? (Number(after.keyEntries) - after.unmatchedKeys) - (Number(before.keyEntries) - before.unmatchedKeys) : 0;
  }),
  controls: { count: controlRows.length, statusDistribution: counts(controlRows.map((row) => row.after)),
    completeCount: controlRows.filter((row) => row.after.replay.questions.status === "complete" && row.after.replay.answer_key.status === "complete").length },
  newOcr: ocrRuns, sourceVerification: sourceVerification && { checked: sourceVerification.checked,
    exactMatches: sourceVerification.exactMatches, unavailable: sourceVerification.unavailable.length },
  imports: cohortRows,
}}, null, 2));
