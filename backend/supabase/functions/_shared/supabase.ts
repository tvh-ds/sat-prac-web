import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export function userClient(req: Request): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not set");
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}