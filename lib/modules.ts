/**
 * Module System — Phase 1 Multi-Tenant Foundation
 *
 * Checks whether a module is enabled for a given site.
 * Uses tenant_modules table with org-wide and site-specific overrides.
 *
 * Resolution order:
 *   1. Site-specific row (if exists) → use its `enabled` value
 *   2. Org-wide row (site_id IS NULL) → use its `enabled` value
 *   3. No row at all → default to true (backward compat for existing pilots)
 *
 * Usage:
 *   const enabled = await hasModule(siteId, "inventory");
 *   await requireModule(siteId, "inventory"); // throws 403 if disabled
 */

import { createServerClient } from "@/lib/supabase/server";

export type ModuleName =
  | "daily_ops"
  | "maintenance"
  | "compliance"
  | "revenue"
  | "labour"
  | "inventory"
  | "bookings"
  | "reviews"
  | "head_office"
  | "forecast"
  | "accountability";

// Simple in-memory cache to avoid hitting DB on every request.
// Key: `${siteId}:${module}`, value: { enabled, ts }
const _cache = new Map<string, { enabled: boolean; ts: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Check if a module is enabled for a given site.
 *
 * @param siteId - The site UUID to check
 * @param module - The module name
 * @returns true if module is enabled (defaults to true if no config exists)
 */
export async function hasModule(
  siteId: string,
  module: ModuleName,
): Promise<boolean> {
  const cacheKey = `${siteId}:${module}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.enabled;
  }

  const supabase = createServerClient();

  // 1. Check for site-specific override
  // tenant_modules table is created in migration 058 — types not yet regenerated
  const { data: siteRow } = await (supabase as any)
    .from("tenant_modules")
    .select("enabled")
    .eq("site_id", siteId)
    .eq("module", module)
    .maybeSingle();

  if (siteRow) {
    const enabled = (siteRow as any).enabled as boolean;
    _cache.set(cacheKey, { enabled, ts: Date.now() });
    return enabled;
  }

  // 2. Look up the site's organisation, then check org-wide config
  const { data: site } = await supabase
    .from("sites")
    .select("organisation_id")
    .eq("id", siteId)
    .maybeSingle();

  if (site?.organisation_id) {
    const { data: orgRow } = await (supabase as any)
      .from("tenant_modules")
      .select("enabled")
      .eq("organisation_id", site.organisation_id)
      .is("site_id", null)
      .eq("module", module)
      .maybeSingle();

    if (orgRow) {
      const enabled = (orgRow as any).enabled as boolean;
      _cache.set(cacheKey, { enabled, ts: Date.now() });
      return enabled;
    }
  }

  // 3. No configuration → default to enabled (backward compat)
  _cache.set(cacheKey, { enabled: true, ts: Date.now() });
  return true;
}

/**
 * Throws a 403-style error if the module is disabled for the site.
 * Use in API routes before processing the request.
 */
export async function requireModule(
  siteId: string,
  module: ModuleName,
): Promise<void> {
  const enabled = await hasModule(siteId, module);
  if (!enabled) {
    throw new ModuleDisabledError(module, siteId);
  }
}

export class ModuleDisabledError extends Error {
  public readonly statusCode = 403;
  public readonly module: ModuleName;
  public readonly siteId: string;

  constructor(module: ModuleName, siteId: string) {
    super(`Module '${module}' is not enabled for this site`);
    this.name = "ModuleDisabledError";
    this.module = module;
    this.siteId = siteId;
  }
}

/** Convert ModuleDisabledError to a JSON Response. */
export function moduleErrorResponse(err: unknown): Response | null {
  if (err instanceof ModuleDisabledError) {
    return new Response(
      JSON.stringify({
        error: err.message,
        code: "MODULE_DISABLED",
        module: err.module,
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}

/**
 * Invalidate cache for a specific site+module or an entire site.
 * Call after updating tenant_modules rows.
 */
export function invalidateModuleCache(siteId: string, module?: ModuleName): void {
  if (module) {
    _cache.delete(`${siteId}:${module}`);
  } else {
    Array.from(_cache.keys()).forEach((key) => {
      if (key.startsWith(`${siteId}:`)) _cache.delete(key);
    });
  }
}
