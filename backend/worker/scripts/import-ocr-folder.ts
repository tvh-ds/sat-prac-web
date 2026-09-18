#!/usr/bin/env tsx
/**
 * Import mirrored post_ocr outputs into Supabase drafts (no Parse calls).
 *
 * For each <ocrRoot>/<rel>/<base>.ocr.txt:
 *   - loads page texts from the .ocr.txt
 *   - loads visual blocks from the sibling .parse.json
 *   - registers a pdf_imports row (original filename = source PDF name)
 *   - runs Pipeline.importSavedOcr (parse + pages + drafts + stimulus images
 *     rendered from the local source PDF)
 *
 * Afterwards a duplicate pass fingerprints every imported draft and flags
 * repeated occurrences as needs_review with duplicate metadata (flag only;
 * no replacements, no deletions, module structure untouched).
 *
 * Usage:
 *   npx tsx scripts/import-ocr-folder.ts "<pdfRoot>" "<ocrRoot>" [prefix...] [--report <path>] [--limit <n>]
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pipeline, type PageVisualInfo } from "../src/pipeline";
import { loadConfig } from "../src/config";
import { fingerprintQuestion } from "../src/duplicate";

function walk(dir: string, suffix: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, suffix, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(suffix)) out.push(p);
  }
}

function loadPages(txtPath: string): Array<{ pageNumber: number; text: string }> {
  const raw = readFileSync(txtPath, "utf8");
  const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
  const pages: Array<{ pageNumber: number; text: string }> = [];
  for (let i = 1; i < parts.length; i += 2) {
    pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
  }
  return pages;
}

function loadVisuals(txtPath: string): Record<number, PageVisualInfo> {
  const out: Record<number, PageVisualInfo> = {};
  try {
    const jp = txtPath.replace(/\.ocr\.txt$/, ".parse.json");
    if (!existsSync(jp)) return out;
    const j = JSON.parse(readFileSync(jp, "utf8")) as {
      pages?: Array<{ page: number; tableCount: number; imageCount: number; visuals?: Array<{ kind: string; description: string | null; category: string | null }> }>;
    };
    for (const p of j.pages ?? []) {
      if ((p.tableCount ?? 0) + (p.imageCount ?? 0) > 0) {
        out[p.page] = {
          imageCount: p.imageCount ?? 0,
          tableCount: p.tableCount ?? 0,
          notes: (p.visuals ?? []).map((v) => `${v.kind}: ${v.description ?? v.category ?? "visual"}`),
        };
      }
    }
  } catch {
    // no visuals — text-only import
  }
  return out;
}

async function loadAll<T>(sb: SupabaseClient, table: string, select: string, eq: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = sb.from(table).select(select);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw new Error(`read ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1]! : join("tmp", "import-ocr-report.json");
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(args[limIdx + 1]) : Infinity;
  const onlyIdx = args.indexOf("--only");
  const onlySub = onlyIdx >= 0 ? args[onlyIdx + 1]! : null;
  const positional = args.filter(
    (a, i) =>
      !(a === "--report" || a === "--limit" || a === "--only" || (repIdx >= 0 && i === repIdx + 1) || (limIdx >= 0 && i === limIdx + 1) || (onlyIdx >= 0 && i === onlyIdx + 1)),
  );
  const [pdfRoot, ocrRoot, ...prefixes] = positional;
  if (!pdfRoot || !ocrRoot) throw new Error('usage: import-ocr-folder.ts "<pdfRoot>" "<ocrRoot>" [prefix...] [--report <path>] [--limit <n>] [--only <substring>]');

  const cfg = loadConfig();
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
  const { data: admin } = await supabase.from("profiles").select("id").eq("role", "admin").limit(1).maybeSingle();
  if (!admin) throw new Error("No admin profile found; cannot set created_by.");

  const pipeline = new Pipeline({
    supabaseUrl: cfg.supabaseUrl,
    supabaseServiceKey: cfg.supabaseServiceKey,
    cohereApiKeys: cfg.cohereApiKeys,
    cohereKeyPageCap: cfg.cohereKeyPageCap,
    ocrModel: cfg.ocrModel,
    ocrProvider: cfg.ocrProvider,
    ocrMode: cfg.ocrMode,
  });

  const all: string[] = [];
  walk(ocrRoot, ".ocr.txt", all);
  all.sort();
  let files = all.filter((p) => {
    if (prefixes.length === 0) return true;
    const top = relative(ocrRoot, p).split(/[\\/]/)[0] ?? "";
    return prefixes.some((pre) => top.startsWith(pre));
  });
  if (onlySub) {
    const subs = onlySub.split(",").map((s) => s.trim()).filter(Boolean);
    files = files.filter((p) => subs.some((s) => p.includes(s)));
  }
  files = files.slice(0, limit);
  console.log(`found ${files.length} OCR fixtures`);

  const imported: Array<{ file: string; import_id: string | null; status: string; drafts: number; keys: number; error?: string }> = [];
  const importIds: string[] = [];

  for (const txtPath of files) {
    const rel = relative(ocrRoot, txtPath);
    const relDir = dirname(rel);
    const base = basename(txtPath, ".ocr.txt");
    const pdfPath = join(pdfRoot, relDir, `${base}.pdf`);
    if (!existsSync(pdfPath)) {
      console.log(`SKIP ${rel}: source PDF missing (${pdfPath})`);
      imported.push({ file: rel, import_id: null, status: "skipped", drafts: 0, keys: 0, error: "source PDF missing" });
      continue;
    }
    try {
      const buf = readFileSync(pdfPath);
      const { data: imp, error: impErr } = await supabase
        .from("pdf_imports")
        .insert({
          storage_path: `local-batch/${relDir}/${base}.pdf`,
          original_filename: `${base}.pdf`,
          file_size: buf.length,
          created_by: (admin as { id: string }).id,
        })
        .select("id")
        .single();
      if (impErr) throw new Error(`register import: ${impErr.message}`);
      const importId = (imp as { id: string }).id;
      const pages = loadPages(txtPath);
      const visuals = loadVisuals(txtPath);
      const result = await pipeline.importSavedOcr(importId, pages, visuals, new Uint8Array(buf));
      console.log(`[${imported.length + 1}/${files.length}] ${rel}: ${result.status} drafts=${result.drafts} keys=${result.suggestedKeys}`);
      imported.push({ file: rel, import_id: importId, status: result.status, drafts: result.drafts, keys: result.suggestedKeys, error: result.message });
      if (result.status === "completed") importIds.push(importId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[${imported.length + 1}/${files.length}] ${rel}: FAILED ${msg.slice(0, 200)}`);
      imported.push({ file: rel, import_id: null, status: "failed", drafts: 0, keys: 0, error: msg });
    }
  }

  // ---- Duplicate pass: fingerprint every imported draft, flag repeats ----
  console.log(`\nDuplicate pass over ${importIds.length} imports...`);
  type DraftRow = {
    id: string; pdf_import_id: string; page_number: number; section: string; question_type: string;
    prompt: string; passage_text: string | null; suggested_answer: string | null;
    source_module_name: string | null; source_question_number: number | null;
    status: string; parser_metadata: Record<string, unknown> | null;
  };
  type ChoiceRow = { draft_question_id: string; label: string | null; text: string; position: number };
  const drafts: DraftRow[] = [];
  for (const id of importIds) {
    drafts.push(...await loadAll<DraftRow>(supabase, "draft_questions", "id,pdf_import_id,page_number,section,question_type,prompt,passage_text,suggested_answer,source_module_name,source_question_number,status,parser_metadata", { pdf_import_id: id }));
  }
  const choices: ChoiceRow[] = [];
  for (const id of importIds) {
    // choices are keyed by draft; fetch per import via draft ids in chunks
    const ids = drafts.filter((d) => d.pdf_import_id === id).map((d) => d.id);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error } = await supabase.from("draft_question_choices").select("draft_question_id,label,text,position").in("draft_question_id", chunk);
      if (error) throw new Error(`read choices: ${error.message}`);
      choices.push(...((data ?? []) as ChoiceRow[]));
    }
  }
  const choicesByDraft = new Map<string, ChoiceRow[]>();
  for (const c of choices) {
    if (!choicesByDraft.has(c.draft_question_id)) choicesByDraft.set(c.draft_question_id, []);
    choicesByDraft.get(c.draft_question_id)!.push(c);
  }
  const fileByImport = new Map(imported.filter((r) => r.import_id).map((r) => [r.import_id as string, r.file]));
  const fpItems = drafts.map((d) => {
    const ch = (choicesByDraft.get(d.id) ?? []).sort((a, b) => a.position - b.position);
    return {
      fingerprint: fingerprintQuestion({
        section: d.section,
        questionType: d.question_type,
        passageText: d.passage_text,
        prompt: d.prompt,
        choices: ch.map((c) => ({ label: c.label ?? "", text: c.text })),
        suggestedAnswer: d.suggested_answer,
      }),
      occurrence: { draftId: d.id, file: fileByImport.get(d.pdf_import_id) ?? d.pdf_import_id },
    };
  });
  // group by fingerprint (reuse helper with file-scoped occurrence view)
  const byFp = new Map<string, Array<{ draftId: string; file: string }>>();
  for (const it of fpItems) {
    if (!byFp.has(it.fingerprint)) byFp.set(it.fingerprint, []);
    byFp.get(it.fingerprint)!.push(it.occurrence);
  }
  let flagged = 0;
  let groups = 0;
  const groupSummaries: Array<{ fingerprint: string; size: number; files: string[] }> = [];
  for (const [fp, occ] of byFp) {
    if (occ.length < 2) continue;
    groups++;
    occ.sort((a, b) => a.file.localeCompare(b.file));
    groupSummaries.push({ fingerprint: fp, size: occ.length, files: [...new Set(occ.map((o) => o.file))] });
    const [first, ...rest] = occ;
    for (const o of rest) {
      const d = drafts.find((x) => x.id === o.draftId)!;
      const meta = { ...(d.parser_metadata ?? {}), duplicate: { is_duplicate: true, fingerprint: fp, group_size: occ.length, canonical_file: first!.file, occurrences: occ.map((x) => x.file) } };
      const patch: Record<string, unknown> = { parser_metadata: meta };
      if (d.status !== "needs_review") patch.status = "needs_review";
      const { error } = await supabase.from("draft_questions").update(patch).eq("id", o.draftId);
      if (error) throw new Error(`flag duplicate: ${error.message}`);
      flagged++;
    }
    // annotate the canonical occurrence too (no status change)
    const firstDraft = drafts.find((x) => x.id === first!.draftId)!;
    const firstMeta = { ...(firstDraft.parser_metadata ?? {}), duplicate: { is_duplicate: false, fingerprint: fp, group_size: occ.length, occurrences: occ.map((x) => x.file) } };
    await supabase.from("draft_questions").update({ parser_metadata: firstMeta }).eq("id", first!.draftId);
  }
  console.log(`duplicate groups: ${groups}, flagged occurrences: ${flagged}`);

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ files: imported, duplicateGroups: groupSummaries, flagged }, null, 2));
  console.log(`Report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
