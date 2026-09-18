import fs from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { installPdfGlobals } from "../src/pdfPolyfills";

const PDF = process.argv[2]!;
const PAGE = Number(process.argv[3]!);
const SCALE = Number(process.argv[4] ?? 1);

(async () => {
  installPdfGlobals();
  const buf = fs.readFileSync(PDF);
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await doc.getPage(PAGE);
  const viewport = page.getViewport({ scale: SCALE });
  console.log("page size:", viewport.width, "x", viewport.height);
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  console.log("canvas created");
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  console.log("render done");
  const out = Buffer.from(await canvas.encode("png"));
  console.log("encode done, bytes:", out.length);
})().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});