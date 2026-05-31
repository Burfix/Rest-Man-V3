/**
 * lib/monitoring/token-expiry.ts
 *
 * MICROS OAuth Token Expiry Monitoring.
 *
 * Reads token_expires_at from micros_connections (service-role only — column
 * is REVOKED from anon/authenticated per migration 110) and classifies each
 * connection's token health.
 *
 * Classification thresholds:
 *   OK       — expires in > 14 days
 *   WARNING  — expires in 7–14 days
 *   HIGH     — expires in 3–7 days
 *   CRITICAL — expires in < 3 days (or already expired)
 *   NO_DATA  — token_expires_at is NULL (expiry not tracked)
 *
 * NEVER logs or returns token values, client secrets, or passwords.
 */

import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { logger } from "@/lib/logger";
import {
  MicrosConnectionTokenRowSchema,
  safeParseRows,
} from "@/lib/db/row-schemas";

// ── Types ───────────────────────────────────────────────────────────────────

export type TokenExpiryStatus = "OK" | "WARNING" | "HIGH" | "CRITICAL" | "NO_DATA";

export interface TokenExpiryRecord {
  connectionId:     string;
  siteName:         string;
  locRef:           string;
  status:           TokenExpiryStatus;
  expiresAt:        string | null;   // ISO string, null if not tracked
  daysUntilExpiry:  number | null;   // null if not tracked
  hoursUntilExpiry: number | null;   // null if not tracked; negative = already expired
}

export interface TokenExpiryReport {
  asOf:        string;              // ISO timestamp of when this was computed
  overall:     TokenExpiryStatus;   // worst status across all connections
  connections: TokenExpiryRecord[];
  criticalCount: number;
  highCount:     number;
  warningCount:  number;
}

// ── Thresholds (in milliseconds) ────────────────────────────────────────────

const THRESHOLDS = {
  CRITICAL_MS: 3 * 24 * 60 * 60 * 1000,   //  3 days
  HIGH_MS:     7 * 24 * 60 * 60 * 1000,   //  7 days
  WARNING_MS: 14 * 24 * 60 * 60 * 1000,   // 14 days
} as const;

// ── Status priority (for worst-case rollup) ──────────────────────────────────

const STATUS_PRIORITY: Record<TokenExpiryStatus, number> = {
  OK:      0,
  NO_DATA: 1,
  WARNING: 2,
  HIGH:    3,
  CRITICAL: 4,
};

function worstStatus(a: TokenExpiryStatus, b: TokenExpiryStatus): TokenExpiryStatus {
  return STATUS_PRIORITY[a] >= STATUS_PRIORITY[b] ? a : b;
}

function classifyExpiry(expiresAt: Date | null): {
  status: TokenExpiryStatus;
  daysUntilExpiry: number | null;
  hoursUntilExpiry: number | null;
} {
  if (!expiresAt) {
    return { status: "NO_DATA", daysUntilExpiry: null, hoursUntilExpiry: null };
  }

  const nowMs     = Date.now();
  const expiryMs  = expiresAt.getTime();
  const remainMs  = expiryMs - nowMs;
  const daysLeft  = remainMs / (24 * 60 * 60 * 1000);
  const hoursLeft = remainMs / (60 * 60 * 1000);

  let status: TokenExpiryStatus;
  if (remainMs <= THRESHOLDS.CRITICAL_MS) {
    status = "CRITICAL"; // includes already-expired (negative)
  } else if (remainMs <= THRESHOLDS.HIGH_MS) {
    status = "HIGH";
  } else if (remainMs <= THRESHOLDS.WARNING_MS) {
    status = "WARNING";
  } else {
    status = "OK";
  }

  return {
    status,
    daysUntilExpiry:  Math.round(daysLeft * 10) / 10,
    hoursUntilExpiry: Math.round(hoursLeft * 10) / 10,
  };
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Returns token expiry status for all active MICROS connections.
 *
 * Uses service-role client — must only be called from server-side routes
 * (cron, admin endpoints). Never expose raw output to unauthenticated callers.
 */
export async function getTokenExpiryReport(): Promise<TokenExpiryReport> {
  const supabase = getServiceRoleClient();
  const now      = new Date();

  // Fetch only the columns needed for monitoring — no credential columns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("micros_connections")
    .select("id, loc_ref, token_expires_at, site_id, sites ( name )")
    .order("site_id");

  if (error) {
    logger.error("token-expiry: failed to fetch micros_connections", {
      error: error.message,
      code:  error.code,
    });
    throw new Error(`token-expiry: ${error.message}`);
  }

  // Validate rows against schema — invalid rows are skipped with a warning,
  // preserving uptime even if micros_connections schema drifts.
  const validRows = safeParseRows(
    (data ?? []) as unknown[],
    MicrosConnectionTokenRowSchema,
    "token-expiry",
  );

  const connections: TokenExpiryRecord[] = validRows.map((row) => {
    const expiresAt    = row.token_expires_at ? new Date(row.token_expires_at) : null;
    const classification = classifyExpiry(expiresAt);

    return {
      connectionId:     row.id,
      siteName:         row.sites?.name ?? "Unknown",
      locRef:           row.loc_ref,
      status:           classification.status,
      expiresAt:        expiresAt?.toISOString() ?? null,
      daysUntilExpiry:  classification.daysUntilExpiry,
      hoursUntilExpiry: classification.hoursUntilExpiry,
    };
  });

  // Aggregate worst status
  const overall: TokenExpiryStatus = connections.reduce<TokenExpiryStatus>(
    (worst, conn) => worstStatus(worst, conn.status),
    "OK"
  );

  const criticalCount = connections.filter((c) => c.status === "CRITICAL").length;
  const highCount     = connections.filter((c) => c.status === "HIGH").length;
  const warningCount  = connections.filter((c) => c.status === "WARNING").length;

  if (overall === "CRITICAL" || overall === "HIGH") {
    logger.warn("token-expiry: token expiry alert", {
      overall,
      criticalCount,
      highCount,
      connections: connections
        .filter((c) => c.status === "CRITICAL" || c.status === "HIGH")
        .map((c) => ({
          siteName:         c.siteName,
          status:           c.status,
          daysUntilExpiry:  c.daysUntilExpiry,
        })),
    });
  }

  return {
    asOf:        now.toISOString(),
    overall,
    connections,
    criticalCount,
    highCount,
    warningCount,
  };
}
