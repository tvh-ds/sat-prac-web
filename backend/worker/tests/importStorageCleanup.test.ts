import { describe, it, expect, vi } from "vitest";
import { cleanupImportedTestStorage, tryCleanupImportedTestStorage, retryPendingImportStorageCleanup, tryCleanupPublishedTestStorage } from "../../supabase/functions/_shared/importStorageCleanup";

const id = "11111111-1111-4111-8111-111111111111";
const former = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const image = (name: string, owner = id) => `imports/${owner}/stimuli/${name}.png`;

function fixture() {
  const tables: Record<string, any[]> = {
    pdf_imports: [{ id, status: "completed", generated_test_id: "test", storage_path: "uploads/source.pdf", text_quality: {} }],
    ai_ingestion_review_jobs: [],
    draft_questions: [{ id: "draft", pdf_import_id: id, question_id: "question", review_state: "complete", stimulus_image_path: image("crop"), stimulus_source_image_path: image("source", former), review_source_image_path: image("review") }],
    questions: [{ id: "question", stimulus_image_path: image("crop") }, { id: "shared", stimulus_image_path: image("shared", former) }],
  };
  const files: Record<string, Set<string>> = { "pdf-imports": new Set(["uploads/source.pdf"]), "question-assets": new Set([image("crop"), image("review"), image("source", former), image("shared", former), image("old"), image("unrelated", other)]) };
  let failTable: string | null = null;
  let failRemove = false;
  const publication = { eligible: true, whole_import: true };
  const client = {
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      let patch: any = null, start = 0, end = Infinity, single = false;
      const query: any = {
        select: () => query,
        update: (value: any) => { patch = value; return query; },
        eq: (key: string, value: any) => { filters.push((r) => key === "text_quality->storage_cleanup->>status" ? r.text_quality?.storage_cleanup?.status === value : r[key] === value); return query; },
        neq: (key: string, value: any) => { filters.push((r) => r[key] !== value); return query; },
        in: (key: string, values: any[]) => { filters.push((r) => values.includes(r[key])); return query; },
        not: (key: string, _op: string, value: any) => { filters.push((r) => r[key] !== value); return query; },
        order: () => query,
        range: (a: number, b: number) => { start = a; end = b + 1; return query; },
        limit: (n: number) => { end = n; return query; },
        single: () => { single = true; return query; },
        maybeSingle: () => { single = true; return query; },
        then(resolve: (v: any) => void, reject: (e: any) => void) {
          if (failTable === table) return Promise.resolve({ data: null, error: { message: "read denied" } }).then(resolve, reject);
          const rows = tables[table]!.filter((r) => filters.every((f) => f(r))).slice(start, end);
          if (patch) rows.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc: vi.fn(async (name: string, args: any) => {
      if (name === "published_import_cleanup_state") return { data: publication, error: null };
      if (name === "published_image_imports") return { data: [{ import_id: id }], error: null };
      for (const draft of tables.draft_questions!.filter((d) => d.pdf_import_id === args.p_import_id)) {
        draft.stimulus_source_image_path = draft.stimulus_image_path;
        draft.review_source_image_path = null;
        draft.stimulus_crop_rect = null;
      }
      return { error: null };
    }),
    storage: { from: (bucket: string) => ({
      list: vi.fn(async (prefix: string, options: any) => {
        const entries = new Map<string, any>();
        for (const path of files[bucket]!) {
          if (!path.startsWith(`${prefix}/`)) continue;
          const relative = path.slice(prefix.length + 1), name = relative.split("/")[0]!;
          entries.set(name, { name, id: relative.includes("/") ? null : path });
        }
        return { data: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(options.offset, options.offset + options.limit), error: null };
      }),
      remove: vi.fn(async (paths: string[]) => {
        if (failRemove) { failRemove = false; return { data: null, error: { message: "storage unavailable" } }; }
        const removed = paths.filter((path) => files[bucket]!.delete(path));
        return { data: removed.map((name) => ({ name })), error: null };
      }),
    }) },
  };
  return { client, tables, files, publication, failRead: (table: string) => { failTable = table; }, failNextRemoval: () => { failRemove = true; } };
}

describe("post-test source storage cleanup", () => {
  it("deletes PDF, source/review images and obsolete files, preserving test and shared images", async () => {
    const f = fixture();
    const result = await cleanupImportedTestStorage(f.client, id);
    expect(result).toMatchObject({ status: "complete", deleted_pdfs: 1, deleted_images: 3, retained_images: 2 });
    expect([...f.files["question-assets"]!].sort()).toEqual([image("crop"), image("shared", former), image("unrelated", other)].sort());
    expect(f.tables.draft_questions![0]).toMatchObject({ review_state: "complete", stimulus_source_image_path: image("crop"), review_source_image_path: null });
    expect(f.tables.pdf_imports![0].text_quality.storage_cleanup.status).toBe("complete");
  });
  it("does not clean an import before test generation or while review is running", async () => {
    const f = fixture(); f.tables.pdf_imports![0].status = "processing";
    await expect(cleanupImportedTestStorage(f.client, id)).rejects.toThrow("completed import");
    f.tables.pdf_imports![0].status = "completed";
    f.tables.ai_ingestion_review_jobs!.push({ id: "job", pdf_import_id: id, status: "running" });
    await expect(cleanupImportedTestStorage(f.client, id)).rejects.toThrow("still running");
    expect(f.files["question-assets"]!.size).toBe(6);
    expect(f.files["pdf-imports"]!.size).toBe(1);
    expect(f.client.rpc.mock.calls.some(([name]) => name === "release_import_source_images")).toBe(false);
  });
  it("retains all source files until publication and avoids retry starvation", async () => {
    const f = fixture(); f.publication.eligible = false;
    f.tables.pdf_imports![0].text_quality = { storage_cleanup: { status: "pending" } };
    expect((await cleanupImportedTestStorage(f.client, id)).status).toBe("awaiting_publication");
    expect(f.tables.pdf_imports![0].text_quality.storage_cleanup.status).toBe("awaiting_publication");
    expect(f.files["question-assets"]!.size).toBe(6);
    expect(f.files["pdf-imports"]!.size).toBe(1);
    expect(f.client.rpc.mock.calls.some(([name]) => name === "release_import_source_images")).toBe(false);
  });
  it("cleans legacy published question imports without deleting the shared source PDF", async () => {
    const f = fixture(); f.tables.pdf_imports![0].generated_test_id = null;
    f.publication.whole_import = false;
    const result = await tryCleanupPublishedTestStorage(f.client, "test");
    expect(result[0]!.status).toBe("complete");
    expect(f.files["question-assets"]!.has(image("source", former))).toBe(false);
    expect(f.files["pdf-imports"]!.size).toBe(1);
  });
  it("paginates storage and reference scans beyond 1,000 rows", async () => {
    const f = fixture();
    for (let n = 0; n < 1100; n++) { f.files["question-assets"]!.add(image(`extra-${n}`)); f.tables.questions!.push({ id: `q-${n}`, stimulus_image_path: image(`extra-${n}`) }); }
    f.files["question-assets"]!.add(image("zz-unused"));
    await cleanupImportedTestStorage(f.client, id);
    expect(f.files["question-assets"]!.has(image("extra-1099"))).toBe(true);
    expect(f.files["question-assets"]!.has(image("zz-unused"))).toBe(false);
  });
  it("retains shared PDF and another import's source/review references", async () => {
    const f = fixture();
    f.tables.pdf_imports!.push({ id: other, storage_path: "uploads/source.pdf" });
    f.tables.draft_questions!.push({ id: "other", pdf_import_id: other, stimulus_source_image_path: image("old"), review_source_image_path: image("review") });
    await cleanupImportedTestStorage(f.client, id);
    expect(f.files["pdf-imports"]!.has("uploads/source.pdf")).toBe(true);
    expect(f.files["question-assets"]!.has(image("old"))).toBe(true);
    expect(f.files["question-assets"]!.has(image("review"))).toBe(true);
  });
  it("fails closed on reference lookup errors", async () => {
    const f = fixture(); f.failRead("questions");
    await expect(cleanupImportedTestStorage(f.client, id)).rejects.toThrow("read denied");
    expect(f.files["question-assets"]!.size).toBe(6);
    expect(f.files["pdf-imports"]!.size).toBe(1);
  });
  it("persists former directories for retry after source references have been released", async () => {
    const f = fixture(); f.failNextRemoval();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await tryCleanupImportedTestStorage(f.client, id)).status).toBe("pending");
    expect(f.tables.pdf_imports![0].generated_test_id).toBe("test");
    expect(f.tables.pdf_imports![0].text_quality.storage_cleanup.prefixes).toContain(`imports/${former}`);
    await retryPendingImportStorageCleanup(f.client);
    expect(f.files["question-assets"]!.has(image("source", former))).toBe(false);
    expect(f.tables.pdf_imports![0].text_quality.storage_cleanup.status).toBe("complete");
    await cleanupImportedTestStorage(f.client, id);
    expect(f.files["question-assets"]!.has(image("crop"))).toBe(true);
    log.mockRestore();
  });
  it("does not sweep a referenced directory belonging to another existing import", async () => {
    const f = fixture(); f.tables.pdf_imports!.push({ id: former });
    await cleanupImportedTestStorage(f.client, id);
    expect(f.files["question-assets"]!.has(image("source", former))).toBe(true);
  });
});
