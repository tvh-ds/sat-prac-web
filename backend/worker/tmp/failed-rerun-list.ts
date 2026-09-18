/** List failed parse fixtures and their DB import state for selective rerun. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

async function main() {
  const rep = JSON.parse(readFileSync("tmp/parse-batch-2025-2026.json", "utf8")) as {
    files: Array<{ file: string; status: string; questions: number; keysMatched: string }>;
  };
  const failed = rep.files.filter((f) => f.status !== "PASS");
  const cfg = loadConfig();
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
  const onlySubs: string[] = [];
  for (const f of failed) {
    const pdf = `${basename(f.file).replace(/\.ocr\.txt$/, "")}.pdf`;
    const { data: imps } = await sb
      .from("pdf_imports")
      .select("id,original_filename,status")
      .eq("original_filename", pdf)
      .like("storage_path", "local-batch/%");
    const imp = (imps ?? [])[0] as
      | { id: string; original_filename: string; status: string }
      | undefined;
    if (!imp) {
      console.log(`SKIP-NOT-IMPORTED ${pdf} (q=${f.questions} keys=${f.keysMatched})`);
      continue;
    }
    const { count: linked } = await sb.from("questions").select("id", { count: "exact", head: true }).eq("source_pdf_id", imp.id);
    const { count: drafts } = await sb.from("draft_questions").select("id", { count: "exact", head: true }).eq("pdf_import_id", imp.id);
    const blocked = (linked ?? 0) > 0;
    console.log(
      `${blocked ? "BLOCKED-LINKED" : "RERUN"} ${pdf} import=${imp.status} drafts=${drafts ?? 0} linked=${linked ?? 0} (q=${f.questions} keys=${f.keysMatched})`,
    );
    if (!blocked) onlySubs.push(basename(f.file).replace(/\.ocr\.txt$/, ""));
  }
  console.log(`\n--only "${onlySubs.join(",")}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
