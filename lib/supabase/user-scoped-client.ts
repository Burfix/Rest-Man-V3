/**
 * lib/supabase/user-scoped-client.ts
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  USER-SCOPED CLIENT — FOR USER-FACING API ROUTES                       ║
 * ║  Uses the ANON key + the user's session JWT.                           ║
 * ║  RLS policies apply.  Tenant isolation enforced at the DB layer.       ║
 * ║                                                                        ║
 * ║  Use this in:                                                          ║
 * ║    • User-facing Route Handlers (app/api/**)                           ║
 * ║    • Server Components that render per-user data                       ║
 * ║                                                                        ║
 * ║  Do NOT use for:                                                       ║
 * ║    • Cron jobs  (they have no session — use service-role-client.ts)   ║
 * ║    • MICROS sync workers                                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Creates a per-request Supabase client that uses the visitor's session JWT
 * (from the sb-access-token cookie). This client is subject to RLS policies.
 *
 * Must be called inside a Next.js Route Handler or Server Component where
 * `cookies()` is available.
 */
export function createUserScopedClient() {
  const cookieStore = cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    throw new Error(
      "[user-scoped-client] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      get(name: string) {
        return (cookieStore as any).get(name)?.value;
      },
    },
  });
}
