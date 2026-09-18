import PDFDocument from "pdfkit";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const lines = [
  "Reading and Writing",
  "Passage: The canal system transformed inland trade, cutting journey times from weeks to days and slashing the cost of moving goods. Merchants who once dreaded the rutted wagon roads now shipped cargo in bulk, and port cities grew rich on the new traffic. Historians still debate whether the boom belonged to the engineers who built the canal or to the merchants who rushed to use it.",
  "1. Which choice best states the main idea of the passage?",
  "A. Canals were more expensive to build than the roads they replaced.",
  "B. The canal system dramatically changed inland commerce for the better.",
  "C. Merchants opposed the construction of the new canal system.",
  "D. Port cities declined after the canal system opened at last.",
  "2. As used in the passage, transformed most nearly means",
  "A. altered",
  "B. removed",
  "C. frozen",
  "D. hidden",
  "3. The architect designed the building ______ the surrounding landscape, blending modern materials with traditional forms.",
  "A. to complement",
  "B. for complement",
  "C. at complement",
  "D. of complement",
  "Math",
  "1. If 3x + 7 = 22, what is the value of x?",
  "A. 4",
  "B. 5",
  "C. 6",
  "D. 7",
  "2. A rectangle has length 12 and width 5. What is the area?",
  "A. 30",
  "B. 48",
  "C. 60",
  "D. 72",
  "3. If 2(x + 3) = x + 10, what is the value of x?",
  "4. What is the slope of the line y = 2x - 3?",
  "Answer Key",
  "1. B",
  "2. A",
  "3. B",
  "4. 4",
];

const doc = new PDFDocument({ margin: 50 });
const chunks: Buffer[] = [];
doc.on("data", (c: Buffer) => chunks.push(c));
doc.on("end", () => {
  const out = resolve(process.cwd(), "sample-pdf.pdf");
  writeFileSync(out, Buffer.concat(chunks));
  console.log(`wrote ${out}`);
});
for (const line of lines) doc.text(line);
doc.end();