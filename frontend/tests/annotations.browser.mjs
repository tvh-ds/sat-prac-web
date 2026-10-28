import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", e => { errors.push(e.message); console.error(e.message); });
const artifacts = new URL("../../tmp/annotation-review/", import.meta.url);
await mkdir(artifacts, { recursive: true });
await page.route("**/annotation-fixture", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
</script><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import Board from '/src/components/QuestionAnnotationBoard.tsx';
import '/src/styles/theme.css';
import '/src/styles/luxe.css';
import { validAnnotation } from '/src/lib/reviewAnnotations.ts';
const question = { question_id: 'fixture', question_number: 1, prompt: 'Choose the best answer to this question.', passage: { title: 'Practice passage', content: 'A short passage leaves plenty of room for handwritten notes on both sides.' }, choices: [{id:'a',label:'A',text:'First answer',is_correct:true},{id:'b',label:'B',text:'Second answer',is_correct:false}], correct_answer: 'A' };
window.validAnnotation = validAnnotation;
window.mountBoard = () => ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Board, {question, initial: JSON.parse(localStorage.getItem('board') || 'null') ?? undefined, onSave: async document => { if (!validAnnotation(document)) throw Error('Invalid document'); localStorage.setItem('board', JSON.stringify(document)); }, onClose: () => {} }));
window.mountBoard();
</script></body></html>` }));
try {
  await page.goto(`${process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173'}/annotation-fixture`);
  await page.getByRole("button", { name: "Pen", exact: true }).waitFor();
  assert.equal(await page.locator('.annotation-question').evaluate(el => getComputedStyle(el).paddingLeft), '180px');
  await page.getByRole("button", { name: "Highlight and comment", exact: true }).click();
  await page.getByRole("button", { name: "Ink #2684e8", exact: true }).click();
  await page.locator('.annotation-passage .math-text, .annotation-passage').first().evaluate(el => {
    const selection = getSelection(), range = document.createRange();
    range.selectNodeContents(el); selection.removeAllRanges(); selection.addRange(range);
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  });
  await page.getByRole('textbox', { name: 'Comment 1' }).fill('Blue linked comment');
  assert.equal(await page.locator('.annotation-ink rect').first().getAttribute('fill'), '#2684e8');
  await page.getByRole('button', { name: 'Hide comment 1', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const surface = page.locator('.annotation-ink');
  const box = await surface.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  // Real Chromium pen input, starting over an existing linked highlight.
  const highlight = await page.locator('.annotation-highlight-target').first().boundingBox();
  const x = highlight.x + highlight.width / 2, y = highlight.y + highlight.height / 2;
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', buttons:1, clickCount:1, pointerType:'pen' });
  for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:x+i*3, y:y+i*2, buttons:1, pointerType:'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:x+36, y:y+24, button:'left', buttons:0, clickCount:1, pointerType:'pen' });
  await page.getByRole('button', { name:'Save annotation', exact:true }).click();
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('board')));
  assert.equal(saved.strokes.length, 1);
  assert.ok(saved.strokes[0].points.length >= 12);
  assert.ok(Math.abs(saved.strokes[0].points[0][0] - (x-box.x)*960/box.width) < 1, 'Zoomed pen coordinates');
  assert.equal(saved.comments[0].color, '#2684e8');
  assert.equal(saved.spacious, true);
  await page.reload();
  await page.getByRole('button', { name:'Pen', exact:true }).waitFor();
  assert.equal(await page.locator('.annotation-ink rect').first().getAttribute('fill'), '#2684e8');
  await page.screenshot({ path:fileURLToPath(new URL('desktop.png', artifacts)) });
  // Legacy documents retain their text coordinates and yellow default.
  await page.evaluate(() => { const b=JSON.parse(localStorage.getItem('board')); delete b.spacious; delete b.comments[0].color; localStorage.setItem('board',JSON.stringify(b)); });
  await page.reload();
  await page.getByRole('button', { name:'Pen', exact:true }).waitFor();
  assert.equal(await page.locator('.annotation-question').evaluate(el => getComputedStyle(el).paddingLeft), '48px');
  assert.equal(await page.locator('.annotation-ink rect').first().getAttribute('fill'), '#ffe43b');
  assert.equal(await page.evaluate(() => { const b=JSON.parse(localStorage.getItem('board')); b.comments[0].color='url(https://example.invalid)'; return window.validAnnotation(b); }), false);
  await page.setViewportSize({ width:390, height:844 });
  await page.screenshot({ path:fileURLToPath(new URL('mobile.png', artifacts)) });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('PASS: margins, chosen highlight color, save/reload, legacy alignment, color validation, pen drawing over highlights, zoom coordinates, mobile layout');
} finally { await browser.close(); }
