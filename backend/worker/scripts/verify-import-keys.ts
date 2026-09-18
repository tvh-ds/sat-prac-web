#!/usr/bin/env tsx
/**
 * Verify imported draft answers against the OCR key table (parsed live).
 * Usage: npx tsx scripts/verify-import-keys.ts "<original_filename>" [...]
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import { parseFullTest } from "../src/fullTestParser";
import { normalizeText } from "../src/textNormalize";

function findOcr(root: string, base: string): string | null {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name === `${base}.ocr.txt`) out.push(p);
    }
  };
  walk(root);
  return out[0] ?? null;
}

async function main() {
  const names = process.argv.slice(2);
  if (names.length === 0) throw new Error("usage: verify-import-keys.ts <original_filename> [...]");
  const cfg = loadConfig();
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
  const ocrRoot = "D:/SAT website/Tests Unparsed/post_ocr";

  for (const name of names) {
    const { data: imp } = await supabase.from("pdf_imports").select("id").eq("original_filename", name).like("storage_path", "local-batch/%").maybeSingle();
    if (!imp) {
      console.log(`${name}: no local-batch import`);
      continue;
    }
    const { data: drafts } = await supabase
      .from("draft_questions")
      .select("source_module_name,source_question_number,suggested_answer")
      .eq("pdf_import_id", (imp as { id: string }).id);
    const txt = findOcr(ocrRoot, name.replace(/\.pdf$/, ""));
    if (!txt) {
      console.log(`${name}: no OCR fixture`);
      continue;
    }
    const raw = readFileSync(txt, "utf8");
    const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
    const pages: Array<{ pageNumber: number; text: string }> = [];
    for (let i = 1; i < parts.length; i += 2) {
      pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
    }
    const res = parseFullTest(normalizeText(pages) as never, { contentScope: "full_test", targetModule: null });
    let match = 0;
    let mismatch = 0;
    const bad: string[] = [];
    for (const d of (drafts ?? []) as Array<{ source_module_name: string | null; source_question_number: number | null; suggested_answer: string | null }>) {
      if (!d.suggested_answer) continue;
      const hit = res.keyMap.get(`${d.source_module_name}|${d.source_question_number}`);
      if (!hit) continue;
      if (hit.answer === d.suggested_answer) match++;
      else {
        mismatch++;
        if (bad.length < 5) bad.push(`${d.source_module_name}#${d.source_question_number}: db=${d.suggested_answer} ocr=${hit.answer}`);
      }
    }
    console.log(`${name}: key agreement ${match}/${match + mismatch}${bad.length ? " MISMATCH: " + bad.join(" | ") : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
