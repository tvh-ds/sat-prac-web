import { useState } from "react";
import { createPortal } from "react-dom";
import { extractVocabFile, type VocabFileExtract } from "../lib/vocabFileImport";
import { fnJson, getToken } from "../lib/supabase";
import { Button, Modal } from "./ui";
import "../styles/vocab-import.css";

export default function VocabImportModal({ endpoint, deckId, onClose, onImported }: {
  endpoint: string;
  deckId?: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<VocabFileExtract | null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState<"reading" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const chooseFile = async (selected: File | undefined) => {
    if (!selected || busy) return;
    setFile(null);
    setFilename(selected.name);
    setError(null);
    setResult(null);
    setBusy("reading");
    try { setFile(await extractVocabFile(selected)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not read file. Choose it again."); }
    finally { setBusy(null); }
  };

  const importCards = async () => {
    if (!file || busy) return;
    setBusy("importing");
    setError(null);
    setResult(null);
    try {
      const token = await getToken();
      const response = await fnJson<{ imported: number; skipped: number }>(endpoint, {
        method: "POST", token,
        body: { text: file.text, ...(deckId ? { deck_id: deckId } : {}) },
      });
      setResult(`${response.imported} imported${response.skipped ? `, ${response.skipped} duplicates skipped` : ""}.`);
      setFile(null);
      setFilename("");
      onImported();
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed. Try again."); }
    finally { setBusy(null); }
  };

  // Keep the dialog outside the student page's animated stacking context.
  return createPortal(
    <Modal title="Import Cards" onClose={() => { if (!busy) onClose(); }} footer={
      <>
        <Button variant="ghost" onClick={onClose} disabled={!!busy}>Close</Button>
        <Button onClick={() => void importCards()} disabled={!file || !!busy}>
          {busy === "importing" ? "Importing…" : file ? `Import ${file.rows} cards` : "Import"}
        </Button>
      </>
    }>
      <div className="vocab-import">
        <p className="muted">Press “Choose file” → Load file → Review 5 → Press “Import”. Duplicates are skipped.</p>
        <div className="vocab-import-format">
          <p className="muted"><strong>Supported files:</strong> CSV (.csv)</p>
          <button type="button" className="vocab-import-guide-toggle" aria-expanded={guideOpen} aria-controls="vocab-import-guide" onClick={() => setGuideOpen(!guideOpen)}>How to prepare your file</button>
          <a href="/examples/vocabulary-import.csv" download>Download Template</a>
        {guideOpen && <div id="vocab-import-guide" className="vocab-import-guide">
          <p><strong>Start in Excel</strong></p>
          <ol>
            <li>Put words in column A and meanings in column B, one word per row.</li>
            <li>Choose <strong>File → Save As</strong>, then select <strong>CSV UTF-8</strong> as the file type. Excel files (.xlsx) need to be saved as CSV first.</li>
            <li>Click <strong>Choose file</strong> below, select your saved CSV, and check the preview.</li>
          </ol>
          <p>Or click Download Template above, replace the sample words with your own, and save as CSV.</p>
        </div>}
        </div>
        <input id="vocab-import-file" type="file" accept=".csv" aria-label="Choose file" disabled={!!busy}
          onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ""; }} />
        <div aria-live="polite">
          {busy === "reading" && <p className="muted">Reading {filename}…</p>}
          {file && <>
            <p className="ok-text">{filename}: {file.rows} cards loaded{file.pages ? ` from ${file.pages} pages` : ""}. {file.note}</p>
            <div className="vocab-import-preview">
              <table>
                <caption>Preview · first {file.preview.length} of {file.rows} rows</caption>
                <thead><tr><th scope="col">Word</th><th scope="col">Definition</th></tr></thead>
                <tbody>{file.preview.map((row, index) => <tr key={index}>
                  <td>{row.word}</td><td>{row.definition}
                    {row.example_sentence && <p className="muted">Example: {row.example_sentence}</p>}
                    {row.part_of_speech && <p className="muted">Part of speech: {row.part_of_speech}</p>}
                    {row.tags.length > 0 && <p className="muted">Tags: {row.tags.join("; ")}</p>}
                  </td>
                </tr>)}</tbody>
              </table>
            </div>
          </>}
          {result && <p className="ok-text">{result}</p>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Modal>, document.body
  );
}
