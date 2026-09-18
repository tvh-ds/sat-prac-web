import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createSupabase(config: { supabaseUrl: string; supabaseServiceKey: string }): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false },
  });
}