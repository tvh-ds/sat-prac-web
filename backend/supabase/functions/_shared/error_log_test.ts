import assert from "node:assert/strict";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { loadErrorLogPage } from "./error_log.ts";
import { HttpError } from "./auth.ts";

function fixture() {
  const calls: Array<Record<string, unknown>> = [];
  const signedPaths: string[][] = [];
  const svc = {
    rpc: (_name: string, params: Record<string, unknown>) => {
      calls.push(params);
      return Promise.resolve({ data: {
        items: [{ item_id: "attempt:question", stimulus_image_path: "private/graph.png" }],
        total: params.p_domain || params.p_skill ? 2 : 23,
        needs_review_count: 18,
        domains: ["Algebra"], skills: ["Linear equations"],
      }, error: null });
    },
    storage: { from: () => ({ createSignedUrls: (paths: string[]) => {
      signedPaths.push(paths);
      return Promise.resolve({ data: paths.map(path => ({ path, signedUrl: "https://signed.invalid/graph" })), error: null });
    } }) },
  } as unknown as SupabaseClient;
  return { svc, calls, signedPaths };
}

Deno.test("review totals cover the entire log across pages and sign only displayed images", async () => {
  const { svc, calls, signedPaths } = fixture();
  const page = await loadErrorLogPage(svc, "student-a", new URL("https://test.invalid/?page=2"));
  assert.equal(page.reviewed_count, 5);
  assert.equal(page.review_total, 23);
  assert.equal(page.needs_review_count, 18);
  assert.equal(page.page, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_student_id, "student-a");
  assert.equal(calls[0].p_page, 2);
  assert.deepEqual(signedPaths, [["private/graph.png"]]);
  assert.equal(page.items[0].stimulus_image_url, "https://signed.invalid/graph");
  assert.equal("stimulus_image_path" in page.items[0], false);
});

Deno.test("domain and skill filters do not turn a filtered total into the review denominator", async () => {
  const { svc, calls } = fixture();
  const page = await loadErrorLogPage(svc, "student-b", new URL("https://test.invalid/?domain=Algebra&skill=Linear%20equations"));
  assert.equal(page.total, 2);
  assert.equal(page.review_total, 23);
  assert.equal(page.reviewed_count, 5);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.p_student_id === "student-b"));
  assert.equal(calls[0].p_domain, "Algebra");
  assert.equal(calls[0].p_skill, "Linear equations");
  assert.equal(calls[1].p_domain, null);
  assert.equal(calls[1].p_skill, null);
});

Deno.test("invalid pagination and oversized filters fail before accessing student records", async () => {
  const { svc, calls } = fixture();
  for (const query of ["page=0", "page=-1", "page=1.5", "page=10001", "page=abc", `domain=${"x".repeat(101)}`, `skill=${"x".repeat(101)}`]) {
    await assert.rejects(() => loadErrorLogPage(svc, "student-a", new URL(`https://test.invalid/?${query}`)),
      error => error instanceof HttpError && error.status === 400);
  }
  assert.equal(calls.length, 0);
});

Deno.test("an empty log has zero reviewed and zero total", async () => {
  const svc = { rpc: () => Promise.resolve({ data: { items: [], total: 0, needs_review_count: 0, domains: [], skills: [] }, error: null }) } as unknown as SupabaseClient;
  const page = await loadErrorLogPage(svc, "student-a", new URL("https://test.invalid/"));
  assert.equal(page.reviewed_count, 0);
  assert.equal(page.review_total, 0);
  assert.deepEqual(page.items, []);
});
