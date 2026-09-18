#!/usr/bin/env node
/**
 * Backfill full-page stimulus renders for visual drafts inserted without a
 * rendered image (stimulus_image_path IS NULL). Renders each needed PDF page
 * once, uploads it to question-assets, and updates both the draft and any
 * linked published question.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { renderPagePng } from "../src/renderPage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://ygqndcgpbtmewzkruyuq.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (see backend/worker/.env)");
const PDF_PATH = path.resolve(__dirname, "../../../Tests Unparsed/Full RW Question Bank With Key.pdf");
const PAGE = 1000;

interface VisualDraft {
  id: string;
  source_question_id: string | null;
  source_question_number: number;
  page_number: number;
  question_id: string | null;
}

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`PDF not found: ${PDF_PATH}`);
    process.exit(1);
  }
  const pdfBuffer = new Uint8Array(fs.readFileSync(PDF_PATH));
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: imp, error: impErr } = await supabase
    .from("pdf_imports")
    .select("id")
    .eq("storage_path", "local-no-upload")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (impErr || !imp) {
    console.error("No import found:", impErr?.message ?? "none");
    process.exit(1);
  }
  const importId = imp.id as string;
  console.log(`Import: ${importId}`);

  const drafts: VisualDraft[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("draft_questions")
      .select("id, source_question_id, source_question_number, page_number, question_id")
      .eq("pdf_import_id", importId)
      .eq("has_visual_stimulus", true)
      .is("stimulus_image_path", null)
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("Fetch visual drafts failed:", error.message);
      process.exit(1);
    }
    drafts.push(...((data ?? []) as VisualDraft[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  console.log(`Visual drafts missing renders: ${drafts.length}`);
  if (drafts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const paths = new Map<string, VisualDraft[]>();
  const pagesNeeded = new Set<number>();
  for (const d of drafts) {
    const key = d.source_question_id ?? String(d.source_question_number);
    const p = `imports/${importId}/stimuli/${key}-page-${d.page_number}.png`;
    if (!paths.has(p)) paths.set(p, []);
    paths.get(p)!.push(d);
    pagesNeeded.add(d.page_number);
  }
  console.log(`Unique paths: ${paths.size}, unique pages: ${pagesNeeded.size}`);

  const failedPages = new Set<number>();
  let uploaded = 0;
  let pageIndex = 0;
  for (const [p, linked] of paths) {
    const pageNumber = linked[0].page_number;
    pageIndex++;
    let png: Buffer;
    try {
      png = await renderPagePng(pdfBuffer, pageNumber, 2);
      console.log(`[${pageIndex}/${paths.size}] rendered page ${pageNumber} -> ${p.split("/").pop()}`);
    } catch {
      failedPages.add(pageNumber);
      console.error(`[${pageIndex}/${paths.size}] render failed for page ${pageNumber}; skipping ${p}`);
      continue;
    }
    const { error: upErr } = await supabase.storage.from("question-assets").upload(p, png, {
      contentType: "image/png",
      upsert: true,
    });
    if (upErr) {
      console.error(`Upload failed for ${p}: ${upErr.message}`);
      continue;
    }
    uploaded += 1;

    const draftIds = linked.map((d) => d.id);
    const { error: dErr } = await supabase
      .from("draft_questions")
      .update({ stimulus_image_path: p })
      .in("id", draftIds);
    if (dErr) console.error(`Update drafts failed for ${p}: ${dErr.message}`);

    const linkedQuestions = linked.filter((d) => d.question_id).map((d) => d.question_id!);
    if (linkedQuestions.length > 0) {
      const { error: qErr } = await supabase
        .from("questions")
        .update({ stimulus_image_path: p })
        .in("id", linkedQuestions);
      if (qErr) console.error(`Update questions failed for ${p}: ${qErr.message}`);
    }
  }
  console.log(`Uploaded ${uploaded}/${paths.size} renders. Failed pages: ${failedPages.size > 0 ? [...failedPages].sort((a, b) => a - b).join(", ") : "none"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});