/**
 * API Route Guard — combines auth, RBAC, tenant isolation, and logging.
 *
 * Wraps getUserContext + requirePermission into a single call that
 * returns a ready-to-use context object or an error Response.
 *
 * Usage:
 *   const guard = await apiGuard("actions:create");
 *   if (guard.error) return guard.error;
 *   const { ctx, supabase } = guard;
 */

import { getUserContext, authErrorResponse, type UserContext } from "./get-user-context";
import { hasPermission, type Permission } from "@/lib/rbac/roles";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export interface GuardSuccess {
  error: null;
  ctx: UserContext;
  supabase: ReturnType<typeof createServerClient>;
}

export interface GuardFail {
  error: Response;
  ctx: null;
  supabase: null;
}

export type GuardResult = GuardSuccess | GuardFail;

/**
 * Authenticate user, check permission, and return tenant context.
 *
 * @param permission — RBAC permission string (optional for read-only routes)
 * @param route      — route name for logging (e.g. "POST /api/actions")
 */
export async function apiGuard(
  permission?: Permission | null,
  route?: string,
): Promise<GuardResult> {
  try {
    const ctx = await getUserContext();

    if (permission && !hasPermission(ctx.role, permission)) {
      logger.warn("Permission denied", {
        route,
        userId: ctx.userId,
        role: ctx.role,
        permission,
        siteId: ctx.siteId,
      });
      return {
        error: new Response(
          JSON.stringify({
            error: `Role '${ctx.role}' does not have permission '${permission}'`,
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
        ctx: null,
        supabase: null,
      };
    }

    const supabase = createServerClient();
    return { error: null, ctx, supabase };
  } catch (err) {
    logger.error("Auth guard failed", { route, err });
    return { error: authErrorResponse(err), ctx: null, supabase: null };
  }
}
