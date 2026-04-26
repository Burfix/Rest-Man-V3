/**
 * lib/admin/contractTypes.ts
 *
 * TypeScript interfaces for the dashboard contract-layer Postgres views
 * (migration 065_contract_layer_views.sql).
 *
 * RULE: Admin API routes must map FROM these types, not raw table rows.
 *       UI components receive the mapped response shapes defined in each route.
 *       These interfaces are the DB-side contract; the API routes own the
 *       client-side contract (response shape).
 */

// ── v_stores ──────────────────────────────────────────────────────────────────

/**
 * One row from v_stores.
 * Use for all admin store listings and counts.
 * Filter by org_id for tenant scoping.
 */
export interface VStore {
  id: string;
  name: string;
  store_code: string;
  address: string | null;
  city: string | null;
  timezone: string;
  is_active: boolean;
  org_id: string | null;
  org_name: string;
  org_slug: string | null;
  region_id: string | null;
  region_name: string | null;
  seating_capacity: number | null;
  target_avg_spend: number | null;
  target_labour_pct: number | null;
  target_margin_pct: number | null;
  created_at: string;
}

// ── v_users ───────────────────────────────────────────────────────────────────

/**
 * One row from v_users.
 * site_ids is a real uuid array — no string parsing.
 * Filter by org_id for tenant scoping.
 */
export interface VUser {
  user_id: string;
  email: string;
  full_name: string | null;
  /** profiles.status: 'active' | 'invited' | 'deactivated' */
  status: string;
  last_seen_at: string | null;
  joined_at: string | null;
  /** Most recently granted active role, or null if no active role. */
  primary_role: string | null;
  org_id: string | null;
  org_name: string;
  role_granted_at: string | null;
  role_is_active: boolean;
  /** Resolved from user_site_access as a proper uuid array, never null. */
  site_ids: string[];
}

// ── v_integrations ────────────────────────────────────────────────────────────

/**
 * One row from v_integrations.
 * micros_status is the resolved integration status (not raw micros_connections.status).
 * is_stale and sync_age_minutes are computed in SQL, not app code.
 */
export interface VIntegration {
  store_id: string;
  store_name: string;
  store_code: string;
  is_active: boolean;
  org_id: string | null;
  /** Resolved status: 'connected' | 'disconnected' | 'expired' | 'stale' | 'none' */
  micros_status: string;
  micros_org_id: string | null;
  micros_loc_id: string | null;
  last_sync_at: string | null;
  token_expires_at: string | null;
  /** Minutes since last sync, null if never synced. */
  sync_age_minutes: number | null;
  /** true when no sync in last 24 h or never synced. */
  is_stale: boolean;
}

// ── v_tenant_summary ──────────────────────────────────────────────────────────

/**
 * One row from v_tenant_summary — one row per organisation.
 * For super_admin: reduce across all rows.
 * For scoped users: filter WHERE org_id = ctx.orgId.
 *
 * This is the single source of truth for the overview dashboard counts.
 * total_stores, active_stores, total_users, connected_integrations,
 * stale_integrations MUST equal the counts returned by the stores/users/
 * integrations tabs. This inequality is what the verify-counts endpoint checks.
 */
export interface VTenantSummary {
  org_id: string;
  org_name: string;
  org_slug: string;
  org_is_active: boolean;
  total_stores: number;
  active_stores: number;
  total_users: number;
  active_today: number;
  connected_integrations: number;
  stale_integrations: number;
}

// ── v_site_health_summary ─────────────────────────────────────────────────────

/**
 * One row from v_site_health_summary.
 * health is classified in SQL using the same thresholds that were previously
 * scattered across data-health route and JS logic.
 */
export interface VSiteHealth {
  site_id: string;
  store_name: string;
  store_code: string;
  is_active: boolean;
  org_id: string | null;
  integration_status: string;
  last_sync_at: string | null;
  stale_minutes: number | null;
  last_sales_date: string | null;
  recent_errors: number;
  failed_runs: number;
  /** 'healthy' | 'warning' | 'critical' | 'unknown' */
  health: "healthy" | "warning" | "critical" | "unknown";
}

// ── API response types ────────────────────────────────────────────────────────
//
// These types describe the shapes returned to the frontend by the admin API
// routes. They are derived from the view interfaces above and are intentionally
// simpler — UI components should import these, not the raw view interfaces.

/** Aggregate tenant stats returned by GET /api/admin/overview */
export type TenantSummary = {
  total_stores: number;
  total_users: number;
  total_integrations: number;
  connected_integrations: number;
};

/** Store entry returned by GET /api/admin/stores */
export type StoreView = {
  id: string;
  name: string;
  user_count: number;
  integration_count: number;
  integration_status: string | null;
};

/** User entry returned by GET /api/admin/users */
export type UserView = {
  id: string;
  full_name: string;
  email: string;
  site_id: string;
  role_count: number;
};

/** Integration entry returned by GET /api/admin/integrations */
export type IntegrationView = {
  id: string;
  site_id: string;
  status: string;
  last_synced_at: string | null;
};

/** Uniform API envelope used by all admin list/summary routes */
export type AdminApiResponse<T> = {
  data: T;
  error: string | null;
};

// ── v_role_distribution (migration 066) ───────────────────────────────────────

/**
 * One row from v_role_distribution.
 * Active role member count per org, grouped by role.
 * overview route reads this instead of scanning user_roles in JS.
 */
export interface VRoleDistribution {
  org_id: string;
  role: string;
  member_count: number;
}

// ── v_audit_summary (migration 066) ───────────────────────────────────────────

/**
 * One row from v_audit_summary.
 * Total audit events per org (actor resolved through user_roles).
 * org_id is the null-sentinel UUID for events with no resolvable org.
 */
export interface VAuditSummary {
  org_id: string;
  audit_count: number;
}
