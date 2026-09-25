#!/usr/bin/env tsx
/** Compare the frozen local source PDFs with the actual files attached to live imports. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const refinement = path.join(root, "backend/worker/tmp/refinement");
const manifest = JSON.parse(readFileSync(path.join(refinement, "cohort.json"), "utf8"));
const cfg = loadConfig();
const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const results = [];
for (const entry of [...manifest.cohort, ...manifest.controls]) {
  const localPath = path.join(root, entry.source.pdf);
  const local = readFileSync(localPath);
  if (sha256(local) !== entry.source.pdfSha256) throw new Error(`frozen local PDF changed: ${entry.row.original_filename}`);
  const { data, error } = await sb.storage.from("pdf-imports").download(entry.row.storage_path);
  if (error || !data) {
    results.push({ id: entry.row.id, filename: entry.row.original_filename, storagePath: entry.row.storage_path,
      localSha256: sha256(local), localBytes: local.byteLength, liveSha256: null, liveBytes: null,
      exactMatch: false, verificationError: error?.message ?? "empty response" });
    continue;
  }
  const live = new Uint8Array(await data.arrayBuffer());
  results.push({ id: entry.row.id, filename: entry.row.original_filename, storagePath: entry.row.storage_path,
    localSha256: sha256(local), liveSha256: sha256(live), localBytes: local.byteLength, liveBytes: live.byteLength,
    exactMatch: sha256(local) === sha256(live) });
}
const result = { generatedAt: new Date().toISOString(), checked: results.length,
  exactMatches: results.filter((item) => item.exactMatch).length,
  unavailable: results.filter((item) => "verificationError" in item),
  mismatches: results.filter((item) => !item.exactMatch && !("verificationError" in item)), results };
const out = path.join(refinement, "source-verification.json");
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ path: out, checked: result.checked, exactMatches: result.exactMatches,
  unavailable: result.unavailable.length, mismatches: result.mismatches }));
