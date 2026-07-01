import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./config.js";

export const supabase = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export function requireClient() {
  if (!supabase) throw new Error("Add your Supabase publishable/anon key in js/config.js first.");
  return supabase;
}
