/**
 * Document OCR via Cohere Parse 5 (the only OCR provider).
 *
 *   POST https://api.cohere.com/v2/parse
 *   model "parse-v5.0", document.type "image_url" (base64 data URI),
 *   output_format "blocks" (ordered text/table/image blocks + bboxes).
 *
 * Accuracy-first sizing: render large, then fit within Parse limits
 * (20 MB file, 50 MP / 200 MB decoded) while keeping text readable.
 */

export const PARSE_URL = "https://api.cohere.com/v2/parse";
export const DEFAULT_PARSE_MODEL = "parse-v5.0";

/** Render scale for OCR source pages (accuracy-first; fit step caps size). */
export const PARSE_RENDER_SCALE = 3;
/** Downscale cap: keep width at or under this (px). */
export const PARSE_MAX_WIDTH = 2550;
/** Downscale cap: keep decoded pixels at or under this. */
export const PARSE_MAX_PIXELS = 30_000_000;
/** Upload caps (Parse allows 20 MB; stay under with margin). */
export const PARSE_PNG_BYTE_CAP = 15_000_000;
export const PARSE_JPEG_BYTE_CAP = 18_000_000;
/**
 * Strip tiling for giant (stitched) pages: when the fitted image is taller
 * than this, split into overlapping horizontal strips so text stays readable
 * instead of downscaling the whole page into oblivion.
 */
export const PARSE_TILE_MAX_H = 3600;
/** Overlap between consecutive strips (px at fitted size). */
export const PARSE_TILE_OVERLAP = 180;

export type ParseImageMime = "image/png" | "image/jpeg";

export interface ParseBBox {
  topLeftX: number;
  topLeftY: number;
  bottomRightX: number;
  bottomRightY: number;
}

export interface ParseVisualBlock {
  kind: "image" | "table";
  description: string | null;
  category: string | null;
  bbox: ParseBBox | null;
  bboxNormalized: ParseBBox | null;
}

export interface ParsePageResult {
  /** Reconstructed page text (ordered blocks, tables flattened to text). */
  text: string;
  /** Visual/table blocks found on the page (graphs, figures, boxed content). */
  visuals: ParseVisualBlock[];
  tableCount: number;
  imageCount: number;
  textBlockCount: number;
  billedPages: number;
}

export interface ParseProvider {
  name: string;
  model: string;
  parseImage(image: Buffer, mime: ParseImageMime): Promise<ParsePageResult>;
}

interface RawBBox {
  top_left_x?: number;
  top_left_y?: number;
  bottom_right_x?: number;
  bottom_right_y?: number;
}

interface RawBlock {
  type?: string;
  text?: { content?: string };
  table?: {
    html?: string;
    description?: string | null;
    bounding_box?: RawBBox | null;
    bounding_box_normalized?: RawBBox | null;
  };
  image?: {
    id?: string;
    description?: string | null;
    category?: string | null;
    bounding_box?: RawBBox | null;
    bounding_box_normalized?: RawBBox | null;
  };
}

function toBBox(raw: RawBBox | null | undefined): ParseBBox | null {
  if (!raw) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    topLeftX: n(raw.top_left_x),
    topLeftY: n(raw.top_left_y),
    bottomRightX: n(raw.bottom_right_x),
    bottomRightY: n(raw.bottom_right_y),
  };
}

/** Flatten table HTML to plain text lines (keep cell numbers for the parser). */
export function tableHtmlToText(html: string): string {
  return html
    .replace(/<\/?(tr|br|li|p|div|h\d|thead|tbody|tfoot)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Reconstruct ordered page text from Parse blocks.
 * Text blocks pass through; table blocks are flattened to text (and also
 * recorded as visuals); image blocks become a [figure: ...] marker line and
 * are recorded as visuals with their bounding boxes.
 */
export function blocksToPageText(blocks: RawBlock[]): { text: string; visuals: ParseVisualBlock[] } {
  const lines: string[] = [];
  const visuals: ParseVisualBlock[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text?.content === "string" && b.text.content.trim()) {
      lines.push(b.text.content.trim());
    } else if (b.type === "table" && b.table) {
      const flat = b.table.html ? tableHtmlToText(b.table.html) : "";
      if (flat) lines.push(flat);
      else if (b.table.description) lines.push(`[table: ${b.table.description}]`);
      else lines.push("[table]");
      visuals.push({
        kind: "table",
        description: b.table.description ?? null,
        category: "table",
        bbox: toBBox(b.table.bounding_box),
        bboxNormalized: toBBox(b.table.bounding_box_normalized),
      });
    } else if (b.type === "image" && b.image) {
      const label = b.image.description ?? b.image.category ?? "image";
      lines.push(`[figure: ${label}]`);
      visuals.push({
        kind: "image",
        description: b.image.description ?? null,
        category: b.image.category ?? null,
        bbox: toBBox(b.image.bounding_box),
        bboxNormalized: toBBox(b.image.bounding_box_normalized),
      });
    }
  }
  return { text: lines.join("\n"), visuals };
}

/**
 * Fit a rendered page PNG within Parse limits, accuracy-first:
 * downscale only when over width/pixel caps, prefer PNG, fall back to
 * high-quality JPEG when PNG is too large.
 */
export async function fitImageForParse(png: Buffer): Promise<{
  image: Buffer;
  mime: ParseImageMime;
  width: number;
  height: number;
  pixels: number;
}> {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(png);
  const natW = img.width;
  const natH = img.height;
  let w = natW;
  let h = natH;
  const natPixels = natW * natH;
  if (w > PARSE_MAX_WIDTH || natPixels > PARSE_MAX_PIXELS) {
    const k = Math.min(PARSE_MAX_WIDTH / w, Math.sqrt(PARSE_MAX_PIXELS / natPixels));
    w = Math.max(1, Math.round(natW * k));
    h = Math.max(1, Math.round(natH * k));
  }
  const render = async (width: number, height: number): Promise<Buffer> => {
    if (width === natW && height === natH) return png;
    const canvas = createCanvas(width, height);
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    return Buffer.from(await canvas.encode("png"));
  };
  let image = await render(w, h);
  let mime: ParseImageMime = "image/png";
  if (image.length > PARSE_PNG_BYTE_CAP) {
    const canvas = createCanvas(w, h);
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    image = Buffer.from(await canvas.encode("jpeg", 90));
    mime = "image/jpeg";
  }
  if (image.length > PARSE_JPEG_BYTE_CAP) {
    const canvas = createCanvas(w, h);
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    image = Buffer.from(await canvas.encode("jpeg", 80));
    mime = "image/jpeg";
  }
  if (image.length > 19_500_000) {
    throw new Error(`fitted page image still ${(image.length / 1e6).toFixed(1)} MB, over Parse 20 MB limit`);
  }
  return { image, mime, width: w, height: h, pixels: w * h };
}

export interface FittedPageImage {
  image: Buffer;
  mime: ParseImageMime;
  width: number;
  height: number;
  pixels: number;
}

/**
 * Remove text duplicated by strip overlap. Two strategies:
 * 1. resume-point: the previous strip usually ends mid-question; its last
 *    ~15 words reappear inside the current strip's head (which restarts the
 *    overlapped region). Cut the current text before that resume point so the
 *    stitched text continues the question seamlessly.
 * 2. suffix-prefix: longest run (>= 6 words) where the previous strip's tail
 *    matches the current strip's head; cut it from the current text.
 * Both are word-normalized and OCR-noise tolerant. Keeps everything on miss.
 */
export function trimStripOverlap(prevText: string, curText: string): string {
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cutWords = (text: string, n: number): string => {
    let idx = 0;
    let dropped = 0;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null && dropped < n) {
      dropped++;
      idx = m.index + m[0].length;
    }
    return text.slice(idx).trimStart();
  };

  const prevWords = prevText.split(/\s+/).filter(Boolean);
  const curWords = curText.split(/\s+/).filter(Boolean);

  // 1. Resume-point search: prev tail (last 15 words) inside cur head (first 300).
  // The previous strip usually ends mid-question; the run marks where it cut
  // off, so everything before AND including the run duplicates prev and the
  // text must resume after it. Requires j >= 8 so repeated boilerplate stems
  // at the head ("Which choice completes the text ...") can't false-trigger.
  // A run at position 0 is a plain overlap for the suffix-prefix step below.
  const tail = prevWords.slice(-15).map(norm).filter(Boolean);
  if (tail.length >= 8) {
    const head = curWords.slice(0, 300).map(norm);
    outer: for (let j = 8; j + 8 <= head.length; j++) {
      for (let k = 0; k < 8; k++) {
        if (head[j + k] !== tail[tail.length - 8 + k]) continue outer;
      }
      return cutWords(curText, j + 8);
    }
  }

  // 2. Suffix-prefix fallback.
  const prevTail = prevWords.slice(-48);
  let best = 0;
  const maxK = Math.min(48, prevTail.length, curWords.length);
  for (let k = maxK; k >= 6; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      const a = norm(prevTail[prevTail.length - k + i]!);
      const b = norm(curWords[i]!);
      if (!a || a !== b) {
        ok = false;
        break;
      }
    }
    if (ok) {
      best = k;
      break;
    }
  }
  if (!best) return curText;
  return cutWords(curText, best);
}

/** Row-ink scan (strided, edges ignored) for blank-band split detection. */
async function blankBands(
  image: Buffer,
  width: number,
  height: number,
): Promise<Array<{ start: number; end: number }>> {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(image);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const x0 = Math.floor(width * 0.03);
  const x1 = Math.ceil(width * 0.97);
  const bands: Array<{ start: number; end: number }> = [];
  let bandStart = -1;
  for (let y = 0; y < height; y++) {
    let ink = 0;
    const rowOff = y * width * 4;
    for (let x = x0; x < x1; x += 2) {
      if (data[rowOff + x * 4]! < 140) {
        ink++;
        if (ink >= 4) break;
      }
    }
    if (ink < 4) {
      if (bandStart < 0) bandStart = y;
    } else if (bandStart >= 0) {
      if (y - bandStart >= 30) bands.push({ start: bandStart, end: y });
      bandStart = -1;
    }
  }
  if (bandStart >= 0 && height - bandStart >= 30) bands.push({ start: bandStart, end: height });
  return bands;
}

/**
 * Plan strip splits: prefer cutting in wide blank bands (margins between
 * questions — no overlap, no duplication, parser-safe) near each ideal split
 * point; fall back to an overlapping cut when no band fits.
 */
async function planStrips(
  fittedImage: Buffer,
  width: number,
  height: number,
): Promise<Array<{ top: number; bottom: number; overlapHead: boolean }>> {
  const strips: Array<{ top: number; bottom: number; overlapHead: boolean }> = [];
  if (height <= PARSE_TILE_MAX_H) return [{ top: 0, bottom: height, overlapHead: false }];
  let bands: Array<{ start: number; end: number }> = [];
  try {
    bands = await blankBands(fittedImage, width, height);
  } catch {
    bands = [];
  }
  let top = 0;
  let overlapHead = false;
  while (top < height) {
    let end = top + PARSE_TILE_MAX_H;
    if (end >= height || height - end < PARSE_TILE_OVERLAP * 2) {
      strips.push({ top, bottom: height, overlapHead });
      break;
    }
    let best: { start: number; end: number } | null = null;
    for (const b of bands) {
      const mid = Math.floor((b.start + b.end) / 2);
      if (mid <= top + 1200 || Math.abs(mid - end) > 800) continue;
      if (!best || b.end - b.start > best.end - best.start) best = b;
    }
    if (best) {
      const mid = Math.floor((best.start + best.end) / 2);
      strips.push({ top, bottom: mid, overlapHead });
      top = mid;
      overlapHead = false;
    } else {
      strips.push({ top, bottom: end + PARSE_TILE_OVERLAP, overlapHead });
      top = end;
      overlapHead = true;
    }
  }
  return strips;
}

function offsetVisuals(visuals: ParseVisualBlock[], stripTop: number, stripH: number, fullH: number): ParseVisualBlock[] {
  return visuals.map((v) => {
    const shift = (box: ParseBBox | null): ParseBBox | null => {
      if (!box) return null;
      // Normalized boxes (<= ~1) remap to full-page fractions; pixel boxes shift.
      if (box.bottomRightY <= 1.5 && box.topLeftY <= 1.5) {
        const y1 = (stripTop + box.topLeftY * stripH) / fullH;
        const y2 = (stripTop + box.bottomRightY * stripH) / fullH;
        return { ...box, topLeftY: y1, bottomRightY: y2 };
      }
      return { ...box, topLeftY: box.topLeftY + stripTop, bottomRightY: box.bottomRightY + stripTop };
    };
    return { ...v, bbox: shift(v.bbox), bboxNormalized: shift(v.bboxNormalized) };
  });
}

/**
 * Parse one fitted page, tiling giant pages into overlapping strips.
 * Short pages go through as a single Parse call; tall pages are split,
 * parsed per strip, and stitched (overlap trimmed, visual boxes remapped).
 */
export async function parsePageTiled(provider: ParseProvider, fitted: FittedPageImage): Promise<ParsePageResult> {
  if (fitted.height <= PARSE_TILE_MAX_H) {
    return provider.parseImage(fitted.image, fitted.mime);
  }
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(fitted.image);
  const strips = await planStrips(fitted.image, fitted.width, fitted.height);
  const out: ParsePageResult = { text: "", visuals: [], tableCount: 0, imageCount: 0, textBlockCount: 0, billedPages: 0 };
  let idx = 0;
  for (const s of strips) {
    const stripH = s.bottom - s.top;
    const canvas = createCanvas(fitted.width, stripH);
    canvas.getContext("2d").drawImage(img, 0, -s.top, fitted.width, fitted.height);
    let buf = Buffer.from(await canvas.encode("png"));
    let mime: ParseImageMime = "image/png";
    if (buf.length > PARSE_PNG_BYTE_CAP) {
      const jpeg = createCanvas(fitted.width, stripH);
      jpeg.getContext("2d").drawImage(img, 0, -s.top, fitted.width, fitted.height);
      buf = Buffer.from(await jpeg.encode("jpeg", 90));
      mime = "image/jpeg";
    }
    const r = await provider.parseImage(buf, mime);
    out.text = idx === 0 || !s.overlapHead ? (idx === 0 ? r.text : `${out.text}\n${r.text}`) : `${out.text}\n${trimStripOverlap(out.text, r.text)}`;
    out.visuals.push(...offsetVisuals(r.visuals, s.top, stripH, fitted.height));
    out.tableCount += r.tableCount;
    out.imageCount += r.imageCount;
    out.textBlockCount += r.textBlockCount;
    out.billedPages += r.billedPages;
    idx++;
  }
  return out;
}

/**
 * Failure is quota/rate-limit shaped (rotate to the next key) rather than a
 * hard request/auth failure (throw immediately).
 */
export function isQuotaFailure(status: number, detail: string): boolean {
  if (status === 429) return true;
  return /quota|rate.?limit|too many|exceed|insufficient|credit|billing|payment|plan|trial/i.test(detail);
}

export class CohereParseProvider implements ParseProvider {
  name = "cohere_parse";
  model: string;
  private apiKeys: string[];
  private timeoutMs: number;
  private keyPageCap: number;
  private exhausted = new Set<number>();
  private billedByKey: number[] = [];
  private keyCursor = 0;
  private retryDelayMs: number;

  constructor(apiKey: string | string[], model?: string, timeoutMs = 120_000, keyPageCap = 1000, retryDelayMs = 3000) {
    const keys = (Array.isArray(apiKey) ? apiKey : [apiKey]).map((k) => k.trim()).filter(Boolean);
    if (keys.length === 0) {
      throw new Error("Parse OCR requires COHERE_API_KEY but none was provided. Add it to backend/worker/.env");
    }
    this.apiKeys = keys;
    this.billedByKey = keys.map(() => 0);
    this.model = model || DEFAULT_PARSE_MODEL;
    this.timeoutMs = timeoutMs;
    this.keyPageCap = keyPageCap;
    this.retryDelayMs = retryDelayMs;
  }

  /** Number of keys currently retired (quota/timeout/cap hit). */
  exhaustedCount(): number {
    return this.exhausted.size;
  }

  /** Billed Parse pages attributed per key (index-aligned with constructor keys). */
  billedPagesByKey(): number[] {
    return [...this.billedByKey];
  }

  /** Index of the key that will be tried first on the next call. */
  activeKeyIndex(): number {
    if (!this.exhausted.has(this.keyCursor)) return this.keyCursor;
    for (let i = 0; i < this.apiKeys.length; i++) {
      if (!this.exhausted.has(i)) return i;
    }
    return this.keyCursor;
  }

  private retireKey(idx: number, reason: string): void {
    if (this.exhausted.has(idx)) return;
    this.exhausted.add(idx);
    console.warn(`[parse] key #${idx + 1} retired (${reason}); ${this.apiKeys.length - this.exhausted.size} key(s) left`);
  }

  private nextLiveKey(from: number): number {
    for (let step = 1; step <= this.apiKeys.length; step++) {
      const idx = (from + step) % this.apiKeys.length;
      if (!this.exhausted.has(idx) && this.billedByKey[idx]! < this.keyPageCap) return idx;
    }
    return -1;
  }

  async parseImage(image: Buffer, mime: ParseImageMime): Promise<ParsePageResult> {
    const dataUri = `data:${mime};base64,${image.toString("base64")}`;
    const body = JSON.stringify({
      model: this.model,
      document: { type: "image_url", image_url: dataUri },
      output_format: "blocks",
    });
    const attempt = async (keyIdx: number): Promise<ParsePageResult> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const resp = await fetch(PARSE_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKeys[keyIdx]}`, "Content-Type": "application/json" },
          body,
          signal: ctrl.signal,
        });
        if (!resp.ok) {
          let detail = resp.statusText;
          try {
            const err = (await resp.json()) as { message?: string };
            detail = err.message ?? JSON.stringify(err).slice(0, 500);
          } catch {
            // ignore body parse failure
          }
          if ((resp.status === 401 || resp.status === 403) && !isQuotaFailure(resp.status, detail)) {
            throw new Error(`Cohere Parse auth failure (HTTP ${resp.status}): ${detail} (check COHERE_API_KEY)`);
          }
          const quota = isQuotaFailure(resp.status, detail);
          throw new Error(`Cohere Parse HTTP ${resp.status}: ${detail}${quota ? " [quota]" : ""}`);
        }
        const parsed = (await resp.json()) as {
          pages?: Array<{ type?: string; blocks?: RawBlock[] }>;
          meta?: { billed_units?: { pages?: number } };
        };
        const page = parsed.pages?.[0];
        const blocks = Array.isArray(page?.blocks) ? (page!.blocks as RawBlock[]) : [];
        const { text, visuals } = blocksToPageText(blocks);
        return {
          text,
          visuals,
          tableCount: visuals.filter((v) => v.kind === "table").length,
          imageCount: visuals.filter((v) => v.kind === "image").length,
          textBlockCount: blocks.filter((b) => b.type === "text").length,
          billedPages: parsed.meta?.billed_units?.pages ?? 1,
        };
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          throw new Error(`Cohere Parse timeout after ${Math.round(this.timeoutMs / 1000)}s`);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    };
    // Try keys in order; transient errors get one same-key retry, quota/
    // timeout exhaustion rotates to the next live key for the same page.
    let keyIdx = this.activeKeyIndex();
    let lastErr: unknown = null;
    for (let tried = 0; tried < this.apiKeys.length; tried++) {
      if (this.exhausted.has(keyIdx) || this.billedByKey[keyIdx]! >= this.keyPageCap) {
        keyIdx = this.nextLiveKey(keyIdx);
        if (keyIdx < 0) break;
      }
      try {
        const out = await attempt(keyIdx);
        this.billedByKey[keyIdx]! += out.billedPages;
        if (this.billedByKey[keyIdx]! >= this.keyPageCap) {
          this.retireKey(keyIdx, `page cap reached (${this.billedByKey[keyIdx]} billed pages)`);
        } else {
          this.keyCursor = keyIdx;
        }
        return out;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastErr = e;
        // Hard failures: bad auth, malformed request — never rotate.
        if (/auth failure|HTTP 4(?!29)/.test(msg) && !msg.includes("[quota]")) throw e;
        const quotaLike = msg.includes("[quota]") || /HTTP 429/.test(msg);
        const timeoutLike = /timeout after/.test(msg);
        if (quotaLike || timeoutLike) {
          // One same-key retry first (transient blip vs truly exhausted key).
          try {
            await new Promise((r) => setTimeout(r, this.retryDelayMs));
            const out = await attempt(keyIdx);
            this.billedByKey[keyIdx]! += out.billedPages;
            this.keyCursor = keyIdx;
            return out;
          } catch (e2) {
            const msg2 = e2 instanceof Error ? e2.message : String(e2);
            lastErr = e2;
            if (/auth failure|HTTP 4(?!29)/.test(msg2) && !msg2.includes("[quota]")) throw e2;
            this.retireKey(keyIdx, quotaLike || /HTTP 429/.test(msg2) ? "quota/rate-limit" : "repeated timeout");
            console.warn(`[parse] key #${keyIdx + 1} failed (${msg2.slice(0, 120)}); rotating to next key`);
            keyIdx = this.nextLiveKey(keyIdx);
            if (keyIdx < 0) break;
            continue;
          }
        }
        // Other transient errors (socket, 5xx): same-key retry once, no rotation.
        console.warn(`[parse] first attempt failed (${msg.slice(0, 120)}); retrying once`);
        await new Promise((r) => setTimeout(r, this.retryDelayMs));
        return attempt(keyIdx);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Cohere Parse failed: all API keys exhausted");
  }
}

/** Factory for the Parse 5 OCR provider. Legacy "cohere" maps to Parse 5. */
export function createParseProvider(
  providerName: string,
  apiKey?: string | string[],
  model?: string,
  keyPageCap = 1000,
): ParseProvider {
  const keys = (Array.isArray(apiKey) ? apiKey : [apiKey]).map((k) => (k ?? "").trim()).filter(Boolean);
  if (keys.length === 0) {
    throw new Error("Parse OCR requires COHERE_API_KEY but none was provided. Add it to backend/worker/.env");
  }
  switch (providerName) {
    case "cohere_parse":
    case "cohere":
      return new CohereParseProvider(keys, model, undefined, keyPageCap);
    default:
      throw new Error(`Unknown OCR provider: ${providerName}. Supported: cohere_parse`);
  }
}
