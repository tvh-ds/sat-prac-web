import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { serviceClient, userClient } from "./supabase.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface UserContext {
  user: { id: string; email?: string };
  profile: { id: string; role: "admin" | "student"; full_name: string };
}

async function verifiedUser(req: Request): Promise<{ id: string; email?: string }> {
  const client = userClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Unauthorized");
  return { id: data.user.id, email: data.user.email ?? undefined };
}

async function resolveProfile(client: SupabaseClient, userId: string): Promise<UserContext["profile"] | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `Failed to load profile: ${error.message}`);
  return data as UserContext["profile"] | null;
}

export async function requireUser(req: Request): Promise<UserContext> {
  const client = userClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Unauthorized");
  const profile = await resolveProfile(client, data.user.id);
  if (!profile) throw new HttpError(403, "No profile found for this account");
  return { user: { id: data.user.id, email: data.user.email ?? undefined }, profile };
}

export async function requireRole(req: Request, role: "admin" | "student"): Promise<UserContext> {
  const ctx = await requireUser(req);
  if (ctx.profile.role !== role) {
    throw new HttpError(403, `Forbidden: requires ${role} role`);
  }
  return ctx;
}

export async function requireApprovedStudent(req: Request): Promise<UserContext> {
  const user = await verifiedUser(req);
  const { data, error } = await serviceClient()
    .from("student_profiles")
    .select("profile_status, profile:profiles!student_profiles_id_fkey(id, role, full_name)")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("Failed to load verified student profile", error);
    throw new HttpError(500, "Unable to load student profile");
  }
  const profile = (data as unknown as {
    profile_status: string;
    profile: UserContext["profile"] | null;
  } | null)?.profile;
  if (!profile) throw new HttpError(403, "No profile found for this account");
  if (profile.role !== "student") throw new HttpError(403, "Forbidden: requires student role");
  if ((data as { profile_status: string } | null)?.profile_status !== "approved") {
    throw new HttpError(403, "Student profile approval is required before accessing study features");
  }
  return { user, profile };
}

export function pathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}
