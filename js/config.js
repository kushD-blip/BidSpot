/* js/config.js — public, client-safe config. The anon key is designed to be exposed;
   Row Level Security (see schema.sql) is what actually restricts what it can do.
   Fill these in once your Supabase project exists, then js/supabase-client.js goes live. */

export const SUPABASE_URL = "https://cpuiwxbhyaaajrdwwakz.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_vFJB8ExVbh4M_L68ePDKOg_0rb1cFf_";

export const isSupabaseConfigured =
  !SUPABASE_URL.includes("YOUR-PROJECT-REF") && !SUPABASE_ANON_KEY.includes("your-anon-public-key");
