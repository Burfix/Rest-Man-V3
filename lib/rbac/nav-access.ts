/**
 * Role-based navigation access control.
 *
 * Defines which dashboard routes each role can access.
 * Roles not listed here (super_admin, executive, head_office, auditor,
 * area_manager) have unrestricted access to all routes.
 */

import type { UserRole } from "@/lib/ontology/entities";

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

/** Check if a given pathname is allowed for the role */
export function isRouteAllowed(role: UserRole, pathname: string): boolean {
  const allowed = ROLE_ALLOWED_ROUTES[role];
  if (!allowed) return true; // unrestricted role
  return allowed.some((route) =>
    route === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === route || pathname.startsWith(route + "/")
  );
}

/** Check if a nav item href should be visible for the role */
export function isNavItemAllowed(role: UserRole, href: string): boolean {
  const allowed = ROLE_ALLOWED_ROUTES[role];
  if (!allowed) return true; // unrestricted role
  return allowed.some((route) =>
    route === "/dashboard"
      ? href === "/dashboard"
      : href === route || href.startsWith(route + "/")
  );
}
