/**
 * Batch parse: run the parser over every mirrored .ocr.txt under <outRoot>
 * (optionally filtered to top-level prefixes), report module validity + key
 * coverage per file, and compute cross-file duplicate groups (flag only).
 * No Parse calls, no DB writes.
 *
 * Usage:
 *   npx tsx tmp/parse-batch.ts "<outRoot>" [prefix...] [--report <path>]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { parseFullTest } from "../src/fullTestParser";
import { evaluateModuleCompleteness } from "../src/scraperParser";
import { normalizeText } from "../src/textNormalize";
import {
  fingerprintQuestion,
  stemBucket,
  groupExactDuplicates,
  type DuplicateOccurrence,
} from "../src/duplicate";

function walkTxt(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTxt(p, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".ocr.txt")) out.push(p);
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

function visualPages(txtPath: string): number[] {
  try {
    const jp = txtPath.replace(/\.ocr\.txt$/, ".parse.json");
    if (!existsSync(jp)) return [];
    const j = JSON.parse(readFileSync(jp, "utf8")) as {
      pages?: Array<{ page: number; tableCount: number; imageCount: number }>;
    };
    return (j.pages ?? []).filter((p) => (p.tableCount ?? 0) + (p.imageCount ?? 0) > 0).map((p) => p.page);
  } catch {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1]! : join("tmp", "parse-batch-report.json");
  const positional = args.filter((a, i) => !(a === "--report" || (repIdx >= 0 && i === repIdx + 1)));
  const [outRoot, ...prefixes] = positional;
  if (!outRoot) throw new Error('usage: parse-batch.ts "<outRoot>" [prefix...] [--report <path>]');

  const all: string[] = [];
  walkTxt(outRoot, all);
  all.sort();
  const files = all.filter((p) => {
    if (prefixes.length === 0) return true;
    const top = relative(outRoot, p).split(/[\\/]/)[0] ?? "";
    return prefixes.some((pre) => top.startsWith(pre));
  });
  if (files.length === 0) {
    console.log("no .ocr.txt files found");
    return;
  }

  const fpItems: Array<{ fingerprint: string; occurrence: DuplicateOccurrence }> = [];
  const stemItems: Array<{ bucket: string; occurrence: DuplicateOccurrence }> = [];
  const fileRows: Array<Record<string, unknown>> = [];
  let pass = 0;

  for (const f of files) {
    const rel = relative(outRoot, f);
    const pages = normalizeText(loadPages(f));
    const res = parseFullTest(pages as never, { contentScope: "full_test", targetModule: null });
    const mods = res.modules.map((m) => {
      const expected = m.section === "math" ? 22 : 27;
      const status = m.questionCount === expected ? "VALID" : m.questionCount > expected ? "OVER" : "PARTIAL";
      return { name: m.name, actual: m.questionCount, expected, status, startPage: m.startPage, endPage: m.endPage };
    });
    const byModule = new Map<string, number[]>();
    for (const e of res.keyEntries) {
      const m = e.moduleName ?? e.inferredModule ?? "global";
      if (!byModule.has(m)) byModule.set(m, []);
      byModule.get(m)!.push(e.questionNumber);
    }
    // Orphan reassignment (mirrors fullTestParser): keys tagged to a module
    // with no such question move to the unique module holding that number.
    {
      const have = new Set(res.questions.map((q) => `${q.sourceModuleName}|${q.sourceQuestionNumber}`));
      const claimed = new Set<string>();
      for (const [m, ns] of byModule) for (const n of ns) if (have.has(`${m}|${n}`)) claimed.add(`${m}|${n}`);
      for (const e of res.keyEntries) {
        if (!e.moduleName || have.has(`${e.moduleName}|${e.questionNumber}`)) continue;
        const needy = res.questions.filter(
          (q) => q.sourceQuestionNumber === e.questionNumber && !claimed.has(`${q.sourceModuleName}|${q.sourceQuestionNumber}`),
        );
        const mods = [...new Set(needy.map((q) => q.sourceModuleName))];
        if (mods.length === 1) {
          const k = `${mods[0]}|${e.questionNumber}`;
          if (!byModule.get(mods[0])!.includes(e.questionNumber)) byModule.get(mods[0])!.push(e.questionNumber);
          claimed.add(k);
        }
      }
    }
    let matched = 0;
    const unmatched: string[] = [];
    for (const q of res.questions) {
      const keys = byModule.get(q.sourceModuleName) ?? [];
      if (keys.includes(q.sourceQuestionNumber)) matched++;
      else unmatched.push(`${q.sourceModuleName}#${q.sourceQuestionNumber}`);
    }
    const ok = mods.every((m) => m.status === "VALID") && matched === res.questions.length;
    if (ok) pass++;
    fileRows.push({
      file: rel,
      pages: pages.length,
      questions: res.questions.length,
      keyEntries: res.keyEntries.length,
      modules: mods,
      keysMatched: `${matched}/${res.questions.length}`,
      unmatched: unmatched.slice(0, 10),
      visualPages: visualPages(f),
      status: ok ? "PASS" : "FAIL",
    });
    for (const q of res.questions) {
      const fp = fingerprintQuestion({
        section: q.section,
        questionType: q.questionType,
        passageText: q.passageText,
        prompt: q.prompt,
        choices: q.choices.map((c) => ({ label: c.label, text: c.text })),
      });
      const occ = {
        file: rel,
        moduleName: q.sourceModuleName,
        questionNumber: q.sourceQuestionNumber,
        pageNumber: q.pageNumber,
      };
      fpItems.push({ fingerprint: fp, occurrence: occ });
      stemItems.push({ bucket: stemBucket({ section: q.section, questionType: q.questionType, passageText: null, prompt: q.prompt, choices: q.choices.map((c) => ({ label: c.label, text: c.text })) }), occurrence: occ });
    }
  }

  const dupGroups = groupExactDuplicates(fpItems);
  // Near-duplicate review buckets: same stem bucket, different fingerprint.
  const byStem = new Map<string, Set<string>>();
  for (const s of stemItems) {
    if (!byStem.has(s.bucket)) byStem.set(s.bucket, new Set());
    byStem.get(s.bucket)!.add(s.occurrence.file + "#" + s.occurrence.questionNumber);
  }

  console.log(`\nfiles: ${files.length}, PASS ${pass}, FAIL ${files.length - pass}`);
  for (const r of fileRows) {
    console.log(`\n### ${r.file} (${r.pages} pages, ${r.questions} questions, keys ${r.keysMatched})`);
    for (const m of (r.modules as Array<{ name: string; actual: number; expected: number; status: string }>)!) {
      console.log(`  ${m.name}: ${m.actual}/${m.expected} ${m.status}`);
    }
    const un = r.unmatched as string[];
    if (un.length) console.log(`  unmatched: ${un.join(", ")}`);
    const vp = r.visualPages as number[];
    if (vp.length) console.log(`  visual pages: [${vp.join(", ")}]`);
    console.log(`  => ${r.status}`);
  }
  console.log(`\nduplicate groups (exact, size>=2): ${dupGroups.length}`);
  for (const g of dupGroups.slice(0, 50)) {
    console.log(`  ${g.fingerprint.slice(0, 12)} x${g.size}: ${g.occurrences.map((o) => `${o.file} [${o.moduleName}#${o.questionNumber}]`).join(" | ")}`);
  }
  if (dupGroups.length > 50) console.log(`  ... +${dupGroups.length - 50} more (see report)`);

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ files: fileRows, duplicateGroups: dupGroups, stemBuckets: stemItems.length }, null, 2));
  console.log(`\nReport: ${reportPath}`);
  process.exit(fileRows.every((r) => r.status === "PASS") ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
