/**
 * Recursive OCR batch: Parse-OCR every PDF under <srcRoot> (optionally
 * filtered to subfolders starting with given prefixes) and save mirrored
 * outputs under <outRoot>:
 *
 *   <srcRoot>/2025 03/202503asiav1.pdf
 *   -> <outRoot>/2025 03/202503asiav1.ocr.txt
 *   -> <outRoot>/2025 03/202503asiav1.parse.json
 *
 * Skips PDFs whose mirrored .ocr.txt + .parse.json both already exist
 * (resumable). Uses the rotating multi-key Parse provider from loadConfig().
 * No DB writes, no parser.
 *
 * Usage:
 *   npx tsx tmp/ocr-batch.ts "<srcRoot>" "<outRoot>" [prefix...] [--report <path>]
 * Example:
 *   npx tsx tmp/ocr-batch.ts "D:/SAT website/Tests Unparsed/Digital SAT Tests" "D:/SAT website/Tests Unparsed/post_ocr" 2025 2026
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, basename, relative, dirname } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderPagePng } from "../src/renderPage";
import {
  createParseProvider,
  fitImageForParse,
  parsePageTiled,
  PARSE_RENDER_SCALE,
  CohereParseProvider,
  type ParsePageResult,
} from "../src/ocr";
import { loadConfig } from "../src/config";

interface FileEntry {
  file: string;
  status: "done" | "skipped" | "failed" | "keys_exhausted";
  pages: number;
  billed: number;
  ms: number;
  error?: string;
}

function walkPdf(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkPdf(p, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) out.push(p);
  }
}

function isKeysExhausted(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /all API keys exhausted/i.test(msg);
}

async function main() {
  const args = process.argv.slice(2);
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1]! : join("tmp", "ocr-batch-report.json");
  const positional = args.filter((a, i) => !(a === "--report" || (repIdx >= 0 && i === repIdx + 1)));
  const [srcRoot, outRoot, ...prefixes] = positional;
  if (!srcRoot || !outRoot) {
    throw new Error('usage: ocr-batch.ts "<srcRoot>" "<outRoot>" [prefix...] [--report <path>]');
  }

  const cfg = loadConfig();
  console.log(
    `keys: ${cfg.cohereApiKeys.length} (cap ${cfg.cohereKeyPageCap} billed pages each), model ${cfg.ocrModel ?? "parse-v5.0"}`,
  );
  const provider = createParseProvider(cfg.ocrProvider, cfg.cohereApiKeys, cfg.ocrModel, cfg.cohereKeyPageCap);

  const all: string[] = [];
  walkPdf(srcRoot, all);
  all.sort();
  const files = all.filter((p) => {
    if (prefixes.length === 0) return true;
    const relDir = dirname(relative(srcRoot, p)).split(/[\\/]/)[0] ?? "";
    return prefixes.some((pre) => relDir.startsWith(pre));
  });
  console.log(`found ${files.length} PDFs (prefixes: ${prefixes.join(", ") || "(all)"})`);

  const results: FileEntry[] = [];
  let doneFiles = 0;
  let skippedFiles = 0;
  let billedTotal = 0;
  const t0 = Date.now();
  let halted = false;

  for (const pdfPath of files) {
    const rel = relative(srcRoot, pdfPath);
    const relDir = dirname(rel);
    const base = basename(pdfPath, ".pdf");
    const destDir = join(outRoot, relDir);
    const txtPath = join(destDir, `${base}.ocr.txt`);
    const jsonPath = join(destDir, `${base}.parse.json`);
    if (existsSync(txtPath) && existsSync(jsonPath) && statSync(txtPath).size > 0 && statSync(jsonPath).size > 0) {
      results.push({ file: rel, status: "skipped", pages: 0, billed: 0, ms: 0 });
      skippedFiles++;
      continue;
    }
    const ft0 = Date.now();
    try {
      const bytes = readFileSync(pdfPath);
      const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
      mkdirSync(destDir, { recursive: true });
      const pages: Array<{
        page: number;
        text: string;
        visuals: ParsePageResult["visuals"];
        tableCount: number;
        imageCount: number;
        textBlockCount: number;
        billedPages: number;
        ocrMs: number;
        error?: string;
      }> = [];
      let billed = 0;
      let failed = false;
      for (let p = 1; p <= pdf.numPages; p++) {
        const pt0 = Date.now();
        try {
          const png = await renderPagePng(new Uint8Array(bytes), p, PARSE_RENDER_SCALE);
          const fitted = await fitImageForParse(png);
          const parsed = await parsePageTiled(provider, fitted);
          billed += parsed.billedPages;
          pages.push({
            page: p,
            text: parsed.text,
            visuals: parsed.visuals,
            tableCount: parsed.tableCount,
            imageCount: parsed.imageCount,
            textBlockCount: parsed.textBlockCount,
            billedPages: parsed.billedPages,
            ocrMs: Date.now() - pt0,
          });
        } catch (e) {
          if (isKeysExhausted(e)) throw e;
          const msg = e instanceof Error ? e.message : String(e);
          pages.push({
            page: p,
            text: "",
            visuals: [],
            tableCount: 0,
            imageCount: 0,
            textBlockCount: 0,
            billedPages: 0,
            ocrMs: Date.now() - pt0,
            error: msg,
          });
          failed = true;
          console.log(`  page ${p}/${pdf.numPages}: FAILED ${msg.slice(0, 160)}`);
        }
      }
      const totalMs = Date.now() - ft0;
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            file: basename(pdfPath),
            pages: pdf.numPages,
            ocrProvider: provider.name,
            ocrModel: provider.model,
            billedParsePages: billed,
            totalOcrMs: totalMs,
            pages,
          },
          null,
          2,
        ),
      );
      writeFileSync(
        txtPath,
        pages.map((pg) => `===== PAGE ${pg.page} =====\n${pg.error ? `[OCR ERROR] ${pg.error}\n` : pg.text}`).join("\n\n"),
      );
      await pdf.destroy();
      billedTotal += billed;
      doneFiles++;
      results.push({ file: rel, status: failed ? "failed" : "done", pages: pdf.numPages, billed, ms: totalMs });
      const keysUsed =
        provider instanceof CohereParseProvider ? provider.billedPagesByKey().join("+") : "?";
      console.log(
        `[${doneFiles + skippedFiles}/${files.length}] ${rel}: ${pdf.numPages} pages, billed=${billed}, ${Math.round(totalMs / 1000)}s${failed ? " (page errors)" : ""} | keys used: ${keysUsed}`,
      );
    } catch (e) {
      if (isKeysExhausted(e)) {
        console.log(`KEYS EXHAUSTED at ${rel}; stopping batch (resume later).`);
        results.push({ file: rel, status: "keys_exhausted", pages: 0, billed: 0, ms: Date.now() - ft0 });
        halted = true;
        break;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[${doneFiles + skippedFiles + 1}/${files.length}] ${rel}: FILE FAILED ${msg.slice(0, 200)}`);
      results.push({ file: rel, status: "failed", pages: 0, billed: 0, ms: Date.now() - ft0, error: msg });
    }
  }

  const summary = {
    srcRoot,
    outRoot,
    prefixes,
    finished_at: new Date().toISOString(),
    halted_keys_exhausted: halted,
    totals: {
      files: files.length,
      done: results.filter((r) => r.status === "done").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: skippedFiles,
      billed_parse_pages: billedTotal,
      elapsed_ms: Date.now() - t0,
    },
    keys_billed: provider instanceof CohereParseProvider ? provider.billedPagesByKey() : [],
    files: results,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(
    `\nBatch ${halted ? "HALTED (keys exhausted)" : "complete"}: done=${summary.totals.done} failed=${summary.totals.failed} skipped=${summary.totals.skipped} billed=${billedTotal} elapsed=${Math.round((Date.now() - t0) / 60000)}m`,
  );
  console.log(`Report: ${reportPath}`);
  if (halted) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
