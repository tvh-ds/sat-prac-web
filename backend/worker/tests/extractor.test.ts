import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import { extractText, analyzeTextQuality } from "../src/extractor";

function makePdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const line of lines) doc.text(line);
    doc.end();
  });
}

describe("extractText", () => {
  it("extracts selectable text from a generated PDF", async () => {
    const lines = [
      "Math",
      "1. If 3x + 7 = 22, what is the value of x?",
      "A. 4",
      "B. 5",
      "C. 6",
      "D. 7",
      "Answer Key",
      "1. B",
    ];
    const pdf = await makePdf(lines);
    const pages = await extractText(new Uint8Array(pdf));
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const text = pages.map((p) => p.text).join("\n");
    expect(text).toContain("Math");
    expect(text).toContain("1.");
    expect(text).toContain("B. 5");
    expect(text).toContain("Answer Key");
  });
});

describe("analyzeTextQuality", () => {
  it("flags well-structured text as good", () => {
    const pages = [
      { pageNumber: 1, text: "Reading and Writing\n\n1. Which choice best states the main idea of the passage?\nA. The canal was more expensive to build than the roads it replaced.\nB. The canal system dramatically changed inland commerce for good.\nC. Merchants opposed the construction of the new canal system.\nD. Port cities declined after the canal system opened at last.\n\n2. As used in the passage, which choice most nearly matches the meaning of transformed?\nA. altered\nB. removed\nC. frozen\nD. hidden\n\n3. The architect designed the building to complement the landscape.\nA. to complement\nB. for complement\nC. at complement\nD. of complement" },
    ];
    const q = analyzeTextQuality(pages);
    expect(q.overall).toBe("good");
    expect(q.metrics.questionMarkers).toBe(3);
    expect(q.metrics.choiceMarkers).toBeGreaterThanOrEqual(4);
  });

  it("flags empty/garbage pages as poor", () => {
    const pages = [
      { pageNumber: 1, text: "" },
      { pageNumber: 2, text: "xcvbnm qwertyuiop asdfghjkl zxcvbnm lkjhgfdsa" },
    ];
    const q = analyzeTextQuality(pages);
    expect(q.overall).toBe("poor");
    expect(q.pagesNeedingOcr).toContain(1);
  });

  it("lists sparse pages as low-word pages", () => {
    const pages = [
      { pageNumber: 1, text: "1. Question one?\nA. a\nB. b\nC. c\nD. d\n\n2. Question two?\nA. a\nB. b\nC. c\nD. d" },
      { pageNumber: 2, text: "tiny" },
    ];
    const q = analyzeTextQuality(pages);
    expect(q.pagesNeedingOcr).toEqual([2]);
  });
});