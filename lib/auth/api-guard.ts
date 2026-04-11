/**
 * API Route Guard — combines auth, RBAC, tenant isolation, and logging.
 *
 * Two modes:
 *
 * 1. EXISTING (unchanged): call-and-check pattern
 *    const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/actions");
 *    if (guard.error) return guard.error;
 *    const { ctx, supabase } = guard;
 *
 * 2. NEW (Phase 1): site-aware guard with optional site validation
 *    const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/ops", { siteId });
 *    if (guard.error) return guard.error;
 *    // guard.ctx.siteId is validated against user's accessible sites
 */

import { getUserContext, authErrorResponse, type UserContext } from "./get-user-context";
import { hasPermission, type Permission } from "@/lib/rbac/roles";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { moduleErrorResponse, type ModuleName } from "@/lib/modules";

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

export interface GuardOptions {
  /** Validate that the user can access this specific site. */
  siteId?: string;
  /** Require a module to be enabled for the site. */
  module?: ModuleName;
}

/**
 * Authenticate user, check permission, and return tenant context.
 *
 * @param permission — RBAC permission string (optional for read-only routes)
 * @param route      — route name for logging (e.g. "POST /api/actions")
 * @param options    — optional site/module validation
 */
export async function apiGuard(
  permission?: Permission | null,
  route?: string,
  options?: GuardOptions,
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

    // Site access validation (Phase 1)
    if (options?.siteId) {
      if (!ctx.siteIds.includes(options.siteId)) {
        logger.warn("Site access denied", {
          route,
          userId: ctx.userId,
          role: ctx.role,
          requestedSiteId: options.siteId,
          accessibleSites: ctx.siteIds,
        });
        return {
          error: new Response(
            JSON.stringify({ error: "Access denied: you do not have access to this site" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
          ctx: null,
          supabase: null,
        };
      }
    }

    // Module gate (Phase 1)
    if (options?.module) {
      const targetSiteId = options.siteId ?? ctx.siteId;
      const { requireModule } = await import("@/lib/modules");
      try {
        await requireModule(targetSiteId, options.module);
      } catch (err) {
        const errResponse = moduleErrorResponse(err);
        if (errResponse) {
          return { error: errResponse, ctx: null, supabase: null };
        }
        throw err;
      }
    }

    const supabase = createServerClient();
    return { error: null, ctx, supabase };
  } catch (err) {
    logger.error("Auth guard failed", { route, err });
    return { error: authErrorResponse(err), ctx: null, supabase: null };
  }
}
