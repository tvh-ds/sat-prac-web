import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { userClient } from "./supabase.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface UserContext {
  user: { id: string; email?: string };
  profile: { id: string; role: "admin" | "student"; full_name: string };
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

export function pathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean);
}