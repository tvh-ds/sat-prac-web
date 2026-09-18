import fs from "node:fs";
import { renderPagePng } from "../src/renderPage";

const PDF = "D:/SAT website/Tests Unparsed/Digital SAT Tests/2024 08/202408usv2.pdf";
const buf = fs.readFileSync(PDF);

// Test single page at scale 1 first
(async () => {
  console.log("rendering page 16 at scale 1...");
  try {
    const png = await renderPagePng(new Uint8Array(buf), 16, 1);
    console.log("page 16 OK, size:", png.length);
  } catch (e) {
    console.error("page 16 FAIL:", e);
  }

  console.log("rendering page 16 at scale 2...");
  try {
    const png = await renderPagePng(new Uint8Array(buf), 16, 2);
    console.log("page 16@2x OK, size:", png.length);
  } catch (e) {
    console.error("page 16@2x FAIL:", e);
  }
})();
