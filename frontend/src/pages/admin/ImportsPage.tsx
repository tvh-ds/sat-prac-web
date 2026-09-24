import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { supabase, fnJson, getToken } from "../../lib/supabase";
import type { ImportReadinessMetric, PdfImport } from "../../lib/types";
import { Spinner, fmtDate } from "../../components/ui";
import { polishTestTitle } from "../../lib/testTitle";

function ReadinessBadge({ metric, noun }: { metric: ImportReadinessMetric | undefined; noun: string }) {
  if (!metric) return <span className="muted">—</span>;

  const label = metric.status === "complete"
    ? "Complete"
    : metric.status === "partial"
      ? "Partial"
      : metric.status === "failed"
        ? "Failed"
        : "Processing";
  const tone = metric.status === "complete"
    ? "green"
    : metric.status === "partial"
      ? "amber"
      : metric.status === "failed"
        ? "red"
        : "gray";
  const moduleDetails = metric.modules.map((module) => {
    const name = module.name
      .replace("Reading and Writing", "RW")
      .replace("Module ", "M");
    return `${name} ${module.actual}/${module.expected}${module.inferred ? " (inferred)" : ""}`;
  });
  const detail = [
    `${metric.actual}/${metric.expected} ${noun}`,
    ...moduleDetails,
    ...metric.details,
  ].join("\n");

  return (
    <span title={detail} aria-label={`${label}: ${detail}`} tabIndex={0}>
      <span className={`pill pill-${tone}`}>{label}</span>
      <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
        {metric.actual}/{metric.expected}
      </span>
    </span>
  );
}

export default function ImportsPage() {
  const [imports, setImports] = useState<PdfImport[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const token = await getToken();
    const d = await fnJson<{ imports: PdfImport[] }>("admin-pdf-imports", { token });
    setImports(d.imports);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const token = await getToken();
      const path = `uploads/${crypto.randomUUID()}.pdf`;
      const { error: upErr } = await supabase.storage.from("pdf-imports").upload(path, file, { upsert: true });
      if (upErr) throw new Error(upErr.message);
      // Upload-only workflow: the worker parses the whole PDF automatically
      // and decides OCR itself. No scope or OCR options are sent.
      await fnJson("admin-pdf-imports", {
        method: "POST",
        token,
        body: {
          storage_path: path,
          original_filename: file.name,
          file_size: file.size,
        },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <div className="section-label">Imports</div>
      <h1 className="page-title"><span className="hl-muted">PDF</span> <span className="hl-bright">imports</span></h1>
      <p className="page-sub">Upload a full SAT PDF — the system detects Reading &amp; Writing and Math modules automatically and parses the whole file. OCR is applied automatically only to modules that need it.</p>

      <div className="card card-pad" style={{ maxWidth: 560, marginBottom: 18 }}>
        <div className="toolbar">
          <label className="btn btn-primary" style={{ cursor: uploading ? "not-allowed" : "pointer" }}>
            {uploading ? "Uploading…" : "+ Upload PDF"}
            <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => void onFile(e)} disabled={uploading} />
          </label>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}
      {!imports && <Spinner />}

      {imports && (
        <div className="card card-pad">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Questions</th>
                <th>Drafts</th>
                <th>Answer key</th>
                <th>Pages</th>
                <th>Method</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {imports.map((im) => {
                const draftCount = Object.values(im.draft_counts ?? {}).reduce((a: number, n) => a + (n as number), 0);
                return (
                  <tr key={im.id} className="row-link">
                    <td>
                      <div style={{ fontWeight: 600 }}>{polishTestTitle(im.original_filename)}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{im.original_filename}</div>
                      {im.generated_test_id && (
                        <Link to={`/admin/tests/${im.generated_test_id}/build`} style={{ fontSize: 12 }}>Open full-length test</Link>
                      )}
                    </td>
                    <td><ReadinessBadge metric={im.import_readiness?.questions} noun="questions" /></td>
                    <td>{draftCount}</td>
                    <td><ReadinessBadge metric={im.import_readiness?.answer_key} noun="keys" /></td>
                    <td>{im.page_count ?? "—"}</td>
                    <td>{im.extraction_method ?? "—"}</td>
                    <td>{fmtDate(im.created_at)}</td>
                    <td>
                      <Link className="btn btn-secondary btn-sm" to={`/admin/imports/${im.id}`}>Review</Link>
                    </td>
                  </tr>
                );
              })}
              {imports.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 30 }}>
                    No imports yet — upload a practice PDF above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
