#!/usr/bin/env tsx
/** Count drafts whose suggested key is NOT in the parser keyMap (positional/inferred only). */
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
  const cfg = loadConfig();
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
  const ocrRoot = "D:/SAT website/Tests Unparsed/post_ocr";
  const { data: imports } = await supabase.from("pdf_imports").select("id,original_filename").like("storage_path", "local-batch/%");
  for (const imp of (imports ?? []) as Array<{ id: string; original_filename: string }>) {
    const { data: drafts } = await supabase
      .from("draft_questions")
      .select("source_module_name,source_question_number,suggested_answer")
      .eq("pdf_import_id", imp.id);
    const txt = findOcr(ocrRoot, imp.original_filename.replace(/\.pdf$/, ""));
    if (!txt) continue;
    const raw = readFileSync(txt, "utf8");
    const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
    const pages: Array<{ pageNumber: number; text: string }> = [];
    for (let i = 1; i < parts.length; i += 2) {
      pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
    }
    const res = parseFullTest(normalizeText(pages) as never, { contentScope: "full_test", targetModule: null });
    let suggested = 0;
    let unverified = 0;
    for (const d of (drafts ?? []) as Array<{ source_module_name: string | null; source_question_number: number | null; suggested_answer: string | null }>) {
      if (!d.suggested_answer) continue;
      suggested++;
      if (!res.keyMap.has(`${d.source_module_name}|${d.source_question_number}`)) unverified++;
    }
    if (unverified > 0) console.log(`${imp.original_filename}: suggested=${suggested} keymap-unverified=${unverified}`);
  }
  console.log("coverage check done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
