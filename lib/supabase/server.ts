/**
 * @deprecated — SERVICE-ROLE ALIAS. THIS CLIENT BYPASSES RLS.
 *
 * `createServerClient()` returns the service-role Supabase client — it does
 * NOT create a session-scoped client. The name is misleading and this export
 * exists only for backward compatibility with existing callers.
 *
 * Migration guide:
 *   - Cron routes / admin / sync workers → import getServiceRoleClient from
 *     "@/lib/supabase/service-role-client" and add explicit site_id WHERE clauses.
 *   - User-facing routes that need session auth → use getUserContext() from
 *     "@/lib/auth/get-user-context" and let RLS enforce tenant isolation.
 *
 * Every query through this client MUST include an explicit site_id or
 * user_id WHERE clause. There is no RLS backstop.
 *
 * @see lib/supabase/service-role-client.ts — canonical factory
 */
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";

/** @deprecated Use getServiceRoleClient() from "@/lib/supabase/service-role-client" */
export function createServerClient() {
  return getServiceRoleClient();
}
