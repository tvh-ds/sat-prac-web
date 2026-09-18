/**
 * OCR-only dump: Parse-OCR every page of a PDF and save the raw pre-parser
 * output (per-page text + visual blocks) to an output folder.
 * No DB writes, no parser — run: npx tsx tmp/parse-ocr-dump.ts <pdf> <outDir>
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderPagePng } from "../src/renderPage";
import {
  createParseProvider,
  fitImageForParse,
  parsePageTiled,
  PARSE_RENDER_SCALE,
  type ParsePageResult,
} from "../src/ocr";
import { loadConfig } from "../src/config";

async function main() {
  const [pdfPath, outDir, onlyFrom, onlyTo] = process.argv.slice(2);
  if (!pdfPath || !outDir) throw new Error("usage: parse-ocr-dump.ts <pdf> <outDir> [fromPage] [toPage]");
  const cfg = loadConfig();
  console.log(`keys: ${cfg.cohereApiKeys.length} (cap ${cfg.cohereKeyPageCap} billed pages each)`);
  const provider = createParseProvider(cfg.ocrProvider, cfg.cohereApiKeys, cfg.ocrModel, cfg.cohereKeyPageCap);
  const bytes = readFileSync(pdfPath);
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  mkdirSync(outDir, { recursive: true });
  const base = basename(pdfPath, ".pdf");
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
  const t0 = Date.now();
  const from = Math.max(1, Number(onlyFrom ?? 1));
  const to = Math.min(pdf.numPages, Number(onlyTo ?? pdf.numPages));
  for (let p = from; p <= to; p++) {
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
      console.log(
        `page ${p}/${pdf.numPages}: fitted=${fitted.width}x${fitted.height} chars=${parsed.text.length} visuals=${parsed.visuals.length} billed=${parsed.billedPages} ${Date.now() - pt0}ms`,
      );
    } catch (e) {
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
      console.log(`page ${p}/${pdf.numPages}: FAILED ${msg}`);
    }
  }
  const totalMs = Date.now() - t0;
  writeFileSync(
    join(outDir, `${base}.parse.json`),
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
    join(outDir, `${base}.ocr.txt`),
    pages.map((pg) => `===== PAGE ${pg.page} =====\n${pg.error ? `[OCR ERROR] ${pg.error}\n` : pg.text}`).join("\n\n"),
  );
  console.log(`done: ${pdf.numPages} pages, billed=${billed}, total=${totalMs}ms`);
  await pdf.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
