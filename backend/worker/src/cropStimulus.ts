/**
 * Figure auto-crop: cut question stimulus images from Parse figure/table
 * bounding boxes instead of shipping full-page renders.
 *
 * Pure functions (rect math + canvas cutting) so everything is unit-testable
 * without OCR, PDFs, or database access. All dimensions are integers.
 *
 * Coordinate contract: normalized boxes are 0..1 fractions of the FULL page.
 * Crops are always cut from a full-page render (never a tile strip), because
 * Parse boxes on tiled pages are remapped to full-page fractions upstream.
 */
import type { ParseVisualBlock } from "./ocr";

/** Normalized box: fractions of full-page width/height. */
export interface NormBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Pixel rect inside a source render of known size. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropOptions {
  /** Padding per side, as a fraction of page width/height. */
  padFrac?: number;
  /** Minimum crop area as a fraction of page area (below => fallback). */
  minAreaFrac?: number;
  /** Maximum crop area as a fraction of page area (above => full page wins). */
  maxPageFrac?: number;
  /** Boxes this close (fraction of min page side) merge into one cluster. */
  mergeGapFrac?: number;
}

export const CROP_PAD_FRAC = 0.035;
export const CROP_MIN_AREA_FRAC = 0.02;
export const CROP_MAX_PAGE_FRAC = 0.8;
export const CROP_MERGE_GAP_FRAC = 0.03;

export type CropDecision = { kind: "crop"; rect: CropRect } | { kind: "fallback"; reason: string };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function validNorm(b: NormBox): boolean {
  return b.x2 > b.x1 && b.y2 > b.y1 && b.x1 >= -0.05 && b.y1 >= -0.05 && b.x2 <= 1.05 && b.y2 <= 1.05;
}

/**
 * Collect usable normalized boxes from Parse visuals. Prefers
 * bboxNormalized (resolution-independent); falls back to pixel bboxes when
 * fitted dimensions are supplied. Drops degenerate/out-of-range boxes.
 */
export function visualsToNormBoxes(
  visuals: ParseVisualBlock[],
  fittedW?: number,
  fittedH?: number,
): NormBox[] {
  const out: NormBox[] = [];
  for (const v of visuals ?? []) {
    const n = v?.bboxNormalized;
    const nx1 = num(n?.topLeftX);
    const ny1 = num(n?.topLeftY);
    const nx2 = num(n?.bottomRightX);
    const ny2 = num(n?.bottomRightY);
    if (nx1 !== null && ny1 !== null && nx2 !== null && ny2 !== null) {
      const b = { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
      if (validNorm(b)) {
        out.push(b);
        continue;
      }
    }
    const p = v?.bbox;
    const px1 = num(p?.topLeftX);
    const py1 = num(p?.topLeftY);
    const px2 = num(p?.bottomRightX);
    const py2 = num(p?.bottomRightY);
    if (px1 !== null && py1 !== null && px2 !== null && py2 !== null && fittedW && fittedH && fittedW > 0 && fittedH > 0) {
      const b = { x1: px1 / fittedW, y1: py1 / fittedH, x2: px2 / fittedW, y2: py2 / fittedH };
      if (validNorm(b)) out.push(b);
    }
  }
  return out;
}

/** Map a normalized box to integer pixels on a W×H render. */
export function normalizedToPixels(b: NormBox, W: number, H: number): CropRect {
  const x = Math.round(Math.min(b.x1, b.x2) * W);
  const y = Math.round(Math.min(b.y1, b.y2) * H);
  const x2 = Math.round(Math.max(b.x1, b.x2) * W);
  const y2 = Math.round(Math.max(b.y1, b.y2) * H);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/** Expand a rect by padFrac of the page per side, clamped to page bounds. */
export function padRect(r: CropRect, padFrac: number, W: number, H: number): CropRect {
  const px = Math.round(padFrac * W);
  const py = Math.round(padFrac * H);
  const x = Math.max(0, r.x - px);
  const y = Math.max(0, r.y - py);
  const x2 = Math.min(W, r.x + r.w + px);
  const y2 = Math.min(H, r.y + r.h + py);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/** Smallest rect containing all input rects. */
export function unionRects(rs: CropRect[]): CropRect | null {
  if (rs.length === 0) return null;
  let x = Infinity;
  let y = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rs) {
    x = Math.min(x, r.x);
    y = Math.min(y, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

export function rectAreaFrac(r: CropRect, W: number, H: number): number {
  if (W <= 0 || H <= 0) return 0;
  return (r.w * r.h) / (W * H);
}

function gapBetween(a: CropRect, b: CropRect): number {
  const gx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const gy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(gx, gy);
}

/** Cluster rects: boxes within gapTol px merge; distant clusters stay separate. */
export function clusterRects(rs: CropRect[], gapTol: number): CropRect[][] {
  const clusters: CropRect[][] = rs.map((r) => [r]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const ci = clusters[i]!;
        const cj = clusters[j]!;
        for (const a of ci) {
          for (const b of cj) {
            if (gapBetween(a, b) <= gapTol) {
              clusters[i] = [...ci, ...cj];
              clusters.splice(j, 1);
              merged = true;
              break outer;
            }
          }
        }
      }
    }
  }
  return clusters;
}

/**
 * Decide the crop for one page: map boxes to pixels, pad, cluster, union.
 * Multiple distant clusters => fallback (one question, one crop; a union
 * spanning the gap would just be a worse full page).
 */
export function decideCrop(boxes: NormBox[], W: number, H: number, opts: CropOptions = {}): CropDecision {
  const padFrac = opts.padFrac ?? CROP_PAD_FRAC;
  const minAreaFrac = opts.minAreaFrac ?? CROP_MIN_AREA_FRAC;
  const maxPageFrac = opts.maxPageFrac ?? CROP_MAX_PAGE_FRAC;
  const mergeGapFrac = opts.mergeGapFrac ?? CROP_MERGE_GAP_FRAC;
  if (!boxes || boxes.length === 0) return { kind: "fallback", reason: "no-boxes" };
  if (W <= 0 || H <= 0) return { kind: "fallback", reason: "bad-render-size" };
  const padded = boxes.map((b) => padRect(normalizedToPixels(b, W, H), padFrac, W, H));
  if (padded.some((r) => r.w <= 0 || r.h <= 0)) return { kind: "fallback", reason: "degenerate-box" };
  const clusters = clusterRects(padded, mergeGapFrac * Math.min(W, H));
  if (clusters.length > 1) return { kind: "fallback", reason: "multi-cluster" };
  const rect = unionRects(clusters[0]!)!;
  const area = rectAreaFrac(rect, W, H);
  if (area < minAreaFrac) return { kind: "fallback", reason: "too-small" };
  if (area > maxPageFrac) return { kind: "fallback", reason: "full-page-better" };
  return { kind: "crop", rect };
}

/** Cut a rect out of a source PNG (1:1 pixels, no scaling). */
export async function cropPng(sourcePng: Buffer, rect: CropRect): Promise<Buffer> {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(sourcePng);
  const canvas = createCanvas(rect.w, rect.h);
  canvas.getContext("2d").drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return Buffer.from(await canvas.encode("png"));
}

/**
 * Dark-pixel fraction of an image (strided scan, same <140 ink threshold as
 * the OCR blank-band detector). Near-zero => blank/white crop => bad box.
 */
export async function inkRatio(png: Buffer): Promise<number> {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(png);
  const W = img.width;
  const H = img.height;
  if (W <= 0 || H <= 0) return 0;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  let ink = 0;
  let total = 0;
  for (let y = 0; y < H; y += 3) {
    const rowOff = y * W * 4;
    for (let x = 0; x < W; x += 3) {
      total++;
      if (data[rowOff + x * 4]! < 140) ink++;
    }
  }
  return total === 0 ? 0 : ink / total;
}

/** Minimum ink fraction for a crop to be trusted (below => bad box). */
export const CROP_MIN_INK = 0.002;

/**
 * True for Parse visual descriptions that are never question content:
 * answer-entry (grid-in) boxes and Bluebook UI screenshots. Mirrors the
 * scraper's marker-line filters (isAnswerBoxFigure/isUiScreenshotFigure),
 * applied to the OCR description text so noise boxes never consume
 * attribution or become crops.
 */
export function isNoiseVisual(description: string | null | undefined): boolean {
  const d = (description ?? "").toLowerCase();
  if (!d) return false;
  if (/\bbox\b/.test(d) && /(write|enter|blank|answer)/.test(d)) return true;
  if (/mark for review|bookmark|black square|separator.*(square|icon)|(square|icon).*separator/.test(d)) return true;
  return false;
}

export interface DetectOptions {
  /** Working width for the coarse ink grid (aspect preserved). */
  maxW?: number;
  /** Minimum component area as a fraction of page area. */
  minAreaFrac?: number;
  /** Minimum component side as a fraction of min page side. */
  minSideFrac?: number;
  /** Minimum ink fill inside the component bbox. */
  minFill?: number;
  /** Merge gap as a fraction of min page side. */
  mergeGapFrac?: number;
}

/**
 * Local figure detection: connected ink components on a coarse grid, with
 * text-line filters (thin and/or sparse components are dropped). Returns
 * normalized boxes sorted by area, largest first.
 *
 * No OCR, no network — a free offline fallback when Parse quota is
 * exhausted. Boxes are looser than Parse's typed figure boxes (they hug ink,
 * so captions/whitespace may join); padding + review still apply downstream.
 */
export async function detectFigureBoxes(png: Buffer, opts: DetectOptions = {}): Promise<NormBox[]> {
  const maxW = opts.maxW ?? 800;
  const minAreaFrac = opts.minAreaFrac ?? 0.01;
  const minSideFrac = opts.minSideFrac ?? 0.03;
  const minFill = opts.minFill ?? 0.02;
  const mergeGapFrac = opts.mergeGapFrac ?? CROP_MERGE_GAP_FRAC;
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(png);
  const natW = img.width;
  const natH = img.height;
  if (natW <= 0 || natH <= 0) return [];
  const k = Math.min(1, maxW / natW);
  const W = Math.max(1, Math.round(natW * k));
  const H = Math.max(1, Math.round(natH * k));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (data[i * 4]! < 140) ink[i] = 1;
  }
  // Connected components (4-neighbourhood) over ink cells only.
  const seen = new Uint8Array(W * H);
  interface Comp {
    x: number;
    y: number;
    x2: number;
    y2: number;
    n: number;
  }
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!ink[s] || seen[s]) continue;
    let x = W;
    let y = H;
    let x2 = -1;
    let y2 = -1;
    let n = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      const cx = c % W;
      const cy = Math.floor(c / W);
      if (cx < x) x = cx;
      if (cy < y) y = cy;
      if (cx > x2) x2 = cx;
      if (cy > y2) y2 = cy;
      n++;
      if (cx > 0) {
        const nb = c - 1;
        if (ink[nb] && !seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
      if (cx < W - 1) {
        const nb = c + 1;
        if (ink[nb] && !seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
      if (cy > 0) {
        const nb = c - W;
        if (ink[nb] && !seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
      if (cy < H - 1) {
        const nb = c + W;
        if (ink[nb] && !seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    comps.push({ x, y, x2, y2, n });
  }
  const minSide = minSideFrac * Math.min(W, H);
  const kept = comps.filter((c) => {
    const bw = c.x2 - c.x + 1;
    const bh = c.y2 - c.y + 1;
    if ((bw * bh) / (W * H) < minAreaFrac) return false;
    if (Math.min(bw, bh) < minSide) return false;
    if (c.n / (bw * bh) < minFill) return false;
    return true;
  });
  const rects = kept.map((c) => ({ x: c.x, y: c.y, w: c.x2 - c.x + 1, h: c.y2 - c.y + 1 }));
  const clusters = clusterRects(rects, mergeGapFrac * Math.min(W, H));
  const merged = clusters.map((cl) => unionRects(cl)!);
  merged.sort((a, b) => b.w * b.h - a.w * a.h);
  return merged.map((r) => ({ x1: r.x / W, y1: r.y / H, x2: (r.x + r.w) / W, y2: (r.y + r.h) / H }));
}
