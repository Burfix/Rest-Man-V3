/**
 * Supabase SSR session client.
 *
 * Separate from lib/supabase/server.ts (which uses the service-role key for
 * privileged data access). This module creates cookie-aware clients used
 * exclusively for authentication — middleware, login, logout, and reading the
 * current user in server components.
 *
 * Uses the public ANON key because Supabase Auth operates on the anon key tier.
 */

import { createServerClient as createSupabaseSSRClient, type CookieOptions } from "@supabase/ssr";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

function url() {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return v;
}

function anonKey() {
  const v = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  return v;
}

/**
 * Used in Server Actions and Route Handlers where `next/headers` cookies() is
 * available. The cookie store is passed in by the caller.
 */
export function createSessionClient(cookieStore: ReadonlyRequestCookies) {
  return createSupabaseSSRClient(url(), anonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          // ReadonlyRequestCookies.set throws outside mutations
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (cookieStore as any).set({ name, value, ...options });
        } catch {
          // Silently ignored in Server Components (read-only context)
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (cookieStore as any).set({ name, value: "", ...options });
        } catch {
          // Silently ignored in Server Components
        }
      },
    },
  });
}
