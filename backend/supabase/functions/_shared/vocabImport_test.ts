import { parseVocabImport, VocabImportError } from "./vocabImport.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function rejects(text: string) {
  try { parseVocabImport(text); }
  catch (e) { if (e instanceof VocabImportError) return; throw e; }
  throw new Error("Expected invalid import to be rejected");
}

Deno.test("headerless CSV preserves commas and multiple meanings", () => {
  const rows = parseVocabImport('abolish,"End a law, system, or practice."\r\nabridge,"1. Shorten a book\r\n2. Limit a right."');
  equal(rows.length, 2);
  equal(rows[0].definition, "End a law, system, or practice.");
  equal(rows[1].definition, "1. Shorten a book\n2. Limit a right.");
  equal(rows[1].word, "abridge");
});

Deno.test("BOM, blank rows, optional header and escaped quotes", () => {
  const rows = parseVocabImport('\uFEFF\r\nword,definition\n\nacclaim,"Praise as ""excellent""."\n');
  equal(rows.length, 1);
  equal(rows[0].definition, 'Praise as "excellent".');
  equal(parseVocabImport('word,"A single unit of language."')[0].word, "word");
});

Deno.test("TSV preserves optional fields and quoted multiline definitions", () => {
  const rows = parseVocabImport('term\tmeaning\texample\tpos\ttags\npragmatic\t"Practical, sensible\nUseful"\tA pragmatic choice.\tadjective\tsat;academic');
  equal(rows[0], { word: "pragmatic", definition: "Practical, sensible\nUseful", example_sentence: "A pragmatic choice.", part_of_speech: "adjective", tags: ["sat", "academic"] });
});

Deno.test("tab inside CSV quotes is content, not a delimiter", () => {
  equal(parseVocabImport('word,definition\nterm,"left\tright"')[0].definition, "left\tright");
});

Deno.test("malformed CSV never silently truncates or imports partial rows", () => {
  rejects('valid,definition\nbroken,"missing quote');
  rejects('word,"definition"extra');
  rejects('word,');
  rejects('word');
  rejects('entry,definition,example,pos,tags,extra');
});

Deno.test("import and card size limits are enforced", () => {
  rejects('x'.repeat(200001));
  rejects(`${'x'.repeat(121)},definition`);
  rejects(`word,${'x'.repeat(2001)}`);
  rejects(`entry,definition,,,${Array(21).fill('tag').join(';')}`);
  equal(parseVocabImport(`word,${'x'.repeat(2000)}`).length, 1);
});

Deno.test("example file contains five complete vocabulary records", async () => {
  const example = await Deno.readTextFile(new URL("../../../../frontend/public/examples/vocabulary-import.csv", import.meta.url));
  const rows = parseVocabImport(example);
  equal(rows.length, 5);
  equal(rows[1].word, "abridge");
  equal(rows[1].definition.includes("\n2."), true);
});
