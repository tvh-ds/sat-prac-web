// Read-only staging export. Credentials and source text never appear in logs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import dotenv from '../worker/node_modules/dotenv/lib/main.js';

const root = process.cwd();
const expected = 'https://wgkggknyndgaoyazdhdf.supabase.co';
let selected;
for (const file of ['backend/scripts/.env', 'backend/worker/.env']) {
  if (!fs.existsSync(file)) continue;
  const env = dotenv.parse(fs.readFileSync(file));
  if (env.SUPABASE_URL?.replace(/\/$/, '') === expected && env.SUPABASE_SERVICE_ROLE_KEY) selected = env;
}
if (!selected) throw new Error('No staging service credential pair found; production export is forbidden by this script');
console.log('Verified staging reference: wgkggknyndgaoyazdhdf');
const target = process.argv[2] ?? 'ml-service/datasets/raw/staging-bank.jsonl';
if (fs.existsSync(target)) throw new Error('Export snapshots are immutable; choose a new path');
async function rows(table, query) {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const url = new URL('/rest/v1/' + table, expected);
    url.search = query + `&limit=500&offset=${offset}`;
    const response = await fetch(url, { headers: { apikey: selected.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + selected.SUPABASE_SERVICE_ROLE_KEY } });
    if (!response.ok) throw new Error(`Export ${table} failed (${response.status})`);
    const batch = await response.json(); all.push(...batch);
    if (batch.length < 500) return all;
  }
}
const questions = await rows('questions', 'status=eq.active&order=id&select=id,section,question_type,prompt,domain,skill,difficulty,source_pdf_id,source_question_id,passage_id,stimulus_image_path,choices:question_choices(text,position),passage:passages(content)');
const drafts = await rows('draft_questions', 'question_id=not.is.null&order=id&select=question_id,pdf_import_id,difficulty,parser_original_snapshot,parser_metadata');
const imports = await rows('pdf_imports', 'order=id&select=id,text_quality');
const sourceImports = new Map(imports.map(i => [i.id, i]));
const sourceDrafts = new Map(drafts.map(d => [d.question_id, d]));
const proofPath = 'ml-service/datasets/raw/rw-source-labels.json';
const proof = fs.existsSync(proofPath) ? JSON.parse(fs.readFileSync(proofPath, 'utf8')) : null;
const sourceLabels = new Map((proof?.labels ?? []).map(label => [label.source_question_id, label]));
const normalized = value => value.replace(/\s+/g, ' ').trim();
const fingerprint = (prompt, choices) => createHash('sha256').update(JSON.stringify([normalized(prompt), choices.map(normalized)])).digest('hex');
let trusted = 0;
// Historical full-length imports also contain active questions. They are not
// the question-bank training corpus and must remain available for independent review.
const bankQuestions = questions.filter(q => {
  const draft = sourceDrafts.get(q.id);
  const source = sourceImports.get(q.source_pdf_id ?? draft?.pdf_import_id);
  return source?.text_quality?.document_family === 'question_bank' || sourceLabels.has(q.source_question_id);
});
const output = bankQuestions.map(q => {
  const draft = sourceDrafts.get(q.id);
  const source = sourceImports.get(q.source_pdf_id ?? draft?.pdf_import_id);
  const originalDifficulty = draft?.parser_original_snapshot?.difficulty;
  const choices = (q.choices ?? []).sort((a, b) => a.position - b.position).map(c => c.text);
  const sourceLabel = sourceLabels.get(q.source_question_id);
  const proofMatches = sourceLabel && sourceLabel.content_fingerprint === fingerprint(q.prompt, choices) &&
    sourceLabel.domain === q.domain && sourceLabel.skill === q.skill && sourceLabel.difficulty === q.difficulty;
  const difficultyVerified = proofMatches || source?.text_quality?.document_family === 'question_bank' && originalDifficulty != null && originalDifficulty === q.difficulty;
  if (difficultyVerified) trusted++;
  return { id: q.id, source_group: q.source_pdf_id ?? draft?.pdf_import_id ?? `unverified-bank-source`,
    passage_group: q.passage_id, duplicate_group: q.source_question_id,
    content: { section: q.section, question_type: q.question_type, prompt: q.prompt,
      passage: q.passage?.content ?? '', choices,
      requires_image: Boolean(q.stimulus_image_path) },
    domain: q.domain, skill: q.skill, difficulty: [1,3,5].includes(q.difficulty) ? q.difficulty : null,
    difficulty_provenance: difficultyVerified ? 'source' : 'unknown' };
});
const resolved = path.resolve(root, target);
if (!resolved.startsWith(path.resolve(root, 'ml-service/datasets') + path.sep)) throw new Error('Exports must stay in ignored ml-service/datasets');
fs.mkdirSync(path.dirname(resolved), { recursive: true });
fs.writeFileSync(resolved, output.map(q => JSON.stringify(q)).join('\n') + '\n', { flag: 'wx' });
fs.writeFileSync(resolved + '.manifest.json', JSON.stringify({
  source_project: 'wgkggknyndgaoyazdhdf', query: 'active question-bank questions only',
  created_at: new Date().toISOString(), grouping: 'whole-source-document, shared-passage, duplicate-id, exact-content',
  snapshot_sha256: createHash('sha256').update(fs.readFileSync(resolved)).digest('hex'),
  label_proof_sha256: proof ? createHash('sha256').update(fs.readFileSync(proofPath)).digest('hex') : null,
  original_pdf_sha256: proof?.pdf_sha256 ?? null,
  exported: output.length, trusted_difficulties: trusted,
}, null, 2), {flag:'wx'});
console.log(JSON.stringify({ exported: output.length, trusted_difficulties: trusted,
  excluded_non_bank_questions: questions.length - output.length,
  source_groups: new Set(output.map(q => q.source_group)).size, visual_questions: output.filter(q => q.content.requires_image).length, path: target }));
