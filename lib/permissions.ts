/**
 * Permissions — Phase 1 Multi-Tenant Foundation
 *
 * Extended permission system that maps roles to fine-grained permissions.
 * Built on top of the existing RBAC in lib/rbac/roles.ts.
 *
 * This file adds the new multi-tenant permissions (manage_platform,
 * manage_tenant, manage_sites) and re-exports the combined set.
 *
 * Usage:
 *   import { PERMISSIONS, hasPermission } from "@/lib/permissions";
 *   if (hasPermission(["gm"], "manage_daily_ops")) { ... }
 */

// Re-export existing RBAC for backward compatibility
export {
  PERMISSIONS as LEGACY_PERMISSIONS,
  hasPermission as legacyHasPermission,
  type Permission as LegacyPermission,
} from "@/lib/rbac/roles";

import type { UserRole } from "@/lib/ontology/entities";

// ── Permission constants ───────────────────────────────────────────────────────

export const PERMISSIONS = {
  // Platform administration
  MANAGE_PLATFORM:              "manage_platform",
  MANAGE_TENANT:                "manage_tenant",
  MANAGE_SITES:                 "manage_sites",
  MANAGE_USERS:                 "manage_users",

  // Dashboard access
  VIEW_HEAD_OFFICE_DASHBOARD:   "view_head_office_dashboard",
  VIEW_SITE_DASHBOARD:          "view_site_dashboard",
  VIEW_ALL_STORES:              "view_all_stores",
  VIEW_OWN_STORE:               "view_own_store",
  VIEW_REGION_STORES:           "view_region_stores",
  VIEW_FINANCIALS:              "view_financials",
  VIEW_AUDIT_LOG:               "view_audit_log",
  VIEW_RAW_INGESTION:           "view_raw_ingestion",

  // Module-level operations
  MANAGE_COMPLIANCE:            "manage_compliance",
  MANAGE_MAINTENANCE:           "manage_maintenance",
  MANAGE_DAILY_OPS:             "manage_daily_ops",
  MANAGE_LABOUR:                "manage_labour",
  MANAGE_INVENTORY:             "manage_inventory",
  MANAGE_BOOKINGS:              "manage_bookings",
  MANAGE_REVIEWS:               "manage_reviews",
  MANAGE_FORECAST:              "manage_forecast",

  // Existing fine-grained permissions (kept for backward compat)
  CREATE_ACTION:                "create_action",
  ASSIGN_ACTION:                "assign_action",
  COMPLETE_ACTION:              "complete_action",
  ESCALATE_ACTION:              "escalate_action",
  REOPEN_ACTION:                "reopen_action",
  RESOLVE_ACTIONS:              "resolve_actions",

  CREATE_MAINTENANCE:           "create_maintenance",
  UPDATE_MAINTENANCE:           "update_maintenance",
  CLOSE_MAINTENANCE:            "close_maintenance",
  VIEW_CONTRACTOR_TICKETS:      "view_contractor_tickets",

  UPLOAD_COMPLIANCE:            "upload_compliance",
  EDIT_COMPLIANCE_ITEM:         "edit_compliance_item",
  VIEW_COMPLIANCE:              "view_compliance",

  MANAGE_ROLES:                 "manage_roles",
  MANAGE_STORE_SETTINGS:        "manage_store_settings",
  MANAGE_ORG_SETTINGS:          "manage_org_settings",
  MANAGE_INTEGRATIONS:          "manage_integrations",
  RUN_INTEGRATION_SYNC:         "run_integration_sync",
  TRIGGER_SYNC:                 "trigger_sync",
  SYNC_INVENTORY:               "sync_inventory",
  RESPOND_TO_REVIEWS:           "respond_to_reviews",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ── Extended role type ─────────────────────────────────────────────────────────
// Superset of existing UserRole + future platform roles.
// Existing codebase uses UserRole from ontology/entities.ts — this stays compatible.

export type ExtendedRole = UserRole | "platform_super_admin" | "tenant_owner" | "site_manager" | "staff";

// ── Role → Permission mapping ──────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  // Platform-level: full access to everything
  super_admin: Object.values(PERMISSIONS),
  platform_super_admin: Object.values(PERMISSIONS),

  // Tenant owner: full access within their organisation
  tenant_owner: [
    PERMISSIONS.MANAGE_TENANT,
    PERMISSIONS.MANAGE_SITES,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.VIEW_HEAD_OFFICE_DASHBOARD,
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_ALL_STORES,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.MANAGE_COMPLIANCE,
    PERMISSIONS.MANAGE_MAINTENANCE,
    PERMISSIONS.MANAGE_DAILY_OPS,
    PERMISSIONS.MANAGE_LABOUR,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.MANAGE_REVIEWS,
    PERMISSIONS.MANAGE_FORECAST,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.ASSIGN_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.ESCALATE_ACTION,
    PERMISSIONS.REOPEN_ACTION,
    PERMISSIONS.RESOLVE_ACTIONS,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.CLOSE_MAINTENANCE,
    PERMISSIONS.VIEW_CONTRACTOR_TICKETS,
    PERMISSIONS.UPLOAD_COMPLIANCE,
    PERMISSIONS.EDIT_COMPLIANCE_ITEM,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.MANAGE_STORE_SETTINGS,
    PERMISSIONS.MANAGE_ORG_SETTINGS,
    PERMISSIONS.MANAGE_INTEGRATIONS,
    PERMISSIONS.RUN_INTEGRATION_SYNC,
    PERMISSIONS.TRIGGER_SYNC,
    PERMISSIONS.SYNC_INVENTORY,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  executive: [
    PERMISSIONS.VIEW_HEAD_OFFICE_DASHBOARD,
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_ALL_STORES,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.VIEW_CONTRACTOR_TICKETS,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  head_office: [
    PERMISSIONS.VIEW_HEAD_OFFICE_DASHBOARD,
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_ALL_STORES,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.MANAGE_COMPLIANCE,
    PERMISSIONS.MANAGE_MAINTENANCE,
    PERMISSIONS.MANAGE_DAILY_OPS,
    PERMISSIONS.MANAGE_LABOUR,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.MANAGE_REVIEWS,
    PERMISSIONS.MANAGE_FORECAST,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.VIEW_CONTRACTOR_TICKETS,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.ASSIGN_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.ESCALATE_ACTION,
    PERMISSIONS.REOPEN_ACTION,
    PERMISSIONS.RESOLVE_ACTIONS,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.CLOSE_MAINTENANCE,
    PERMISSIONS.UPLOAD_COMPLIANCE,
    PERMISSIONS.EDIT_COMPLIANCE_ITEM,
    PERMISSIONS.MANAGE_STORE_SETTINGS,
    PERMISSIONS.MANAGE_INTEGRATIONS,
    PERMISSIONS.RUN_INTEGRATION_SYNC,
    PERMISSIONS.TRIGGER_SYNC,
    PERMISSIONS.SYNC_INVENTORY,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  auditor: [
    PERMISSIONS.VIEW_HEAD_OFFICE_DASHBOARD,
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_ALL_STORES,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.VIEW_RAW_INGESTION,
    PERMISSIONS.VIEW_CONTRACTOR_TICKETS,
  ],

  area_manager: [
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_REGION_STORES,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.MANAGE_COMPLIANCE,
    PERMISSIONS.MANAGE_MAINTENANCE,
    PERMISSIONS.MANAGE_DAILY_OPS,
    PERMISSIONS.MANAGE_LABOUR,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.MANAGE_REVIEWS,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.ASSIGN_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.ESCALATE_ACTION,
    PERMISSIONS.REOPEN_ACTION,
    PERMISSIONS.RESOLVE_ACTIONS,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.CLOSE_MAINTENANCE,
    PERMISSIONS.UPLOAD_COMPLIANCE,
    PERMISSIONS.EDIT_COMPLIANCE_ITEM,
    PERMISSIONS.MANAGE_STORE_SETTINGS,
    PERMISSIONS.RUN_INTEGRATION_SYNC,
    PERMISSIONS.TRIGGER_SYNC,
    PERMISSIONS.SYNC_INVENTORY,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  // General Manager — full own-store access
  gm: [
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_OWN_STORE,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.MANAGE_COMPLIANCE,
    PERMISSIONS.MANAGE_MAINTENANCE,
    PERMISSIONS.MANAGE_DAILY_OPS,
    PERMISSIONS.MANAGE_LABOUR,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.MANAGE_REVIEWS,
    PERMISSIONS.MANAGE_FORECAST,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.ASSIGN_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.ESCALATE_ACTION,
    PERMISSIONS.REOPEN_ACTION,
    PERMISSIONS.RESOLVE_ACTIONS,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.CLOSE_MAINTENANCE,
    PERMISSIONS.UPLOAD_COMPLIANCE,
    PERMISSIONS.RUN_INTEGRATION_SYNC,
    PERMISSIONS.TRIGGER_SYNC,
    PERMISSIONS.SYNC_INVENTORY,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  // Site Manager — alias for GM in new role model
  site_manager: [
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_OWN_STORE,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.MANAGE_DAILY_OPS,
    PERMISSIONS.MANAGE_MAINTENANCE,
    PERMISSIONS.MANAGE_COMPLIANCE,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.CLOSE_MAINTENANCE,
    PERMISSIONS.UPLOAD_COMPLIANCE,
    PERMISSIONS.RESPOND_TO_REVIEWS,
  ],

  supervisor: [
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_OWN_STORE,
    PERMISSIONS.MANAGE_DAILY_OPS,
    PERMISSIONS.VIEW_COMPLIANCE,
    PERMISSIONS.CREATE_ACTION,
    PERMISSIONS.COMPLETE_ACTION,
    PERMISSIONS.CREATE_MAINTENANCE,
    PERMISSIONS.UPDATE_MAINTENANCE,
    PERMISSIONS.UPLOAD_COMPLIANCE,
  ],

  // Staff — minimal read + task completion
  staff: [
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_OWN_STORE,
    PERMISSIONS.COMPLETE_ACTION,
  ],

  contractor: [
    PERMISSIONS.VIEW_CONTRACTOR_TICKETS,
    PERMISSIONS.UPDATE_MAINTENANCE,
  ],

  viewer: [
    PERMISSIONS.VIEW_SITE_DASHBOARD,
    PERMISSIONS.VIEW_OWN_STORE,
    PERMISSIONS.VIEW_COMPLIANCE,
  ],
} as const;

// ── Permission helpers ─────────────────────────────────────────────────────────

/**
 * Check if a role (or set of roles) has a given permission.
 * Accepts a single role string or an array of roles.
 */
export function hasPermission(
  roles: string | string[],
  permission: Permission,
): boolean {
  const roleList = Array.isArray(roles) ? roles : [roles];
  return roleList.some((role) => {
    const perms = ROLE_PERMISSIONS[role];
    return perms?.includes(permission) ?? false;
  });
}

/**
 * Check if a role has ANY of the given permissions (OR logic).
 */
export function hasAnyPermission(
  roles: string | string[],
  permissions: Permission[],
): boolean {
  return permissions.some((p) => hasPermission(roles, p));
}

/**
 * Check if a role has ALL of the given permissions (AND logic).
 */
export function hasAllPermissions(
  roles: string | string[],
  permissions: Permission[],
): boolean {
  return permissions.every((p) => hasPermission(roles, p));
}
