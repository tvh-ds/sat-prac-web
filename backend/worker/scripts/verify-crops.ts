#!/usr/bin/env tsx
/**
 * Crop QA: offline contact-sheet review for figure auto-crop.
 *
 * Re-OCRs the visual pages of one import (fresh Parse boxes — stored
 * metadata keeps counts only), cuts crops via src/cropStimulus, and writes
 * side-by-side sheets (page + box overlay | final crop) plus report.json.
 *
 * READ-ONLY against the database (SELECTs + one storage download). The only
 * billable side effect is Cohere Parse pages for the re-OCRed visual pages.
 * Writes go to a local folder only — never to Supabase.
 *
 * Usage:
 *   npx tsx scripts/verify-crops.ts [--import <uuid>] [--max-pages <n>] [--source parse|local] [--out tmp/crop-qa]
 */
import "dotenv/config";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";

/** Find a PDF by filename under the local corpus (avoids storage download). */
function findLocalPdf(root: string, name: string): string | null {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) out.push(p);
    }
  };
  walk(root);
  return out[0] ?? null;
}
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import { renderPagePng } from "../src/renderPage";
import {
  fitImageForParse,
  parsePageTiled,
  createParseProvider,
  PARSE_RENDER_SCALE,
  type ParseVisualBlock,
} from "../src/ocr";
import {
  visualsToNormBoxes,
  normalizedToPixels,
  padRect,
  unionRects,
  rectAreaFrac,
  decideCrop,
  cropPng,
  inkRatio,
  detectFigureBoxes,
  CROP_MIN_INK,
  CROP_PAD_FRAC,
  type NormBox,
} from "../src/cropStimulus";

const DEFAULT_IMPORT = "30e58fb4-be59-4f1b-aea2-5d480467debe"; // 202510asiav1-new.pdf (autopicked: 29 figs / 16 pages)

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

interface PageReport {
  page: number;
  storedFigures: number;
  parseKinds: string[];
  boxes: number;
  decision: string;
  cropWxH: string | null;
  cropPageFrac: number | null;
  ink: number | null;
  inkOk: boolean | null;
  sheet: string | null;
}

async function main() {
  const importId = arg("--import") ?? DEFAULT_IMPORT;
  const maxPages = Number(arg("--max-pages") ?? 0);
  const source = arg("--source") ?? "parse"; // parse = fresh Parse boxes (billed) | local = ink-blob detector (free)
  if (source !== "parse" && source !== "local") throw new Error("--source must be parse|local");
  const outRoot = arg("--out") ?? "tmp/crop-qa";
  const outDir = join(outRoot, importId.slice(0, 8));
  mkdirSync(outDir, { recursive: true });

  const cfg = loadConfig();
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });

  const imp = await sb.from("pdf_imports").select("id,original_filename,storage_path").eq("id", importId).single();
  if (imp.error || !imp.data) throw new Error(`import lookup: ${imp.error?.message ?? "not found"}`);
  console.log(`import: ${imp.data.original_filename} (${importId.slice(0, 8)})`);

  // Visual pages, richest first (stored counts only — boxes are re-OCRed below).
  const per = 1000;
  let from = 0;
  const pageFigs = new Map<number, number>();
  for (;;) {
    const d = await sb
      .from("draft_questions")
      .select("page_number,parser_metadata")
      .eq("pdf_import_id", importId)
      .eq("has_visual_stimulus", true)
      .range(from, from + per - 1);
    if (d.error) throw d.error;
    if (!d.data || d.data.length === 0) break;
    for (const r of d.data as Array<{ page_number: number; parser_metadata: { visual?: { imageCount?: number; tableCount?: number } } | null }>) {
      const v = r.parser_metadata?.visual;
      const figs = (v?.imageCount ?? 0) + (v?.tableCount ?? 0);
      pageFigs.set(r.page_number, Math.max(pageFigs.get(r.page_number) ?? 0, figs));
    }
    if (d.data.length < per) break;
    from += per;
  }
  let pages = [...pageFigs.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  if (maxPages > 0) pages = pages.slice(0, maxPages);
  console.log(`visual pages: ${pages.length} (stored figure counts: ${pages.map((p) => `${p}:${pageFigs.get(p)}`).join(" ")})`);

  const localPdf = findLocalPdf("D:/SAT website/Tests Unparsed", imp.data.original_filename as string);
  let pdf: Uint8Array;
  if (localPdf) {
    pdf = new Uint8Array(readFileSync(localPdf));
    console.log(`pdf source: local disk (${localPdf})`);
  } else {
    const dl = await sb.storage.from("pdf-imports").download(imp.data.storage_path as string);
    if (dl.error || !dl.data) throw new Error(`pdf download: ${dl.error?.message ?? "no data"}`);
    pdf = new Uint8Array(await dl.data.arrayBuffer());
    console.log(`pdf source: storage (${imp.data.storage_path})`);
  }
  console.log(`pdf bytes: ${(pdf.length / 1e6).toFixed(1)} MB`);

  const provider = source === "parse" ? createParseProvider(cfg.ocrProvider, cfg.cohereApiKeys, cfg.ocrModel, cfg.cohereKeyPageCap) : null;
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const reports: PageReport[] = [];

  for (const pn of pages) {
    const png = await renderPagePng(pdf, pn, PARSE_RENDER_SCALE);
    let fitted: { image: Buffer; width: number; height: number };
    let boxes: NormBox[];
    let kinds: string[];
    if (source === "local") {
      const img = await loadImage(png);
      fitted = { image: png, width: img.width, height: img.height };
      boxes = await detectFigureBoxes(png);
      kinds = boxes.map(() => "local-figure");
    } else {
      const fit = await fitImageForParse(png);
      fitted = fit;
      const parsed = await parsePageTiled(provider!, fitted);
      boxes = visualsToNormBoxes(parsed.visuals as ParseVisualBlock[]);
      kinds = parsed.visuals.map((v: ParseVisualBlock) => v.kind);
    }
    const decision = decideCrop(boxes, fitted.width, fitted.height);

    const rep: PageReport = {
      page: pn,
      storedFigures: pageFigs.get(pn) ?? 0,
      parseKinds: kinds,
      boxes: boxes.length,
      decision: decision.kind === "crop" ? "crop" : `fallback:${decision.reason}`,
      cropWxH: null,
      cropPageFrac: null,
      ink: null,
      inkOk: null,
      sheet: null,
    };

    // Contact sheet: left = page (scaled) with boxes red + union green; right = crop.
    const sheetH = 1100;
    const k = sheetH / fitted.height;
    const leftW = Math.round(fitted.width * k);
    const pageImg = await loadImage(fitted.image);
    let cropImg: Awaited<ReturnType<typeof loadImage>> | null = null;
    let cropW = 0;
    let cropH = 0;
    if (decision.kind === "crop") {
      const buf = await cropPng(fitted.image, decision.rect);
      rep.cropWxH = `${decision.rect.w}x${decision.rect.h}`;
      rep.cropPageFrac = rectAreaFrac(decision.rect, fitted.width, fitted.height);
      const ink = await inkRatio(buf);
      rep.ink = ink;
      rep.inkOk = ink >= CROP_MIN_INK;
      cropImg = await loadImage(buf);
      const ck = Math.min(1, sheetH / cropImg.height, 900 / cropImg.width);
      cropW = Math.round(cropImg.width * ck);
      cropH = Math.round(cropImg.height * ck);
    }
    const sheet = createCanvas(leftW + 24 + Math.max(cropW, 300), sheetH + 40);
    const ctx = sheet.getContext("2d");
    ctx.fillStyle = "#111318";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.drawImage(pageImg, 0, 40, leftW, sheetH);
    ctx.lineWidth = 3;
    for (const b of boxes) {
      const r = normalizedToPixels(b, fitted.width, fitted.height);
      ctx.strokeStyle = "#ff5252";
      ctx.strokeRect(r.x * k, 40 + r.y * k, r.w * k, r.h * k);
    }
    if (decision.kind === "crop") {
      const padded = unionRects(boxes.map((b) => padRect(normalizedToPixels(b, fitted.width, fitted.height), CROP_PAD_FRAC, fitted.width, fitted.height)));
      if (padded) {
        ctx.strokeStyle = "#69f07a";
        ctx.lineWidth = 4;
        ctx.strokeRect(padded.x * k, 40 + padded.y * k, padded.w * k, padded.h * k);
      }
      if (cropImg) ctx.drawImage(cropImg, leftW + 24, 40, cropW, cropH);
    }
    ctx.fillStyle = "#e8eaf0";
    ctx.font = "22px sans-serif";
    const inkTxt = rep.ink === null ? "" : ` ink=${rep.ink.toFixed(4)}${rep.inkOk ? "" : " BLANK?"}`;
    ctx.fillText(`p${pn} boxes=${boxes.length} [${kinds.join(",")}] -> ${rep.decision}${inkTxt}`, 8, 28);
    const sheetPath = join(outDir, `page-${pn}.png`);
    writeFileSync(sheetPath, await sheet.encode("png"));
    rep.sheet = sheetPath;
    reports.push(rep);
    console.log(
      `p${pn}: storedFigs=${rep.storedFigures} parse=[${kinds.join(",")}] boxes=${boxes.length} -> ${rep.decision}` +
        (rep.cropWxH ? ` ${rep.cropWxH} (${((rep.cropPageFrac ?? 0) * 100).toFixed(1)}% page) ink=${(rep.ink ?? 0).toFixed(4)}` : ""),
    );
  }

  const billed = provider ? provider.billedPagesByKey().reduce((a, b) => a + b, 0) : 0;
  const crops = reports.filter((r) => r.decision === "crop");
  const fallbacks = reports.filter((r) => r.decision !== "crop");
  const summary = {
    import: imp.data.original_filename,
    importId,
    source,
    pages: reports.length,
    crops: crops.length,
    fallbacks: fallbacks.map((r) => `p${r.page}:${r.decision}`),
    blankCrops: reports.filter((r) => r.inkOk === false).map((r) => r.page),
    billedParsePages: billed,
    reports,
  };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(summary, null, 1));
  console.log(`\nQA done: ${crops.length} crops, ${fallbacks.length} fallbacks, ${billed} Parse pages billed. Sheets + report.json in ${outDir}`);
}

main().catch((e) => {
  console.error("VERIFY-CROPS FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
