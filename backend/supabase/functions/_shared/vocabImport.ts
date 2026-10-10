/** Used by both import endpoints and the browser preview. No runtime dependencies. */
export interface VocabImportRow {
  word: string;
  definition: string;
  example_sentence: string | null;
  part_of_speech: string | null;
  tags: string[];
}

export class VocabImportError extends Error {}

export function parseVocabImport(source: string): VocabImportRow[] {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (text.length > 200000) throw new VocabImportError("File exceeds the import limit. Split it into smaller files.");
  // Detect the separator only outside quotes, in the first nonempty record.
  let quoted = false;
  let delimiter = ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && c === "\t") { delimiter = "\t"; break; }
    else if (!quoted && c === ",") break;
    else if (!quoted && c === "\n" && text.slice(0, i).trim()) break;
  }

  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let closedQuote = false;
  const finishField = () => { fields.push(field.trim()); field = ""; closedQuote = false; };
  const finishRecord = () => {
    finishField();
    if (fields.some(Boolean)) records.push(fields);
    fields = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; closedQuote = true; }
      } else field += c;
    } else if (c === delimiter) finishField();
    else if (c === "\n") finishRecord();
    else if (c === '"' && !field.trim() && !closedQuote) { field = ""; inQuotes = true; }
    else {
      if (closedQuote && c.trim()) throw new VocabImportError(`Invalid CSV near row ${records.length + 1}. Use doubled quotes inside a quoted field.`);
      field += c;
    }
  }
  if (inQuotes) throw new VocabImportError("A quoted field is missing its closing quote. Check the CSV and choose it again.");
  finishRecord();

  const first = records[0];
  if (first && ["word", "term"].includes(first[0].toLowerCase()) &&
      ["definition", "def", "meaning"].includes(first[1]?.toLowerCase())) records.shift();
  return records.map((record, index) => {
    const [word, definition, example, pos, tagsRaw] = record;
    if (!word || !definition || record.length < 2 || record.length > 5) {
      throw new VocabImportError(`Row ${index + 1} needs word and definition columns (up to 5 columns). Put definitions containing commas or line breaks in double quotes.`);
    }
    const tags = tagsRaw ? tagsRaw.split(";").map((tag) => tag.trim()).filter(Boolean) : [];
    if (word.length > 120 || definition.length > 2000 || (example?.length ?? 0) > 1000 ||
        (pos?.length ?? 0) > 50 || tags.length > 20 || tags.some((tag) => tag.length > 50)) {
      throw new VocabImportError(`Row ${index + 1} exceeds the card limits: word 120 characters, definition 2,000, example 1,000, part of speech 50, and up to 20 tags of 50 characters.`);
    }
    return { word, definition, example_sentence: example || null, part_of_speech: pos || null, tags };
  });
}
