export const SUPABASE_URL = "https://btwphzfdfgmnfekzrntv.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_rrC3zztom0NDCnml6AUbtg_vvGSXgu3";

export const isConfigured = () =>
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_ANON_KEY.startsWith("PASTE_");
