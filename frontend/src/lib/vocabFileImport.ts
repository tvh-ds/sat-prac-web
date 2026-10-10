import { parseVocabImport, type VocabImportRow } from "../../../backend/supabase/functions/_shared/vocabImport";

export interface VocabFileExtract {
  /** Original delimited text, ready for the cards/import endpoint. */
  text: string;
  rows: number;
  preview: VocabImportRow[];
  /** Reserved for extraction metadata; CSV files have no pages. */
  pages: number;
  note: string | null;
}

const MAX_CHARS = 200000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Read a CSV vocabulary file into importable text. */
export async function extractVocabFile(file: File): Promise<VocabFileExtract> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${Math.round(file.size / 1048576)} MB, max 15 MB).`);
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext !== "csv") throw new Error("Choose a CSV (.csv) file. In Excel, use File → Save As → CSV UTF-8.");
  const text = await file.text();
  if (!text.trim()) throw new Error("File is empty.");
  return prepareVocabImport(text);
}

export function prepareVocabImport(text: string, pages = 0, note: string | null = null): VocabFileExtract {
  if (text.length > MAX_CHARS) throw new Error("File exceeds the import limit. Split it into smaller files.");
  const rows = parseVocabImport(text);
  if (!rows.length) throw new Error("No vocabulary rows found. Use the example file to add word and definition columns.");
  return { text, rows: rows.length, preview: rows.slice(0, 5), pages, note };
}
