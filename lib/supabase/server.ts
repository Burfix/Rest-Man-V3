/**
 * Supabase server-side client.
 * Use in Server Components, Route Handlers, and Server Actions.
 * Uses the SERVICE_ROLE key — never expose to the browser.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let _client: ReturnType<typeof createSupabaseClient<Database>> | null = null;

export function createServerClient() {
  if (_client) return _client;

  // Trim whitespace/newlines — Vercel env vars stored via CLI sometimes have
  // a trailing \n which produces an invalid JWT and causes Supabase to fall
  // back to the anon role, silently bypassing service-role access.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  _client = createSupabaseClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _client;
}
