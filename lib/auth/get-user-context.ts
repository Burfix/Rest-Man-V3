/**
 * User Context — tenant-aware auth for API routes.
 *
 * Extracts user identity, role, and site_id from the Supabase session.
 * Replaces all hardcoded DEFAULT_SITE_ID usage across the codebase.
 *
 * Usage:
 *   const ctx = await getUserContext();
 *   // ctx.userId, ctx.email, ctx.role, ctx.siteId, ctx.siteIds
 */

import { cookies } from "next/headers";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/ontology/entities";

export interface UserContext {
  userId: string;
  email: string;
  role: UserRole;
  siteId: string;       // primary site (for GM/supervisor/contractor)
  siteIds: string[];     // all accessible sites (for area_manager/executive/super_admin)
  orgId: string | null;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403 = 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Get the authenticated user's full tenant context.
 * Throws AuthError (401) if not authenticated, (403) if no role assigned.
 */
export async function getUserContext(): Promise<UserContext> {
  // 1. Authenticate via Supabase session cookie
  const cookieStore = cookies();
  const supabase = createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return (cookieStore as any).get(name)?.value;
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AuthError("Not authenticated", 401);
  }

  // 2. Fetch role + site assignment via service role client
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: roles } = await db
    .from("user_roles")
    .select("role, site_id, organisation_id, region_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });

  if (!roles || roles.length === 0) {
    throw new AuthError("No role assigned — contact your administrator", 403);
  }

  // 3. Determine highest-priority role
  const ROLE_RANK: Record<string, number> = {
    super_admin: 100,
    executive: 80,
    auditor: 70,
    area_manager: 60,
    gm: 40,
    supervisor: 20,
    contractor: 10,
  };

  const sorted = [...roles].sort(
    (a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0),
  );
  const primary = sorted[0];
  const role = primary.role as UserRole;
  const orgId = (primary.organisation_id as string) ?? null;

  // 4. Resolve accessible site IDs
  const { data: accessibleSites } = await db.rpc("user_accessible_sites", {
    p_user_id: user.id,
  });
  const siteIds = ((accessibleSites ?? []) as { site_id: string }[]).map(
    (r) => r.site_id,
  );

  // Primary site_id: use role's site_id, or first accessible site
  const siteId = (primary.site_id as string) ?? siteIds[0] ?? "";

  if (!siteId) {
    throw new AuthError("No site assigned — contact your administrator", 403);
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    role,
    siteId,
    siteIds: siteIds.length > 0 ? siteIds : [siteId],
    orgId,
  };
}

/** Convert AuthError to a JSON Response for API routes. */
export function authErrorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.statusCode,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ error: "Internal server error" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}
