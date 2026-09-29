import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const supabaseAnonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes("your-project-id") &&
  supabaseUrl.startsWith("https://"),
);

// Fallback dummy URL and anon key to prevent createClient throw during offline/demo execution
const safeUrl = isSupabaseConfigured
  ? (supabaseUrl as string)
  : "https://placeholder-project.supabase.co";
const safeKey = isSupabaseConfigured ? (supabaseAnonKey as string) : "placeholder-anon-key";

export const supabase = createClient<Database>(safeUrl, safeKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
