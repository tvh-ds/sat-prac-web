#!/usr/bin/env tsx
/** Read-only detail probe for a frozen refinement import. */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { normalizeText } from "../src/textNormalize.ts";
import { Pipeline } from "../src/pipeline.ts";
import { parseScraperQuestions } from "../src/scraperParser.ts";

const name = process.argv[2];
if (!name) throw new Error("usage: probe-refinement.ts <filename>");
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(readFileSync(path.join(repoRoot, "backend/worker/tmp/refinement/cohort.json"), "utf8"));
const record = [...manifest.cohort, ...manifest.controls].find((entry: any) => entry.row.original_filename === name);
if (!record) throw new Error(`not in frozen cohort or controls: ${name}`);
const newOcrPath = path.join(repoRoot, `backend/worker/tmp/refinement/new-ocr-${record.row.id}.json`);
const newOcr = existsSync(newOcrPath) ? readFileSync(newOcrPath, "utf8") : null;
const pages = newOcr ? JSON.parse(newOcr).pages : record.source.ocr
  ? (() => {
      const raw = readFileSync(path.join(repoRoot, record.source.ocr), "utf8");
      const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
      const out: Array<{ pageNumber: number; text: string }> = [];
      for (let i = 1; i < parts.length; i += 2) out.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
      return out;
    })()
  : record.source.storedPages;
if (!pages) throw new Error(`saved or stored OCR unavailable for ${name}`);
const cfg = loadConfig();
const pipeline = new Pipeline({ supabaseUrl: cfg.supabaseUrl, supabaseServiceKey: cfg.supabaseServiceKey,
  cohereApiKeys: cfg.cohereApiKeys, cohereKeyPageCap: cfg.cohereKeyPageCap,
  ocrModel: cfg.ocrModel, ocrProvider: cfg.ocrProvider, ocrMode: cfg.ocrMode });
const parsed = (pipeline as any).parseAll(normalizeText(pages), "full_test");
const matched = (pipeline as any).matchAnswers(parsed);
const base = parseScraperQuestions(normalizeText(pages));
const baseModules = base.modules;
if (process.argv[3] === "math-blocks") {
  const blocks: Array<{ n: number; page: number; lines: string[] }> = [];
  for (const page of pages.filter((item: any) => item.pageNumber >= 33 && item.pageNumber <= 52)) {
    for (const line of page.text.split("\n")) {
      const marker = line.trim().match(/^(\d{1,2})\.\s*$/);
      if (marker) blocks.push({ n: Number(marker[1]), page: page.pageNumber, lines: [] });
      else if (blocks.length) blocks.at(-1)!.lines.push(line);
    }
  }
  blocks.forEach((block, index) => {
    const mod = index < 22 ? 1 : 2;
    const parsedBlock = parseScraperQuestions([{ pageNumber: block.page,
      text: `# Math Module ${mod}\n1\n${block.lines.join("\n")}` }]);
    console.log(index + 1, block.n, block.page, parsedBlock.questions.length,
      parsedBlock.questions[0]?.prompt.slice(0, 95) ?? "", parsedBlock.questions[0]?.choices.length ?? 0);
    if (!parsedBlock.questions.length) console.log("UNPARSED", JSON.stringify(block.lines.slice(0, 20)));
  });
  process.exit(0);
}
if (process.argv[3] === "base-slots") {
  base.questions.forEach((q, index) => console.log(`${index + 1}\t${q.sourceQuestionNumber}\t${q.sourceQuestionNumberOrigin}\tpage ${q.pageNumber}\t${q.prompt.slice(0, 110)}`));
  process.exit(0);
}
if (process.argv[3] === "slots") {
  for (const q of parsed.questions) console.log(`${q.sourceModuleName}|${q.sourceQuestionNumber}\tpage ${q.pageNumber}\t${q.prompt.slice(0, 130)}\t${q.parseFlags.join(",")}`);
  process.exit(0);
}
const keys = parsed.fullTest?.keyEntries ?? parsed.scraper?.keys ?? [];
if (process.argv[3] === "keys") {
  for (const k of keys) console.log(`${k.column ?? "-"}\t${k.questionNumber}\t${k.answer}\t${k.moduleName ?? "-"}\t${k.inferredModule ?? "-"}\tpage ${k.pageNumber}`);
  process.exit(0);
}
const byModule = new Map<string, { questions: number; entries: number; matched: number; unresolved: number; keyNumbers: number[] }>();
for (const q of parsed.questions) {
  const module = q.sourceModuleName ?? "Global";
  const rec = byModule.get(module) ?? { questions: 0, entries: 0, matched: 0, unresolved: 0, keyNumbers: [] };
  rec.questions++;
  if (q.parseFlags.includes("source_question_id_unresolved") || q.parseFlags.includes("duplicate_source_number_conflict")) rec.unresolved++;
  byModule.set(module, rec);
}
for (const k of keys) {
  const module = k.moduleName ?? k.inferredModule ?? "Global";
  const rec = byModule.get(module) ?? { questions: 0, entries: 0, matched: 0, unresolved: 0, keyNumbers: [] };
  rec.entries++;
  rec.keyNumbers.push(k.questionNumber);
  byModule.set(module, rec);
}
parsed.questions.forEach((q: any, index: number) => {
  if (matched.answers[index]) byModule.get(q.sourceModuleName ?? "Global")!.matched++;
});
console.log(JSON.stringify({ name, documentFamily: parsed.fullTest?.documentFamily ?? (parsed.bank ? "bank" : null), baseModules,
  questions: parsed.questions.length, entries: matched.keyEntries, unmatched: matched.unmatchedKeyEntries.length,
  byModule: Object.fromEntries([...byModule].map(([module, rec]) => [module, {
    ...rec, minKey: Math.min(...rec.keyNumbers), maxKey: Math.max(...rec.keyNumbers),
    duplicateKeyNumbers: rec.keyNumbers.filter((n, i) => rec.keyNumbers.indexOf(n) !== i).slice(0, 20),
    keyNumbers: undefined,
  }])),
  problemQuestions: parsed.questions.map((q: any, index: number) => ({ page: q.pageNumber, module: q.sourceModuleName,
    number: q.sourceQuestionNumber, flags: q.parseFlags, matched: matched.answers[index]?.answer ?? null,
    prompt: String(q.prompt).slice(0, 120) })).filter((q: any) => q.flags.length || !q.matched).slice(0, 80),
  unmatchedKeys: matched.unmatchedKeyEntries.slice(0, 80),
}, null, 2));
