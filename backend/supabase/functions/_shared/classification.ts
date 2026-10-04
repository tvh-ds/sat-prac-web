import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./auth.ts";
import { json } from "./cors.ts";

export async function classificationRoute(req: Request, seg: string[], svc: SupabaseClient, actorId: string): Promise<Response | null> {
  if (seg[2] !== "classification") return null;
  const importId = seg[1];
  if (req.method === "GET" && seg.length === 3) {
    const { data: jobs, error } = await svc.from("classification_jobs").select("*").eq("pdf_import_id", importId).order("created_at", { ascending: false }).limit(5);
    if (error) throw new HttpError(500, "Could not load classification jobs");
    const current = jobs?.[0];
    const { data: suggestions, error: suggestionsError } = current
      ? await svc.from("classification_suggestions").select("id,draft_question_id,status,error_category,prediction,input_snapshot,created_at").eq("job_id", current.id)
      : { data: [], error: null };
    if (suggestionsError) throw new HttpError(500, "Could not load suggestions");
    return json({ jobs, current_job: current ?? null, suggestions });
  }
  if (req.method === "POST" && seg.length === 3) {
    const body = await req.json();
    if (!body || typeof body !== "object" || Object.keys(body).some((key) => key !== "draft_ids")) throw new HttpError(422, "Invalid classification request");
    if (body.draft_ids !== undefined && (!Array.isArray(body.draft_ids) || !body.draft_ids.length || body.draft_ids.length > 150 || body.draft_ids.some((v: unknown) => typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)))) throw new HttpError(422, "Invalid draft IDs");
    const workerUrl = Deno.env.get("WORKER_URL"), workerToken = Deno.env.get("WORKER_AUTH_TOKEN");
    if (!workerUrl || !workerToken) throw new HttpError(503, "Classification worker is not configured");
    let response: Response;
    try {
      response = await fetch(`${workerUrl}/classify`, { method: "POST", headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ import_id: importId, actor_id: actorId, draft_ids: body.draft_ids }), signal: AbortSignal.timeout(35000) });
    } catch { throw new HttpError(503, "Classification worker unavailable"); }
    if (!response.ok) throw new HttpError(response.status === 422 ? 422 : 503, response.status === 422 ? "No eligible unpublished drafts" : "Classification service unavailable");
    return json(await response.json(), 202);
  }
  if (req.method === "POST" && seg.length === 6 && seg[3] === "suggestions" && seg[5] === "decision") {
    const body = await req.json();
    if (!body || !["accept", "dismiss"].includes(body.decision) || Object.keys(body).some((key) => !["decision", "labels", "replace_existing"].includes(key)) ||
       (body.replace_existing !== undefined && typeof body.replace_existing !== "boolean")) throw new HttpError(422, "Invalid decision");
    const { data: suggestion, error: lookupError } = await svc.from("classification_suggestions").select("id,job:classification_jobs!inner(pdf_import_id)").eq("id", seg[4]).eq("job.pdf_import_id", importId).maybeSingle();
    if (lookupError || !suggestion) throw new HttpError(404, "Suggestion not found in this import");
    const { error } = await svc.rpc("decide_classification", { p_suggestion_id: suggestion.id, p_actor_id: actorId,
      p_decision: body.decision, p_labels: body.labels ?? {}, p_replace_existing: body.replace_existing === true });
    if (error) throw new HttpError(/Stale|not ready|replacement/.test(error.message) ? 409 : 422, error.message);
    return json({ ok: true });
  }
  throw new HttpError(404, "Classification route not found");
}
