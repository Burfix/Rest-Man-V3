/**
 * Context Helpers — Phase 1 Multi-Tenant Foundation
 *
 * Extends the existing getUserContext() with site-level context resolution.
 * Does NOT replace get-user-context.ts — builds on top of it.
 *
 * Usage:
 *   const user = await getUserContext();          // existing (unchanged)
 *   const site = await getSiteContext(siteId);    // new: fetch site + org
 *   const full = await getFullContext(siteId);    // new: user + site combined
 */

import { createServerClient } from "@/lib/supabase/server";

// Re-export existing context for convenience
export { getUserContext, AuthError, authErrorResponse } from "./get-user-context";
export type { UserContext } from "./get-user-context";

// ── Site context ───────────────────────────────────────────────────────────────

export interface SiteContext {
  siteId: string;
  siteName: string;
  storeCode: string;
  isActive: boolean;
  organisationId: string;
  organisationName: string;
  timezone: string;
  allowedRoutes: string[] | null;
}

/**
 * Fetch site + organisation context for a given site ID.
 * Throws if the site doesn't exist or is inactive.
 */
export async function getSiteContext(siteId: string): Promise<SiteContext> {
  if (!siteId) {
    throw new Error("siteId is required");
  }

  const supabase = createServerClient();

  const { data: site, error } = await supabase
    .from("sites")
    .select("id, name, store_code, is_active, organisation_id")
    .eq("id", siteId)
    .maybeSingle();

  if (error || !site) {
    throw new Error(`Site not found: ${siteId}`);
  }

  // Fetch org name separately to avoid Supabase type issues with joins
  let orgName = "Unknown";
  if (site.organisation_id) {
    const { data: org } = await supabase
      .from("organisations")
      .select("name")
      .eq("id", site.organisation_id)
      .maybeSingle();
    if (org) orgName = org.name as string;
  }

  const siteAny = site as Record<string, unknown>;

  return {
    siteId: site.id as string,
    siteName: site.name as string,
    storeCode: (site.store_code as string) ?? "",
    isActive: site.is_active as boolean,
    organisationId: site.organisation_id as string,
    organisationName: orgName,
    timezone: (siteAny.timezone as string) ?? "Africa/Johannesburg",
    allowedRoutes: (siteAny.allowed_routes as string[] | null) ?? null,
  };
}
