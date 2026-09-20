import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface VocabFileExtract {
  /** Tab-separated `word\tdefinition` lines, ready for the cards/import endpoint. */
  text: string;
  rows: number;
  /** PDF page count processed (0 for text files). */
  pages: number;
  note: string | null;
}

const MAX_PDF_PAGES = 100;
const MAX_CHARS = 190000; // backend import limit is 200000
const MAX_FILE_BYTES = 15 * 1024 * 1024;
// Minimum horizontal gap (PDF units, 1/72in) treated as a column gutter.
const MIN_GUTTER = 12;
// Vertical tolerance for grouping text items into one row.
const Y_TOL = 3;

interface PdfItem {
  x: number;
  y: number;
  w: number;
  str: string;
}

/** Read a .pdf/.csv/.tsv/.txt vocabulary file into importable text. */
export async function extractVocabFile(file: File): Promise<VocabFileExtract> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${Math.round(file.size / 1048576)} MB, max 15 MB).`);
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return extractPdfWords(file);
  const text = await file.text();
  if (!text.trim()) throw new Error("File is empty.");
  return { text, rows: text.split(/\r?\n/).filter((l) => l.trim()).length, pages: 0, note: null };
}

/**
 * Two-column/table layout: each visual row holds a word in the left column
 * and its definition in the right column. Rows are rebuilt from text-item
 * coordinates and split at the widest inter-item gap when it looks like a
 * column gutter. Text-only PDFs; scanned/image-only PDFs are rejected.
 */
async function extractPdfWords(file: File): Promise<VocabFileExtract> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = pdf.numPages;
  const pages = Math.min(totalPages, MAX_PDF_PAGES);
  const lines: string[] = [];
  let textItems = 0;
  try {
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      try {
        const tc = await page.getTextContent();
        const items: PdfItem[] = [];
        for (const it of tc.items) {
          if (!("str" in it)) continue;
          const str = it.str as string;
          if (!str.trim()) continue;
          const t = it.transform as number[];
          items.push({ x: t[4] ?? 0, y: t[5] ?? 0, w: (it.width as number | undefined) ?? 0, str });
        }
        textItems += items.length;
        items.sort((a, b) => b.y - a.y || a.x - b.x);
        const rows: PdfItem[][] = [];
        for (const it of items) {
          const row = rows.find((r) => Math.abs((r[0]?.y ?? 0) - it.y) <= Y_TOL);
          if (row) row.push(it);
          else rows.push([it]);
        }
        for (const row of rows) {
          row.sort((a, b) => a.x - b.x);
          let gapIdx = -1;
          let gapBest = 0;
          for (let i = 1; i < row.length; i++) {
            const prev = row[i - 1]!;
            const gap = row[i]!.x - (prev.x + prev.w);
            if (gap > gapBest) {
              gapBest = gap;
              gapIdx = i;
            }
          }
          if (gapIdx > 0 && gapBest >= MIN_GUTTER) {
            const word = row.slice(0, gapIdx).map((r) => r.str).join(" ").trim();
            const def = row.slice(gapIdx).map((r) => r.str).join(" ").trim();
            if (word && def) lines.push(`${word}\t${def}`);
          }
        }
      } finally {
        await page.cleanup();
      }
    }
  } finally {
    await pdf.destroy();
  }
  if (textItems === 0) {
    throw new Error("No selectable text found — this looks like a scanned PDF. Only text-based PDFs are supported.");
  }
  if (lines.length === 0) {
    throw new Error("No two-column word/definition rows found. Paste the list manually instead.");
  }
  let text = lines.join("\n");
  let note = totalPages > pages ? `First ${pages} of ${totalPages} pages used.` : null;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    note = (note ? `${note} ` : "") + "Truncated to the import size limit.";
  }
  return { text, rows: lines.length, pages, note };
}
