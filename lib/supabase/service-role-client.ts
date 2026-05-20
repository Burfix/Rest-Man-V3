/**
 * lib/supabase/service-role-client.ts
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SERVICE-ROLE CLIENT — INTERNAL USE ONLY                               ║
 * ║  Bypasses ALL Supabase RLS policies.                                   ║
 * ║                                                                        ║
 * ║  ALLOWED callers:                                                      ║
 * ║    • Cron jobs   (app/api/cron/**)                                     ║
 * ║    • MICROS sync workers (services/micros/**)                          ║
 * ║    • Scheduler workers                                                 ║
 * ║    • Internal admin / migration utilities (scripts/**)                 ║
 * ║    • lib/auth/get-user-context.ts (role/org lookup only)               ║
 * ║                                                                        ║
 * ║  NEVER use in user-facing API routes — use getUserScopedClient() or    ║
 * ║  apiGuard() instead.  Every query must include an explicit site_id     ║
 * ║  WHERE clause since RLS is bypassed.                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Module-level singleton — shared across all requests within a single
 * Node process. This is intentional: the service-role JWT never expires
 * within normal Vercel function lifetimes.
 */
let _serviceRoleClient: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Returns the service-role Supabase client.
 *
 * SECURITY: Call sites MUST add explicit `site_id` / `organisation_id`
 * WHERE clauses on every query. This client bypasses RLS entirely.
 */
export function getServiceRoleClient(): ReturnType<typeof createClient<Database>> {
  if (_serviceRoleClient) return _serviceRoleClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      "[service-role-client] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  _serviceRoleClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _serviceRoleClient;
}

/**
 * Re-export as `createServiceRoleClient` for call sites that prefer a
 * factory-style name.  Always returns the same singleton.
 */
export const createServiceRoleClient = getServiceRoleClient;
