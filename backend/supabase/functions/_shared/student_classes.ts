import { HttpError } from "./auth.ts";
import type { serviceClient } from "./supabase.ts";
type Svc = ReturnType<typeof serviceClient>;

export async function classRecipients(svc: Svc, target: { class_id?: string; student_ids?: string[] }) {
  if (!target.class_id) {
    const ids = [...new Set(target.student_ids ?? [])];
    const { data, error } = await svc.from("student_profiles").select("id,profile:profiles!student_profiles_id_fkey!inner(role)").eq("profile.role", "student").in("id", ids);
    if (error) throw new HttpError(500, "Unable to validate students");
    if (!ids.length || data?.length !== ids.length) throw new HttpError(422, "Select valid student accounts");
    return { student_ids: ids, class_id: null, class_name: null };
  }
  const { data: cls, error: clsError } = await svc.from("student_classes").select("id,name").eq("id", target.class_id).maybeSingle();
  if (clsError) throw new HttpError(500, "Unable to load class");
  if (!cls) throw new HttpError(404, "Class not found");
  const { data: members, error, count } = await svc.from("student_class_members").select("student_id", { count: "exact" }).eq("class_id", cls.id).order("student_id").limit(1000);
  if (error) throw new HttpError(500, "Unable to load class members");
  if (!members?.length) throw new HttpError(422, "This class is empty. Add students before assigning work.");
  if ((count ?? members.length) > 1000) throw new HttpError(422, "A class assignment supports up to 1,000 students");
  await classRecipients(svc, { student_ids: members.map((m) => m.student_id as string) });
  return { student_ids: members.map((m) => m.student_id as string), class_id: cls.id as string, class_name: cls.name as string };
}
