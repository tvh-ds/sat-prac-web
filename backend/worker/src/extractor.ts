import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PageText {
  pageNumber: number;
  text: string;
}

/** Extract selectable text from a PDF buffer, one entry per page. */
export async function extractText(pdfBuffer: Uint8Array): Promise<PageText[]> {
  const doc = await getDocument({ data: pdfBuffer }).promise;
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = "";
      }
      line += item.str.replace(/r\s+t/g, "rt").replace(/\u0000/g, "");
      if (typeof item.hasEOL === "boolean" && item.hasEOL) {
        lines.push(line);
        line = "";
      }
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push({ pageNumber: i, text: lines.join("\n") });
  }
  return pages;
}

/** Check whether extracted text looks like real document text (vs garbage / empty). */
export function analyzeTextQuality(pageTexts: PageText[]): {
  overall: "good" | "poor";
  pagesNeedingOcr: number[];
  metrics: {
    totalWords: number;
    totalChars: number;
    questionMarkers: number;
    choiceMarkers: number;
    avgLineLength: number;
  };
} {
  let totalWords = 0;
  let totalChars = 0;
  let questionMarkers = 0;
  let choiceMarkers = 0;
  let lineCount = 0;

  const questionRe = /^\s*\d{1,3}\s*[.)]\s+\S/gm;
  const choiceRe = /^\s*[A-H]\s*[.)]\s+\S/gm;

  const pagesNeedingOcr: number[] = [];
  for (const page of pageTexts) {
    const words = page.text.trim().split(/\s+/).filter(Boolean);
    const pageWords = words.length;
    totalWords += pageWords;
    totalChars += page.text.length;
    lineCount += page.text.split("\n").filter((l) => l.trim().length > 0).length;
    questionMarkers += (page.text.match(questionRe) ?? []).length;
    choiceMarkers += (page.text.match(choiceRe) ?? []).length;
    if (pageWords < 15) pagesNeedingOcr.push(page.pageNumber);
  }

  const avgLineLength = lineCount > 0 ? Math.round(totalChars / lineCount) : 0;
  const hasSubstance = totalWords > 50 && avgLineLength > 15;
  const hasStructure = questionMarkers >= 1 || choiceMarkers >= 2;
  const overall = hasSubstance && hasStructure ? "good" : "poor";

  return {
    overall,
    pagesNeedingOcr,
    metrics: { totalWords, totalChars, questionMarkers, choiceMarkers, avgLineLength },
  };
}