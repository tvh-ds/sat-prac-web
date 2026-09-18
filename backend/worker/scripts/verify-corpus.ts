#!/usr/bin/env tsx
/**
 * Corpus verification harness.
 *
 * Scans the `Tests Unparsed` corpus, runs the existing extractor + full-test
 * parser + answer-key parser against every PDF, and writes a report listing
 * where the parser succeeds, partially succeeds, or fails (including image-only
 * PDFs that need OCR).
 *
 * Usage:
 *   npx tsx scripts/verify-corpus.ts [corpusRoot] [--out path/to/report.json]
 *
 * Defaults:
 *   corpusRoot = "D:/SAT website/Tests Unparsed"
 *   out        = "tmp/full-test-parser-report.json"
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractText, analyzeTextQuality, type PageText } from "../src/extractor";
import { normalizeText } from "../src/textNormalize";
import { looksLikeQuestionBank, parseQuestionBank } from "../src/questionBankParser";
import { parseFullTest } from "../src/fullTestParser";
import { parseAnswerKey } from "../src/answerKey";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = "D:/SAT website/Tests Unparsed";
const DEFAULT_OUT = path.join(__dirname, "..", "tmp", "full-test-parser-report.json");

interface FileReport {
  file: string;
  path: string;
  pages: number;
  pagesNeedingOcr: number;
  textQuality: "good" | "poor";
  method: string;
  parser: string;
  status: "success" | "partial" | "needs_ocr" | "failed";
  questions: number;
  modules: Record<string, number>;
  moduleNames: string[];
  keyEntries: number;
  keyConfidence: number;
  bank: boolean;
  notes: string[];
}

function walkPdfs(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) out.push(p);
    }
  }
  return out.sort();
}

function diagnose(pages: PageText[]): FileReport {
  const quality = analyzeTextQuality(pages);
  const normalized = normalizeText(pages);

  const notes: string[] = [];

  // 1. Question-bank export?
  if (looksLikeQuestionBank(normalized)) {
    const bank = parseQuestionBank(normalized);
    const status: FileReport["status"] = bank.questions.length > 0 && bank.errors.length <= bank.questions.length * 0.2 ? "success" : "partial";
    if (bank.errors.length > 0) notes.push(`${bank.errors.length} parse errors`);
    const moduleNames: string[] = [];
    const modules: Record<string, number> = { "RW Question Bank": bank.questions.length };
    if (status !== "success") notes.push("bank parse had errors");
    return {
      file: "",
      path: "",
      pages: pages.length,
      pagesNeedingOcr: quality.pagesNeedingOcr.length,
      textQuality: quality.overall,
      method: "text",
      parser: "question-bank",
      status,
      questions: bank.questions.length,
      modules,
      moduleNames,
      keyEntries: bank.questions.filter((q) => q.correctAnswer).length,
      keyConfidence: 0.99,
      bank: true,
      notes,
    };
  }

  // 2. Full-test parser (any content scope, just count everything)
  const full = parseFullTest(normalized, { contentScope: "full_test" });
  const key = parseAnswerKey(normalized, full.questions.length);
  const modules: Record<string, number> = {};
  for (const m of full.modules) modules[m.name] = m.questionCount;
  const moduleNames = Object.keys(modules);

  const ocrRatio = pages.length > 0 ? quality.pagesNeedingOcr.length / pages.length : 1;

  // Heuristics
  let status: FileReport["status"];
  if (full.questions.length === 0) {
    if (ocrRatio > 0.5) status = "needs_ocr";
    else {
      status = "failed";
      notes.push("no questions parsed");
    }
  } else if (full.questions.length < 15) {
    status = "partial";
    notes.push(`only ${full.questions.length} questions parsed; likely needs OCR for full coverage`);
  } else {
    status = "success";
  }

  if (ocrRatio > 0.5 && full.questions.length < 20) {
    notes.push(`high OCR-need ratio (${ocrRatio.toFixed(0)}%) suggests image-heavy PDF`);
  }
  if (moduleNames.length === 0 && full.questions.length > 0) {
    notes.push("questions parsed but no module headings detected");
  }
  if (key.entries.length === 0) notes.push("no answer key entries found");
  else if (key.confidence < 0.5) notes.push(`low key confidence (${(key.confidence * 100).toFixed(0)}%)`);

  return {
    file: "",
    path: "",
    pages: pages.length,
    pagesNeedingOcr: quality.pagesNeedingOcr.length,
    textQuality: quality.overall,
    method: quality.pagesNeedingOcr.length > 0 ? "text" : "text",
    parser: "full-test",
    status,
    questions: full.questions.length,
    modules,
    moduleNames,
    keyEntries: key.entries.length,
    keyConfidence: key.confidence,
    bank: false,
    notes,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const corpusRoot = "D:/SAT website/Tests Unparsed";
  const { outPath, explicitRoot } = parseArgs(args, DEFAULT_ROOT, DEFAULT_OUT);
  const root = explicitRoot ?? corpusRoot;

  if (!fs.existsSync(root)) {
    console.error(`corpus root not found: ${root}`);
    process.exit(1);
  }

  const pdfs = walkPdfs(root);
  console.log(`Scanning ${pdfs.length} PDFs under ${root}\n`);

  const reports: FileReport[] = [];
  let needOcr = 0;
  let failed = 0;
  let success = 0;
  let partial = 0;

  for (const p of pdfs) {
    const rel = path.relative(root, p).replace(/\\/g, "/");
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(p);
    } catch (e) {
      reports.push({
        file: path.basename(p), path: rel, pages: 0, pagesNeedingOcr: 0, textQuality: "poor",
        method: "error", parser: "error", status: "failed", questions: 0, modules: {},
        moduleNames: [], keyEntries: 0, keyConfidence: 0, bank: false,
        notes: [`unreadable: ${e instanceof Error ? e.message : String(e)}`],
      });
      failed++;
      continue;
    }

    const started = Date.now();
    try {
      const pageTexts = await extractText(new Uint8Array(buffer));
      const report = diagnose(pageTexts);
      report.file = path.basename(p);
      report.path = rel;
      reports.push(report);
      if (report.status === "success") success++;
      else if (report.status === "partial") partial++;
      else if (report.status === "needs_ocr") needOcr++;
      else failed++;
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `${report.status.padEnd(10)} ${report.parser.padEnd(14)} q=${String(report.questions).padStart(5)} k=${String(report.keyEntries).padStart(4)} pages=${String(report.pages).padStart(4)} ocr=${String(report.pagesNeedingOcr).padStart(4)}  ${rel} (${seconds}s)`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      reports.push({
        file: path.basename(p), path: rel, pages: 0, pagesNeedingOcr: 0, textQuality: "poor",
        method: "error", parser: "error", status: "failed", questions: 0, modules: {},
        moduleNames: [], keyEntries: 0, keyConfidence: 0, bank: false, notes: [message],
      });
      console.error(`FAILED ${rel}: ${message}`);
      failed++;
    }
  }

  const summary = {
    scanned: pdfs.length,
    success,
    partial,
    needsOcr: needOcr,
    failed,
  };

fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, files: reports }, null, 2), "utf-8");

  // Write a human-readable success list
  const listPath = outPath.replace(/\.json$/, "-summary.md");
  const lines: string[] = [
    "# Full-Test Parser Corpus Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `## Summary (${pdfs.length} PDFs)`,
    "",
    `| Status | Count |`,
    `| --- | --- |`,
    `| Success | ${summary.success} |`,
    `| Partial | ${summary.partial} |`,
    `| Needs OCR | ${summary.needsOcr} |`,
    `| Failed | ${summary.failed} |`,
    "",
  ];
  lines.push("## Success (parser works on current text)", "");
  for (const r of reports.filter((r) => r.status === "success")) {
    lines.push(`- \`${r.path}\` — ${r.questions} questions, ${r.keyEntries} keys, ${r.pages} pages, method=${r.method}${r.notes.length ? ` (${r.notes.join("; ")})` : ""}`);
  }
  lines.push("", "## Partial (some coverage, OCR will likely help)", "");
  for (const r of reports.filter((r) => r.status === "partial")) {
    lines.push(`- \`${r.path}\` — ${r.questions} questions, ${r.keyEntries} keys, ${r.pages} pages, ${r.pagesNeedingOcr} OCR-needing${r.notes.length ? ` (${r.notes.join("; ")})` : ""}`);
  }
  lines.push("", "## Needs OCR (image-only or sparse — parser cannot run → fail-fast placeholder blocks until COHERE_API_KEY)", "");
  for (const r of reports.filter((r) => r.status === "needs_ocr")) {
    lines.push(`- \`${r.path}\` — ${r.pages} pages, ${r.pagesNeedingOcr} OCR-needing`);
  }
  lines.push("", "## Failed", "");
  const failedReports = reports.filter((r) => r.status === "failed");
  if (failedReports.length === 0) lines.push("(none)", "");
  for (const r of failedReports) lines.push(`- \`${r.path}\` — ${r.notes.join("; ")}`);
  fs.writeFileSync(listPath, lines.join("\n"), "utf-8");

  console.log(`\n=== Summary (${pdfs.length} PDFs) ==`);
  console.log(`success:      ${summary.success}`);
  console.log(`partial:      ${summary.partial}`);
  console.log(`needs OCR:    ${summary.needsOcr}`);
  console.log(`failed:       ${summary.failed}`);
  console.log(`\nReport written to ${outPath}`);
  console.log(`Summary list written to ${listPath}`);
}

/** Minimal arg parser: positional [root] and --out path flags. */
function parseArgs(args: string[], defaultRoot: string, defaultOut: string): { outPath: string; explicitRoot: string | null } {
  let outPath = defaultOut;
  let explicitRoot: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--out") outPath = args[++i] ?? defaultOut;
    else if (!a.startsWith("--")) explicitRoot = a;
  }
  return { outPath, explicitRoot };
}

void main();