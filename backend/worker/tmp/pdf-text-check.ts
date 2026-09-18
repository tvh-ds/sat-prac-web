/** Check a PDF's own text layer around given markers. Run: npx tsx tmp/pdf-text-check.ts <pdf> <page> <marker> */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [pdfPath, pageStr, marker] = process.argv.slice(2);
const pdf = await getDocument({ data: new Uint8Array(readFileSync(pdfPath!)), useSystemFonts: true }).promise;
const page = await pdf.getPage(Number(pageStr));
const tc = await page.getTextContent();
const s = tc.items.map((i: { str?: string }) => i.str || "").join(" ");
console.log(`page chars=${s.length}`);
const idxs: number[] = [];
let idx = -1;
while ((idx = s.indexOf(marker!, idx + 1)) !== -1) idxs.push(idx);
console.log(`marker occurrences: ${idxs.length}`);
for (const i of idxs.slice(0, 10)) console.log(`...${s.slice(Math.max(0, i - 80), i + 200)}...`);
const tail = s.slice(-500);
console.log(`TAIL: ${tail}`);
await pdf.destroy();
