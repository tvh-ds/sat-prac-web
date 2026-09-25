#!/usr/bin/env tsx
/** OCR a frozen-cohort PDF that had no saved OCR, using COHERE_API_KEY_4 only. */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractText } from "../src/extractor.ts";
import { renderPagePng } from "../src/renderPage.ts";
import { createParseProvider, fitImageForParse, parsePageTiled, PARSE_RENDER_SCALE } from "../src/ocr.ts";

const id = process.argv[2];
const root = path.resolve(import.meta.dirname, "../../..");
const outRoot = path.join(root, "backend/worker/tmp/refinement");
const manifest = JSON.parse(readFileSync(path.join(outRoot, "cohort.json"), "utf8"));
const record = manifest.cohort.find((entry: any) => entry.row.id === id);
if (!record || record.source.ocr || record.source.storedPages || !record.source.pdf) {
  throw new Error("usage: ocr-refinement.ts <frozen PDF-only cohort import id>");
}
const pdf = readFileSync(path.join(root, record.source.pdf));
const hash = createHash("sha256").update(pdf).digest("hex");
if (hash !== record.source.pdfSha256) throw new Error("source PDF changed since baseline");
const key = process.env.COHERE_API_KEY_4;
if (!key) throw new Error("COHERE_API_KEY_4 is not configured");
const provider = createParseProvider("cohere_parse", [key], "parse-v5.0");
const selectable = await extractText(new Uint8Array(pdf));
const pages: Array<{ pageNumber: number; text: string; visuals: unknown[]; ocrMs: number; billedPages: number; error?: string }> = [];
const started = Date.now();
for (const page of selectable) {
  const t = Date.now();
  try {
    const png = await renderPagePng(new Uint8Array(pdf), page.pageNumber, PARSE_RENDER_SCALE);
    const output = await parsePageTiled(provider, await fitImageForParse(png));
    pages.push({ pageNumber: page.pageNumber, text: output.text.trim() || page.text,
      visuals: output.visuals, ocrMs: Date.now() - t, billedPages: output.billedPages });
    console.log(`${record.row.original_filename}: page ${page.pageNumber}/${selectable.length} OCR ok`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pages.push({ pageNumber: page.pageNumber, text: page.text, visuals: [],
      ocrMs: Date.now() - t, billedPages: 0, error: message });
    console.warn(`${record.row.original_filename}: page ${page.pageNumber} OCR failed: ${message.slice(0, 180)}`);
  }
  writeFileSync(path.join(outRoot, `new-ocr-${id}.json`), JSON.stringify({ id, name: record.row.original_filename,
    pdfSha256: hash, generatedAt: new Date().toISOString(), elapsedMs: Date.now() - started, pages }, null, 2));
}
console.log(JSON.stringify({ id, pages: pages.length, failed: pages.filter((p) => p.error).length,
  billedPages: pages.reduce((n, p) => n + p.billedPages, 0), elapsedMs: Date.now() - started }));
