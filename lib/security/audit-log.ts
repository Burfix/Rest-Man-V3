/**
 * lib/security/audit-log.ts
 *
 * Enterprise audit logging for ForgeStack Africa.
 *
 * Writes to the `security_audit_logs` table (migration 084).
 * Uses the service-role client — never the user-scoped client — because
 * audit writes must succeed regardless of the user's RLS scope.
 *
 * CRITICAL: This module must NEVER throw.  All failures are caught and
 * logged to console.error only.  Audit logging must not crash the main request.
 *
 * Usage:
 *   import { logTenantViolation, logMicrosSync } from "@/lib/security/audit-log";
 *
 *   // In an API route after detecting cross-tenant access attempt:
 *   await logTenantViolation({ userId, role, route, requestedSiteId, ownedSiteId });
 *
 *   // Before/after MICROS sync:
 *   await logMicrosSync("started",  { siteId, microsLocationRef });
 *   await logMicrosSync("completed", { siteId, microsLocationRef, recordsSynced });
 *   await logMicrosSync("failed",   { siteId, microsLocationRef, error });
 */

import { getServiceRoleClient } from "@/lib/supabase/service-role-client";

// ── Action constants ─────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = {
  ACCESS_ALLOWED:       "access_allowed",
  ACCESS_DENIED:        "access_denied",
  TENANT_VIOLATION:     "tenant_violation",        // cross-tenant IDOR attempt
  MISSING_TENANT_SCOPE: "missing_tenant_scope",    // siteId missing from request
  MICROS_SYNC_STARTED:  "micros_sync_started",
  MICROS_SYNC_COMPLETED:"micros_sync_completed",
  MICROS_SYNC_FAILED:   "micros_sync_failed",
  MANUAL_SYNC_REQUEST:  "manual_sync_request",
  DANGEROUS_ROUTE:      "dangerous_route_access",
  PERMISSION_DENIED:    "permission_denied",
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

// ── Shared payload shape ──────────────────────────────────────────────────────

interface BaseAuditPayload {
  userId?:               string | null;
  userRole?:             string | null;
  route?:                string | null;
  ipAddress?:            string | null;
  userAgent?:            string | null;
  targetSiteId?:         string | null;
  targetOrganisationId?: string | null;
  metadata?:             Record<string, unknown>;
}

// ── Core writer (never throws) ────────────────────────────────────────────────

async function writeAuditLog(
  action: AuditAction,
  status: "allowed" | "denied" | "started" | "completed" | "failed",
  payload: BaseAuditPayload & { deniedReason?: string },
): Promise<void> {
  try {
    const db = getServiceRoleClient() as any;
    await db.from("security_audit_logs").insert({
      action,
      status,
      user_id:                payload.userId           ?? null,
      user_role:              payload.userRole          ?? null,
      route:                  payload.route             ?? null,
      ip_address:             payload.ipAddress         ?? null,
      user_agent:             payload.userAgent         ?? null,
      target_site_id:         payload.targetSiteId      ?? null,
      target_organisation_id: payload.targetOrganisationId ?? null,
      denied_reason:          payload.deniedReason      ?? null,
      metadata:               payload.metadata          ?? {},
    });
  } catch (err) {
    // Non-fatal — audit log failure must never crash the request
    console.error("[security-audit] Write failed (non-fatal):", err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Log a successfully authorised access.
 * Call this for high-value routes (head-office, exports, bulk operations).
 */
export async function logAccessAllowed(payload: {
  userId:    string;
  userRole:  string;
  route:     string;
  siteId?:   string | null;
  orgId?:    string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await writeAuditLog(AUDIT_ACTIONS.ACCESS_ALLOWED, "allowed", {
    userId:               payload.userId,
    userRole:             payload.userRole,
    route:                payload.route,
    targetSiteId:         payload.siteId,
    targetOrganisationId: payload.orgId,
    metadata:             payload.metadata,
  });
}

/**
 * Log a denied access attempt (wrong role, wrong site, insufficient permission).
 */
export async function logAccessDenied(payload: {
  userId?:      string | null;
  userRole?:    string | null;
  route:        string;
  reason:       string;
  siteId?:      string | null;
  orgId?:       string | null;
  ipAddress?:   string | null;
  userAgent?:   string | null;
  metadata?:    Record<string, unknown>;
}): Promise<void> {
  await writeAuditLog(AUDIT_ACTIONS.ACCESS_DENIED, "denied", {
    userId:               payload.userId,
    userRole:             payload.userRole,
    route:                payload.route,
    deniedReason:         payload.reason,
    targetSiteId:         payload.siteId,
    targetOrganisationId: payload.orgId,
    ipAddress:            payload.ipAddress,
    userAgent:            payload.userAgent,
    metadata:             payload.metadata,
  });
}

/**
 * Log a detected cross-tenant IDOR attempt.
 * These are the highest-priority security events.
 */
export async function logTenantViolation(payload: {
  userId:           string;
  userRole:         string;
  route:            string;
  requestedSiteId:  string;
  ownedSiteIds?:    string[];
  ipAddress?:       string | null;
  userAgent?:       string | null;
}): Promise<void> {
  await writeAuditLog(AUDIT_ACTIONS.TENANT_VIOLATION, "denied", {
    userId:       payload.userId,
    userRole:     payload.userRole,
    route:        payload.route,
    targetSiteId: payload.requestedSiteId,
    deniedReason: `User ${payload.userId} attempted to access site ${payload.requestedSiteId} — not in owned sites: [${(payload.ownedSiteIds ?? []).join(", ")}]`,
    ipAddress:    payload.ipAddress,
    userAgent:    payload.userAgent,
    metadata: {
      requested_site_id: payload.requestedSiteId,
      owned_site_ids:    payload.ownedSiteIds ?? [],
    },
  });
}

/**
 * Log MICROS sync lifecycle events (started / completed / failed).
 * Always includes siteId and microsLocationRef for traceability.
 */
export async function logMicrosSync(
  status: "started" | "completed" | "failed",
  payload: {
    siteId:            string;
    organisationId?:   string | null;
    microsLocationRef: string;
    businessDate?:     string;
    recordsSynced?:    number;
    error?:            string;
    triggeredBy?:      "cron" | "manual" | "api";
    userId?:           string | null;
    userRole?:         string | null;
  },
): Promise<void> {
  const action =
    status === "started"   ? AUDIT_ACTIONS.MICROS_SYNC_STARTED :
    status === "completed" ? AUDIT_ACTIONS.MICROS_SYNC_COMPLETED :
                             AUDIT_ACTIONS.MICROS_SYNC_FAILED;

  await writeAuditLog(action, status, {
    userId:               payload.userId,
    userRole:             payload.userRole,
    targetSiteId:         payload.siteId,
    targetOrganisationId: payload.organisationId,
    route:                `MICROS sync [${payload.microsLocationRef}]`,
    deniedReason:         status === "failed" ? payload.error : undefined,
    metadata: {
      site_id:              payload.siteId,
      micros_location_ref:  payload.microsLocationRef,
      business_date:        payload.businessDate,
      records_synced:       payload.recordsSynced,
      triggered_by:         payload.triggeredBy ?? "unknown",
      ...(status === "failed" ? { error: payload.error } : {}),
    },
  });
}

/**
 * Log a permission denial from apiGuard or a route handler.
 */
export async function logPermissionDenied(payload: {
  userId?:    string | null;
  userRole?:  string | null;
  route:      string;
  permission: string;
  siteId?:    string | null;
  ipAddress?: string | null;
}): Promise<void> {
  await writeAuditLog(AUDIT_ACTIONS.PERMISSION_DENIED, "denied", {
    userId:       payload.userId,
    userRole:     payload.userRole,
    route:        payload.route,
    targetSiteId: payload.siteId,
    deniedReason: `Missing permission: ${payload.permission}`,
    ipAddress:    payload.ipAddress,
    metadata:     { permission: payload.permission },
  });
}
