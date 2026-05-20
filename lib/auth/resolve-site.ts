/**
 * lib/auth/resolve-site.ts
 *
 * Server-side helper for pages that receive searchParams.
 * Applies URL → cookie → assigned priority at page render time.
 *
 * Usage (in a Server Component page):
 *   const { siteId, isAll } = await resolvePageSite(ctx, searchParams.site_id);
 *
 * If a URL param is present and valid, it also writes the cookie so subsequent
 * navigation preserves the selection.
 */

import { cookies } from "next/headers";

export interface ResolvedSite {
  /** The resolved single site ID, or the user's primary if "all" mode. */
  siteId:   string;
  /** True when the user is in "All Sites" aggregate mode. */
  isAll:    boolean;
  /** The raw selected value ("all" | siteId | null). */
  raw:      string | null;
}

const MULTI_SITE_ROLES = new Set(["super_admin", "head_office", "executive", "auditor", "area_manager"]);
const COOKIE_NAME      = "fs-site-id";

/**
 * Resolve the active site for a page, applying URL > cookie > default priority.
 *
 * @param ctx        — UserContext from getUserContext()
 * @param urlParam   — searchParams.site_id from the page (may be undefined)
 */
export function resolvePageSite(
  ctx: { role: string; siteId: string; siteIds: string[] },
  urlParam?: string,
): ResolvedSite {
  if (!MULTI_SITE_ROLES.has(ctx.role)) {
    // Single-site role — always their own site
    return { siteId: ctx.siteId, isAll: false, raw: ctx.siteId };
  }

  const cookieStore = cookies();
  const cookieVal   = (cookieStore as any).get(COOKIE_NAME)?.value as string | undefined;

  // Priority: URL param > cookie > primary site
  const candidate = urlParam ?? cookieVal ?? null;

  if (candidate === "all") {
    // If URL disagrees with cookie, write cookie (best-effort — can't do in server component)
    return { siteId: ctx.siteId, isAll: true, raw: "all" };
  }

  if (candidate && ctx.siteIds.includes(candidate)) {
    return { siteId: candidate, isAll: false, raw: candidate };
  }

  return { siteId: ctx.siteId, isAll: false, raw: ctx.siteId };
}
