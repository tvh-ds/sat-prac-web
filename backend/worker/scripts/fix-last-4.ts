import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://ygqndcgpbtmewzkruyuq.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (see backend/worker/.env)");
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const imp = (await supabase.from("pdf_imports").select("id").eq("storage_path", "local-no-upload").order("created_at", { ascending: false }).limit(1).single()).data!.id;
const { data: remaining } = await supabase.from("draft_questions").select("id, source_question_id").eq("pdf_import_id", imp).eq("status", "has_suggested_key");
for (const r of remaining ?? []) {
  const { data: q } = await supabase.from("questions").select("id").eq("source_question_id", r.source_question_id).maybeSingle();
  if (q) {
    await supabase.from("draft_questions").update({ status: "approved", question_id: q.id }).eq("id", r.id);
    await supabase.from("draft_answer_keys").update({ status: "approved" }).eq("draft_question_id", r.id).eq("status", "suggested");
    console.log("Linked Q" + r.source_question_id);
  } else {
    console.log("No question found for " + r.source_question_id);
  }
}
const { count } = await supabase.from("draft_questions").select("*", { count: "exact", head: true }).eq("pdf_import_id", imp).eq("status", "has_suggested_key");
console.log("Still remaining:", count);
