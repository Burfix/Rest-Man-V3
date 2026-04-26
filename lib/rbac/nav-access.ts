/**
 * Role-based navigation access control.
 *
 * Defines which dashboard routes each role can access.
 * Roles not listed here (super_admin, executive, head_office, auditor,
 * area_manager) have unrestricted access to all routes.
 *
 * Site-level route restrictions (siteAllowedRoutes) are applied only to
 * site-scoped roles (gm, supervisor, contractor, viewer). Org-level roles
 * (head_office, area_manager, executive, super_admin, auditor) bypass them
 * so that a head_office user assigned to a specific site still sees all
 * org-wide routes (e.g. /dashboard/head-office).
 */

import type { UserRole } from "@/lib/ontology/entities";

/**
 * Roles that bypass site-level route restrictions.
 * These users operate at the org level and must not be constrained by the
 * allowed_routes list of any individual site.
 */
const ORG_LEVEL_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  "super_admin",
  "executive",
  "head_office",
  "area_manager",
  "auditor",
]);

/**
 * Allowed dashboard route prefixes per restricted role.
 * "/dashboard" is treated as exact-match (Command Centre only).
 * All other entries use prefix matching.
 */
export const ROLE_ALLOWED_ROUTES: Partial<Record<UserRole, string[]>> = {
  gm: [
    "/dashboard",                   // Command Centre (exact)
    "/dashboard/forecast",          // GM Co-Pilot
    "/dashboard/daily-ops",         // Daily Operations Tracker
    "/dashboard/accountability",    // Accountability (own data only)
    "/dashboard/maintenance",       // Maintenance
    "/dashboard/compliance",        // Compliance
    "/dashboard/bookings",          // Bookings
    "/dashboard/labour",            // Labour
    "/dashboard/reviews",           // Reviews
    "/dashboard/access-restricted", // Access Restricted page itself
  ],
  supervisor: [
    "/dashboard",
    "/dashboard/daily-ops",
    "/dashboard/maintenance",
    "/dashboard/compliance",
    "/dashboard/bookings",
    "/dashboard/access-restricted",
  ],
  contractor: [
    "/dashboard/maintenance",
    "/dashboard/access-restricted",
  ],
  viewer: [
    "/dashboard",
    "/dashboard/compliance",
    "/dashboard/reviews",
    "/dashboard/access-restricted",
  ],
};

/** Check if a given pathname is allowed for the role (and optionally the site) */
export function isRouteAllowed(role: UserRole, pathname: string, siteAllowedRoutes?: string[] | null): boolean {
  const roleRoutes = ROLE_ALLOWED_ROUTES[role];

  // Unrestricted role: not in ROLE_ALLOWED_ROUTES, so all routes are accessible.
  // Site-level restrictions never apply to unrestricted roles.
  if (roleRoutes === undefined) return true;

  // Restricted role: check the role's explicit allow-list.
  const roleAllowed = roleRoutes.some((route) =>
    route === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === route || pathname.startsWith(route + "/")
  );

  if (!roleAllowed) return false;

  // Route is in the restricted role's allow-list.
  // Org-level roles bypass site restrictions; site-scoped roles respect them.
  if (ORG_LEVEL_ROLES.has(role)) return true;

  if (siteAllowedRoutes && siteAllowedRoutes.length > 0) {
    return siteAllowedRoutes.some((route) =>
      route === "/dashboard"
        ? pathname === "/dashboard"
        : pathname === route || pathname.startsWith(route + "/")
    );
  }

  return true;
}

/** Check if a nav item href should be visible for the role (and optionally the site) */
export function isNavItemAllowed(role: UserRole, href: string, siteAllowedRoutes?: string[] | null): boolean {
  const roleRoutes = ROLE_ALLOWED_ROUTES[role];

  // Unrestricted role: not in ROLE_ALLOWED_ROUTES, so all nav items are visible.
  // Site-level restrictions never apply to unrestricted roles.
  if (roleRoutes === undefined) return true;

  // Restricted role: check the role's explicit allow-list.
  const roleAllowed = roleRoutes.some((route) =>
    route === "/dashboard"
      ? href === "/dashboard"
      : href === route || href.startsWith(route + "/")
  );

  if (!roleAllowed) return false;

  // Route is in the restricted role's allow-list.
  // Org-level roles bypass site restrictions; site-scoped roles respect them.
  if (ORG_LEVEL_ROLES.has(role)) return true;

  if (siteAllowedRoutes && siteAllowedRoutes.length > 0) {
    return siteAllowedRoutes.some((route) =>
      route === "/dashboard"
        ? href === "/dashboard"
        : href === route || href.startsWith(route + "/")
    );
  }

  return true;
}
