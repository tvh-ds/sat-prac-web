import { deleteAssignmentBatch } from "./delete_assignment_batch.ts";
import type { serviceClient } from "./supabase.ts";

const id = "11111111-1111-4111-8111-111111111111";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function mock(result: { data: boolean | null; error: { message: string } | null }) {
  const calls: unknown[][] = [];
  const svc = { rpc: (...args: unknown[]) => { calls.push(args); return Promise.resolve(result); } } as unknown as ReturnType<typeof serviceClient>;
  return { svc, calls };
}

Deno.test("delete batch rejects malformed identifiers without calling the database", async () => {
  const { svc, calls } = mock({ data: true, error: null });
  const res = await deleteAssignmentBatch(svc, "practice", "invalid", id);
  assert(res.status === 422 && calls.length === 0, "Malformed ID reached the database");
});

Deno.test("delete batch scopes RPC to exact kind, batch and authenticated admin", async () => {
  for (const kind of ["practice", "full"] as const) {
    const { svc, calls } = mock({ data: true, error: null });
    const res = await deleteAssignmentBatch(svc, kind, id, "admin-id");
    assert(res.status === 200, "Successful delete failed");
    assert(JSON.stringify(calls) === JSON.stringify([["delete_assignment_batch", { p_kind: kind, p_id: id, p_admin_id: "admin-id" }]]), "Wrong deletion scope");
  }
});

Deno.test("delete batch returns not found for missing or already deleted batch", async () => {
  const { svc } = mock({ data: false, error: null });
  assert((await deleteAssignmentBatch(svc, "full", id, id)).status === 404, "Missing batch succeeded");
});

Deno.test("delete batch hides database details and reports failure", async () => {
  const { svc } = mock({ data: null, error: { message: "private database details" } });
  const res = await deleteAssignmentBatch(svc, "full", id, id);
  assert(res.status === 500, "Database failure succeeded");
  assert(!(await res.text()).includes("private database details"), "Internal error leaked");
});
