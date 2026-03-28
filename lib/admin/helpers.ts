/**
 * Super Admin Helpers
 *
 * Centralised checks for super_admin access, bypassing all
 * organisation / site / role restrictions.
 */

import type { UserRole } from "@/lib/ontology/entities";

export const SUPER_ADMIN_EMAIL = "newburf@gmail.com";

/** True if the user holds the super_admin role or matches the root email. */
export function isSuperAdmin(user: { email?: string; role?: string }): boolean {
  return user.role === "super_admin" || user.email === SUPER_ADMIN_EMAIL;
}

export interface UserScope {
  allOrgs: boolean;
  allSites: boolean;
  unrestricted: boolean;
}

/** Returns the effective access scope for a user. */
export function getUserScope(user: { email?: string; role?: string }): UserScope {
  if (isSuperAdmin(user)) {
    return { allOrgs: true, allSites: true, unrestricted: true };
  }
  const orgWide = ["executive", "head_office", "auditor"].includes(user.role ?? "");
  return { allOrgs: false, allSites: orgWide, unrestricted: false };
}

/** Require super_admin — throw a 403-style error if not. */
export function requireSuperAdmin(user: { email?: string; role?: string }): void {
  if (!isSuperAdmin(user)) {
    throw new Error("This action requires super_admin privileges");
  }
}
