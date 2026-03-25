/**
 * RBAC Guards
 *
 * Server-side utilities for enforcing access control in:
 *   - Next.js API routes
 *   - Server components / server actions
 *
 * Usage in API routes:
 *   const { user, role } = await requireAuth(request);
 *   await requirePermission(user.id, PERMISSIONS.COMPLETE_ACTION);
 *
 * Usage in server components:
 *   const { role } = await getUserRoleForSite(userId, siteId);
 */

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import type { UserRole } from "@/lib/ontology/entities";
import type { Permission } from "./roles";
import { hasPermission, ROLE_PERMISSIONS } from "./roles";

// ── Auth helpers ───────────────────────────────────────────────────────────────

/**
 * Convenience guard for API routes. Authenticates user and optionally
 * checks a permission. Throws AuthError (catch with authErrorResponse).
 *
 *   const user = await requireAuth();
 *   const user = await requireAuth(PERMISSIONS.CREATE_ACTION);
 */
export async function requireAuth(
  permission?: Permission,
  siteId?: string,
): Promise<{ id: string; email: string; role: UserRole | null }> {
  const user = await getAuthenticatedUser();
  let role: UserRole | null = null;
  if (permission) {
    role = await requirePermission(user.id, permission, siteId);
  } else {
    role = await getUserRole(user.id);
  }
  return { ...user, role };
}

/**
 * Reads the authenticated user from the Supabase session cookie.
 * Throws 401 if not authenticated.
 */
export async function getAuthenticatedUser(): Promise<{ id: string; email: string }> {
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
    }
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new AuthError("Not authenticated", 401);
  }
  return { id: user.id, email: user.email ?? "" };
}

/**
 * Returns the highest-priority active role for a user.
 * Falls back to null if the user has no role.
 */
export async function getUserRole(userId: string): Promise<UserRole | null> {
  const db = serviceRoleDb();
  const { data } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });

  if (!data || data.length === 0) return null;

  // Return highest-ranking role
  const roles = data.map((r: any) => r.role as UserRole);
  const { roleRank } = await import("./roles");
  return roles.reduce((best, r) => (roleRank(r) > roleRank(best) ? r : best));
}

/**
 * Returns the role a user has specifically for a given site.
 * Falls back to their org-level role if no site-specific role.
 */
export async function getUserRoleForSite(
  userId: string,
  siteId: string
): Promise<UserRole | null> {
  const db = serviceRoleDb();

  // Check for site-specific role first
  const { data: siteRole } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("site_id", siteId)
    .eq("is_active", true)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (siteRole) return siteRole.role as UserRole;

  // Fall back to org-level role
  return getUserRole(userId);
}

// ── Permission guards ──────────────────────────────────────────────────────────

/**
 * Throws 403 if the user's role does not have the required permission.
 */
export async function requirePermission(
  userId:     string,
  permission: Permission,
  siteId?:    string
): Promise<UserRole> {
  const role = siteId
    ? await getUserRoleForSite(userId, siteId)
    : await getUserRole(userId);

  if (!role) throw new AuthError("No role assigned", 403);
  if (!hasPermission(role, permission)) {
    throw new AuthError(
      `Role '${role}' does not have permission '${permission}'`,
      403
    );
  }
  return role;
}

/**
 * Used in server components to check visibility without throwing.
 */
export async function canDo(
  userId:     string,
  permission: Permission,
  siteId?:    string
): Promise<boolean> {
  try {
    await requirePermission(userId, permission, siteId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a user's accessible site IDs (for use in data queries).
 */
export async function getAccessibleSiteIds(userId: string): Promise<string[]> {
  const db = serviceRoleDb();
  const { data } = await db.rpc("user_accessible_sites", { p_user_id: userId });
  return ((data ?? []) as { site_id: string }[]).map((r) => r.site_id);
}

// ── AuthError ─────────────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403 = 403
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Convert AuthError to a NextResponse — use in API routes. */
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

// ── Internal ──────────────────────────────────────────────────────────────────

function serviceRoleDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
