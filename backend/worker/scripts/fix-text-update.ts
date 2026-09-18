#!/usr/bin/env node
/**
 * Re-sync prompt / passage_text / explanation / choices for every imported
 * record with the cleaned bank-parsed.json (fixed "r t" artifacts, no visual
 * line-wrap newlines, full stem-recovered prompts).
 *
 * Usage:  npx tsx scripts/fix-text-update.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://ygqndcgpbtmewzkruyuq.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (see backend/worker/.env)");
const IMPORT_ID = "5a255e65-742d-41e1-ba7c-ca0379257ebc";

const PARSED_PATH = path.resolve(__dirname, "../tmp/bank-parsed.json");

interface ParsedQuestion {
  sourceQuestionId: string;
  prompt: string;
  passageText: string | null;
  explanation: string | null;
  choices: Array<{ label: string; text: string }>;
}

async function loadAll<T>(sb: ReturnType<typeof createClient>, from: string, sel: string, filters: Record<string, unknown>): Promise<T[]> {
  const PAGE = 1000;
  let offset = 0;
  const all: T[] = [];
  while (true) {
    let q = sb.from(from).select(sel).order("id", { ascending: true });
    for (const [k, v] of Object.entries(filters)) {
      if (typeof v === "string") q = q.eq(k, v);
      else if (v === null) q = q.is(k, null);
      else q = q.eq(k, v);
    }
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${from} load: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

const BATCH = 80;

async function batchUpdate(sb: ReturnType<typeof createClient>, table: string, rows: Array<{ id: string } & Record<string, unknown>>, cols: string[]) {
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((r) => {
        const payload: Record<string, unknown> = {};
        for (const c of cols) payload[c] = r[c];
        return sb.from(table).update(payload).eq("id", r.id).then((res) => ({ id: r.id, error: res.error }));
      }),
    );
    for (const r of results) {
      if (r.error) { fail++; if (fail <= 3) console.error(`  update ${r.id} failed:`, r.error.message); }
      else ok++;
    }
    if (i % 500 === 0 && i > 0) process.stdout.write(`  ${i}/${rows.length}\r`);
  }
  return { ok, fail };
}

async function main() {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const parsed = JSON.parse(fs.readFileSync(PARSED_PATH, "utf8")) as { questions: ParsedQuestion[] };
  const byId = new Map<string, ParsedQuestion>();
  for (const q of parsed.questions) byId.set(q.sourceQuestionId, q);
  console.log(`Parsed entries: ${byId.size}`);

  // ---- Load all data ----
  console.log("\nLoading data from DB...");
  const draftRows = await loadAll<{ id: string; source_question_id: string }>(sb, "draft_questions", "id, source_question_id", { pdf_import_id: IMPORT_ID });
  const importDrafts = draftRows.filter((d) => d.source_question_id);
  console.log(`  Drafts: ${importDrafts.length}`);

  const questionRows = await loadAll<{ id: string; source_question_id: string; passage_id: string | null }>(sb, "questions", "id, source_question_id, passage_id", {});
  const importQuestions = questionRows.filter((q) => q.source_question_id);
  console.log(`  Questions: ${importQuestions.length}`);

  const draftChoiceRows = await loadAll<{ id: string; draft_question_id: string; label: string }>(sb, "draft_question_choices", "id, draft_question_id, label", {});
  console.log(`  Draft choices: ${draftChoiceRows.length}`);

  const questionChoiceRows = await loadAll<{ id: string; question_id: string; label: string }>(sb, "question_choices", "id, question_id, label", {});
  console.log(`  Question choices: ${questionChoiceRows.length}`);

  const sourceRows = await loadAll<{ id: string; question_id: string }>(sb, "question_sources", "id, question_id", {});
  console.log(`  Question sources: ${sourceRows.length}`);

  // ---- Update draft_questions ----
  console.log("\n=== Updating draft_questions ===");
  const draftUpdates = importDrafts
    .map((d) => {
      const pq = byId.get(d.source_question_id);
      if (!pq) return null;
      return { id: d.id, prompt: pq.prompt, passage_text: pq.passageText ?? null, explanation: pq.explanation ?? null };
    })
    .filter(Boolean) as Array<{ id: string; prompt: string; passage_text: string | null; explanation: string | null }>;
  console.log(`  ${draftUpdates.length} to update`);
  const dr = await batchUpdate(sb, "draft_questions", draftUpdates, ["prompt", "passage_text", "explanation"]);
  console.log(`  draft_questions: ${dr.ok} ok, ${dr.fail} failed`);

  // ---- Update draft_question_choices ----
  console.log("\n=== Updating draft_question_choices ===");
  const draftChoiceUpdates = draftChoiceRows
    .map((dc) => {
      const d = importDrafts.find((x) => x.id === dc.draft_question_id);
      if (!d) return null;
      const pq = byId.get(d.source_question_id);
      if (!pq) return null;
      const pc = pq.choices.find((c) => c.label === dc.label);
      if (!pc) return null;
      return { id: dc.id, text: pc.text };
    })
    .filter(Boolean) as Array<{ id: string; text: string }>;
  console.log(`  ${draftChoiceUpdates.length} to update`);
  const dcr = await batchUpdate(sb, "draft_question_choices", draftChoiceUpdates, ["text"]);
  console.log(`  draft_question_choices: ${dcr.ok} ok, ${dcr.fail} failed`);

  // ---- Update questions ----
  console.log("\n=== Updating questions ===");
  const questionUpdates = importQuestions
    .map((q) => {
      const pq = byId.get(q.source_question_id);
      if (!pq) return null;
      return { id: q.id, prompt: pq.prompt, explanation: pq.explanation ?? null };
    })
    .filter(Boolean) as Array<{ id: string; prompt: string; explanation: string | null }>;
  console.log(`  ${questionUpdates.length} to update`);
  const qr = await batchUpdate(sb, "questions", questionUpdates, ["prompt", "explanation"]);
  console.log(`  questions: ${qr.ok} ok, ${qr.fail} failed`);

  // ---- Update passages ----
  console.log("\n=== Updating passages ===");
  const passageMap = new Map<string, string>();
  for (const q of importQuestions) {
    if (!q.passage_id) continue;
    const pq = byId.get(q.source_question_id);
    if (!pq || !pq.passageText) continue;
    passageMap.set(q.passage_id, pq.passageText);
  }
  const passageRows = [...passageMap.entries()].map(([id, content]) => ({ id, content }));
  console.log(`  ${passageRows.length} to update`);
  const pr = await batchUpdate(sb, "passages", passageRows, ["content"]);
  console.log(`  passages: ${pr.ok} ok, ${pr.fail} failed`);

  // ---- Update question_choices ----
  console.log("\n=== Updating question_choices ===");
  const qChoiceUpdates = questionChoiceRows
    .map((qc) => {
      const q = importQuestions.find((x) => x.id === qc.question_id);
      if (!q) return null;
      const pq = byId.get(q.source_question_id);
      if (!pq) return null;
      const pc = pq.choices.find((c) => c.label === qc.label);
      if (!pc) return null;
      return { id: qc.id, text: pc.text };
    })
    .filter(Boolean) as Array<{ id: string; text: string }>;
  console.log(`  ${qChoiceUpdates.length} to update`);
  const qcr = await batchUpdate(sb, "question_choices", qChoiceUpdates, ["text"]);
  console.log(`  question_choices: ${qcr.ok} ok, ${qcr.fail} failed`);

  // ---- Update question_sources ----
  console.log("\n=== Updating question_sources ===");
  const srcUpdates = sourceRows
    .map((s) => {
      const q = importQuestions.find((x) => x.id === s.question_id);
      if (!q) return null;
      const pq = byId.get(q.source_question_id);
      if (!pq) return null;
      return { id: s.id, raw_text: pq.prompt };
    })
    .filter(Boolean) as Array<{ id: string; raw_text: string }>;
  console.log(`  ${srcUpdates.length} to update`);
  const sr = await batchUpdate(sb, "question_sources", srcUpdates, ["raw_text"]);
  console.log(`  question_sources: ${sr.ok} ok, ${sr.fail} failed`);

  console.log("\nDone.");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });