/** Render one PDF page to PNG for visual inspection. Run: npx tsx tmp/render-one.ts <pdf> <page> <scale> <outPng> */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { renderPagePng } from "../src/renderPage";

const [pdfPath, pageStr, scaleStr, outPath] = process.argv.slice(2);
const png = await renderPagePng(new Uint8Array(readFileSync(pdfPath!)), Number(pageStr), Number(scaleStr ?? 1));
writeFileSync(outPath!, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
