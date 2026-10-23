/**
 * Repair repeated-number storage collisions without overwriting a shared file.
 * First run without --apply; inspect the local plan before applying it.
 * Credentials are supplied through the environment, never written to the plan.
 * Usage: tsx scripts/repair-crop-collisions.ts --project-ref REF --audit FILE --out DIR [--apply]
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { cropPng, inkRatio, CROP_MIN_INK, type CropRect } from "../src/cropStimulus";
import { stimulusAssetKey } from "../src/stimulusAssetKey";

const arg = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Required argument: ${name}`);
  return value;
};
const ref = arg("--project-ref");
if (!["ygqndcgpbtmewzkruyuq", "wgkggknyndgaoyazdhdf"].includes(ref)) throw new Error("Explicit known project reference required");
const url = process.env.SUPABASE_URL!;
if (new URL(url).hostname !== `${ref}.supabase.co`) throw new Error("Project reference does not match credentials URL");
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const out = resolve(arg("--out"));
mkdirSync(out, { recursive: true });
const audit = JSON.parse(readFileSync(resolve(arg("--audit")), "utf8"));
if (audit.ref !== ref) throw new Error("Audit belongs to a different project");
type Row = Record<string, any>;
type Repair = { table: "draft_questions" | "questions"; id: string; oldPath: string; newPath: string; source: string; rect: CropRect; file: string; sha256: string; reason: string; importId: string };
const drafts: Row[] = audit.drafts, questions: Row[] = audit.questions;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const check = (r: { error: any }, label: string) => { if (r.error) throw new Error(`${label}: ${r.error.message}`); };
const planFile = join(out, "plan.json");
const pending = new Map<string, Promise<Buffer>>();
async function download(path: string): Promise<Buffer> {
  if (!/^imports\/[0-9a-f-]{36}\/.*\.png$/i.test(path)) throw new Error(`Unexpected source path: ${path}`);
  const file = join(out, `${hash(Buffer.from(path))}.png`);
  if (existsSync(file)) return readFileSync(file);
  if (pending.has(path)) return pending.get(path)!;
  const task = (async () => {
    const r = await sb.storage.from("question-assets").download(path);
    check(r, "download image");
    const bytes = Buffer.from(await r.data!.arrayBuffer());
    writeFileSync(file, bytes);
    return bytes;
  })();
  pending.set(path, task);
  try { return await task; } finally { pending.delete(path); }
}
async function all(table: string, columns: string) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await sb.from(table).select(columns).order("id").range(offset, offset + 999);
    check(r, `read ${table}`);
    rows.push(...r.data!);
    if (r.data!.length < 1000) return rows;
  }
}
if (process.argv.includes("--apply")) {
  const plan: { ref: string; repairs: Repair[]; blocked: unknown[] } = JSON.parse(readFileSync(planFile, "utf8"));
  if (plan.ref !== ref || plan.blocked.length) throw new Error("Plan has wrong target or unresolved repairs");
  // Check every row before any upload/mutation, so a stale audit cannot overwrite edits.
  for (const table of ["draft_questions", "questions"] as const) {
    const expected = plan.repairs.filter(p => p.table === table);
    for (let offset = 0; offset < expected.length; offset += 100) {
      const batch = expected.slice(offset, offset + 100);
      const r = await sb.from(table).select("id,stimulus_image_path").in("id", batch.map(p => p.id));
      check(r, "preflight rows");
      for (const p of batch) {
        const row = r.data!.find(row => row.id === p.id);
        if (!row || ![p.oldPath, p.newPath].includes(row.stimulus_image_path)) throw new Error(`Concurrent edit: ${p.id}`);
      }
    }
  }
  for (const p of plan.repairs) {
    if (hash(readFileSync(p.file)) !== p.sha256) throw new Error(`Changed repair image: ${p.id}`);
  }
  const results = [];
  for (const p of plan.repairs) {
    const bytes = readFileSync(p.file);
    const uploaded = await sb.storage.from("question-assets").upload(p.newPath, bytes, { contentType: "image/png", upsert: false });
    if (uploaded.error) {
      // A resumed run may already have uploaded this immutable repair. Compare bytes.
      const existing = await sb.storage.from("question-assets").download(p.newPath);
      check(existing, "check existing repair");
      if (hash(Buffer.from(await existing.data!.arrayBuffer())) !== p.sha256) throw new Error(`Conflicting repair file: ${p.newPath}`);
    }
    const stored = await sb.storage.from("question-assets").download(p.newPath);
    check(stored, "verify uploaded repair");
    if (hash(Buffer.from(await stored.data!.arrayBuffer())) !== p.sha256) throw new Error(`Uploaded image differs: ${p.id}`);
    const updated = await sb.from(p.table).update({ stimulus_image_path: p.newPath }).eq("id", p.id).eq("stimulus_image_path", p.oldPath).select("id,stimulus_image_path");
    check(updated, "link repaired crop");
    if (updated.data!.length !== 1) {
      const verified = await sb.from(p.table).select("stimulus_image_path").eq("id", p.id).single();
      check(verified, "verify resumed repaired link");
      if (verified.data!.stimulus_image_path !== p.newPath) throw new Error(`Concurrent edit while repairing ${p.id}`);
    }
    results.push({ table: p.table, id: p.id, path: p.newPath });
    writeFileSync(join(out, "applied.json"), JSON.stringify({ ref, results }, null, 2));
    if (results.length % 20 === 0) console.log(`Verified ${results.length}/${plan.repairs.length} repaired references`);
  }
  // Only remove superseded crops after checking ALL current active/source references.
  const refs = new Set<string>();
  for (const [table, fields] of [["draft_questions", ["stimulus_image_path", "stimulus_source_image_path", "review_source_image_path"]], ["questions", ["stimulus_image_path"]]] as const) {
    for (const row of await all(table, ["id", ...fields].join(","))) for (const field of fields) if (row[field]) refs.add(row[field]);
  }
  const unused = [...new Set(plan.repairs.map(p => p.oldPath))].filter(p => !refs.has(p));
  if (unused.some(p => !/-crop\.png$/.test(p))) throw new Error("Refusing to delete a source page");
  for (let i = 0; i < unused.length; i += 100) check(await sb.storage.from("question-assets").remove(unused.slice(i, i + 100)), "remove unreferenced collided crops");
  console.log(JSON.stringify({ ref, repaired: results.length, removedUnusedCrops: unused.length }));
} else {
  const groups = new Map<string, Row[]>();
  for (const d of drafts) {
    if (!/-crop\.png$/.test(d.stimulus_image_path)) continue;
    const group = groups.get(d.stimulus_image_path) ?? [];
    group.push(d); groups.set(d.stimulus_image_path, group);
  }
  const collisions = new Set<string>();
  for (const [path, rows] of groups) {
    if (new Set(rows.map(d => `${d.stimulus_source_image_path}:${JSON.stringify(d.stimulus_crop_rect)}`)).size > 1) collisions.add(path);
  }
  const qGroups = new Map<string, Row[]>();
  for (const q of questions) {
    if (!/-crop\.png$/.test(q.stimulus_image_path)) continue;
    const group = qGroups.get(q.stimulus_image_path) ?? [];
    group.push(q); qGroups.set(q.stimulus_image_path, group);
  }
  for (const [path, rows] of qGroups) if (new Set(rows.map(q => `${q.source_pdf_id}:${q.source_page}:${q.section}`)).size > 1) collisions.add(path);
  const repairs: Repair[] = [], blocked: Row[] = [], inspected: Row[] = [];
  const overrides: Record<string, CropRect> = existsSync(join(out, "rect-overrides.json")) ? JSON.parse(readFileSync(join(out, "rect-overrides.json"), "utf8")) : {};
  async function prepare(table: Repair["table"], row: Row, draft: Row, reason: string) {
    const source = draft.stimulus_source_image_path;
    const rect: CropRect = overrides[row.id] ?? draft.stimulus_crop_rect;
    if (!source || !rect) throw new Error("No preserved crop rectangle/source");
    const png = await download(source);
    const img = await loadImage(png);
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) || rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0 || rect.x + rect.w > img.width || rect.y + rect.h > img.height) throw new Error("Crop outside preserved page");
    const crop = await cropPng(png, rect);
    if (await inkRatio(crop) < CROP_MIN_INK) throw new Error("Reconstructed crop is blank");
    const importId = table === "questions" ? row.source_pdf_id : row.pdf_import_id;
    const key = stimulusAssetKey(row.section, draft.source_module_name, draft.source_question_number, row.id);
    const newPath = `imports/${importId}/stimuli/${key}-repaired-crop.png`;
    const file = join(out, `${row.id}-repaired.png`);
    writeFileSync(file, crop);
    repairs.push({ table, id: row.id, oldPath: row.stimulus_image_path, newPath, source, rect, file, sha256: hash(crop), reason, importId });
  }
  // Audit every saved crop, including single remaining references after a reprocess.
  const draftQueue = drafts.filter(d => /-crop\.png$/.test(d.stimulus_image_path));
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let d = draftQueue.shift(); d; d = draftQueue.shift()) {
      try {
        const rect = d.stimulus_crop_rect;
        let mismatch = false;
        if (rect) {
          const img = await loadImage(await download(d.stimulus_image_path));
          // The browser deliberately scales large manual crops to a 2000px edge.
          const scale = d.stimulus_crop_source === "manual" ? Math.min(1, 2000 / Math.max(rect.w, rect.h)) : 1;
          // Manual rectangles are rounded for storage after cropping fractional pixels.
          const tolerance = d.stimulus_crop_source === "manual" ? 1 : 0;
          mismatch = Math.abs(img.width - Math.round(rect.w * scale)) > tolerance || Math.abs(img.height - Math.round(rect.h * scale)) > tolerance;
        }
        const collided = collisions.has(d.stimulus_image_path);
        inspected.push({ id: d.id, collided, dimensionMismatch: mismatch });
        if (collided || mismatch) await prepare("draft_questions", d, d, collided ? "shared crop filename" : "crop dimensions disagree with saved rectangle");
      } catch (e) { blocked.push({ table: "draft_questions", id: d.id, error: String(e) }); }
      if (inspected.length % 50 === 0) console.log(`Audited ${inspected.length} saved draft crops`);
    }
  }));
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  for (const q of questions.filter(q => collisions.has(q.stimulus_image_path))) {
    try {
      const candidates = drafts.filter(d => d.pdf_import_id === q.source_pdf_id && d.page_number === q.source_page && d.section === q.section);
      let matches = candidates.filter(d => d.question_id === q.id);
      if (!matches.length) matches = candidates.filter(d => normalize(d.prompt) === normalize(q.prompt));
      if (!matches.length && candidates.length === 1) matches = candidates;
      if (matches.length !== 1) {
        const moduleLinks = audit.links.filter((l: Row) => l.question_id === q.id);
        const positions = candidates.filter(d => moduleLinks.some((l: Row) => d.source_module_name === audit.modules.find((m: Row) => m.id === l.module_id)?.name && d.source_question_number === l.position));
        if (positions.length === 1) matches = positions;
      }
      if (matches.length !== 1) throw new Error(`Ambiguous source draft: ${matches.length} matches`);
      await prepare("questions", q, matches[0]!, "generated question references shared crop filename");
    } catch (e) { blocked.push({ table: "questions", id: q.id, error: String(e) }); }
  }
  writeFileSync(planFile, JSON.stringify({ ref, createdAt: new Date().toISOString(), inspected, collisions: [...collisions], repairs, blocked }, null, 2));
  console.log(JSON.stringify({ ref, inspected: inspected.length, collisions: collisions.size, repairs: repairs.length, imports: new Set(repairs.map(p => p.importId)).size, blocked }));
}
