import type { serviceClient } from "./supabase.ts";
import { json, error } from "./cors.ts";

export async function deleteAssignmentBatch(svc: ReturnType<typeof serviceClient>, kind: "practice" | "full", id: string, adminId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return error("Invalid assignment ID", 422);
  const { data, error: deleteError } = await svc.rpc("delete_assignment_batch", { p_kind: kind, p_id: id, p_admin_id: adminId });
  if (deleteError) return error("Unable to delete assignment. Please try again.", 500);
  if (!data) return error("Assignment not found", 404);
  return json({ ok: true });
}
