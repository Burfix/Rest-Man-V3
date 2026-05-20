/**
 * RBAC — Roles and Permission Definitions
 *
 * Single source of truth for what each role is allowed to do.
 * Used by:
 *   - API route guards (lib/rbac/guards.ts)
 *   - UI component visibility checks
 *   - Middleware (future: role-based redirects)
 */

import type { UserRole } from "@/lib/ontology/entities";

// ── Permission constants ───────────────────────────────────────────────────────

export const PERMISSIONS = {
  // Data visibility
  VIEW_ALL_STORES:          "view_all_stores",
  VIEW_OWN_STORE:           "view_own_store",
  VIEW_REGION_STORES:       "view_region_stores",
  VIEW_FINANCIALS:          "view_financials",
  VIEW_AUDIT_LOG:           "view_audit_log",
  VIEW_RAW_INGESTION:       "view_raw_ingestion",

  // Actions
  CREATE_ACTION:            "create_action",
  ASSIGN_ACTION:            "assign_action",
  COMPLETE_ACTION:          "complete_action",
  ESCALATE_ACTION:          "escalate_action",
  REOPEN_ACTION:            "reopen_action",

  // Maintenance
  CREATE_MAINTENANCE:       "create_maintenance",
  UPDATE_MAINTENANCE:       "update_maintenance",
  CLOSE_MAINTENANCE:        "close_maintenance",
  VIEW_CONTRACTOR_TICKETS:  "view_contractor_tickets",

  // Compliance
  UPLOAD_COMPLIANCE:        "upload_compliance",
  EDIT_COMPLIANCE_ITEM:     "edit_compliance_item",
  VIEW_COMPLIANCE:          "view_compliance",

  // Configuration
  MANAGE_USERS:             "manage_users",
  MANAGE_ROLES:             "manage_roles",
  MANAGE_STORE_SETTINGS:    "manage_store_settings",
  MANAGE_ORG_SETTINGS:      "manage_org_settings",
  MANAGE_INTEGRATIONS:      "manage_integrations",
  RUN_INTEGRATION_SYNC:     "run_integration_sync",

  // Inventory
  SYNC_INVENTORY:           "sync_inventory",

  // Reviews
  RESPOND_TO_REVIEWS:       "respond_to_reviews",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ── Role → Permission mapping ──────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: Object.values(PERMISSIONS) as Permission[],

  executive: [
    PERMISSIONS.VIEW_ALL_STORES,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.VIEW_CONTRACTOR_TICKETS,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  head_office: [
    PERMISSIONS.VIEW_ALL_STORES,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.VIEW_CONTRACTOR_TICKETS,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.ASSIGN_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.ESCALATE_ACTION,
    PERMISSIONS.REOPEN_ACTION,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.CLOSE_MAINTENANCE,
    PERMISSIONS.UPLOAD_COMPLIANCE,
    PERMISSIONS.EDIT_COMPLIANCE_ITEM,
    PERMISSIONS.MANAGE_STORE_SETTINGS,
    PERMISSIONS.MANAGE_INTEGRATIONS,
    PERMISSIONS.RUN_INTEGRATION_SYNC,
    PERMISSIONS.SYNC_INVENTORY,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  auditor: [
    PERMISSIONS.VIEW_ALL_STORES,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.VIEW_RAW_INGESTION,
    PERMISSIONS.VIEW_CONTRACTOR_TICKETS,
  ],

  area_manager: [
    PERMISSIONS.VIEW_REGION_STORES,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.ASSIGN_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.ESCALATE_ACTION,
    PERMISSIONS.REOPEN_ACTION,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.CLOSE_MAINTENANCE,
    PERMISSIONS.UPLOAD_COMPLIANCE,
    PERMISSIONS.EDIT_COMPLIANCE_ITEM,
    PERMISSIONS.MANAGE_STORE_SETTINGS,
    PERMISSIONS.RUN_INTEGRATION_SYNC,
    PERMISSIONS.SYNC_INVENTORY,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  gm: [
    PERMISSIONS.VIEW_OWN_STORE,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.ASSIGN_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.ESCALATE_ACTION,
    PERMISSIONS.REOPEN_ACTION,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.CLOSE_MAINTENANCE,
    PERMISSIONS.UPLOAD_COMPLIANCE,
    PERMISSIONS.RUN_INTEGRATION_SYNC,
    PERMISSIONS.SYNC_INVENTORY,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  supervisor: [
    PERMISSIONS.VIEW_OWN_STORE,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.UPLOAD_COMPLIANCE,
  ],

  contractor: [
    PERMISSIONS.VIEW_CONTRACTOR_TICKETS,
    PERMISSIONS.UPDATE_MAINTENANCE,
  ],

  viewer: [
    PERMISSIONS.VIEW_OWN_STORE,
    PERMISSIONS.VIEW_COMPLIANCE,
  ],
};

// ── Helper: check permission ───────────────────────────────────────────────────

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

// ── Role hierarchy (higher = more access) ────────────────────────────────────

const ROLE_RANK: Record<UserRole, number> = {
  super_admin:  100,
  executive:     80,
  head_office:   75,
  auditor:       70,
  area_manager:  60,
  gm:            40,
  supervisor:    20,
  contractor:    10,
  viewer:         5,
};

export function roleRank(role: UserRole): number {
  return ROLE_RANK[role] ?? 0;
}

export function isRoleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return roleRank(role) >= roleRank(minimum);
}

// ── UI visibility helpers ──────────────────────────────────────────────────────

/** Returns which dashboard surfaces a role can access */
export function accessibleSurfaces(role: UserRole): string[] {
  const surfaces: string[] = [];

  if (hasPermission(role, PERMISSIONS.VIEW_ALL_STORES))    surfaces.push("head_office");
  if (hasPermission(role, PERMISSIONS.VIEW_REGION_STORES)) surfaces.push("area_manager");
  if (hasPermission(role, PERMISSIONS.VIEW_OWN_STORE) ||
      hasPermission(role, PERMISSIONS.VIEW_REGION_STORES) ||
      hasPermission(role, PERMISSIONS.VIEW_ALL_STORES))    surfaces.push("gm_command_center");
  if (hasPermission(role, PERMISSIONS.VIEW_CONTRACTOR_TICKETS))
                                                           surfaces.push("contractor_portal");

  return surfaces;
}
