/**
 * lib/integrations/status.ts
 *
 * Central integration health model — the single source of truth for whether
 * any third-party integration is usable and supplying live data.
 *
 * DESIGN RULE: fail closed.
 * If status is unknown, auth_failed, degraded, or not_configured:
 *   → treat as NOT CONNECTED
 *   → set isLiveDataAvailable = false
 *   → never surface live-data badges or claims
 *
 * Usage:
 *   1. Server component calls deriveMicrosIntegrationStatus(ms, cfgConfigured, cfgEnabled)
 *   2. Result is passed as a plain prop to all child components
 *   3. Components call canUseMicrosLiveData(status) before rendering any live label
 */

import type { MicrosStatusSummary } from "@/types/micros";

// ── Types ─────────────────────────────────────────────────────────────────

export type IntegrationHealth =
  | "connected"       // Verified — live data available and fresh
  | "degraded"        // Auth succeeded but last sync is stale (> 4 h)
  | "not_configured"  // Required server env vars are missing
  | "auth_failed"     // Config present but connection.status = "error"
  | "awaiting_setup"  // First-time: no connection row or status awaiting_setup
  | "disabled"        // MICROS_ENABLED = false
  | "syncing";        // Status = syncing (in progress)

export interface MicrosIntegrationStatus {
  health:               IntegrationHealth;
  /** Short label for UI chips/badges — e.g. "Connected", "Auth failed" */
  label:                string;
  /** TRUE only when auth is verified AND last sync is fresh (< 4 h) */
  isLiveDataAvailable:  boolean;
  lastSuccessfulSyncAt: string | null;
  /** Machine-readable reason — for the "Technical details" drawer */
  reasonCode:           string | null;
  /** Plain-English message for the primary status/error panel */
  userMessage:          string;
}

// ── Constants ─────────────────────────────────────────────────────────────

/** Sync older than this is "degraded" — live data is no longer trusted. */
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1_000; // 4 hours

// ── Sanitizer ─────────────────────────────────────────────────────────────

/**
 * Strips legacy / credential-revealing text from any MICROS error string
 * before it is shown in the UI or persisted to the DB.
 *
 * Safe to call on any raw string coming from the DB, env validator, or
 * error catch blocks.  Idempotent — calling it twice on clean text is safe.
 */
export function sanitizeMicrosError(raw: string | null | undefined): string {
  if (!raw) return "Authentication failed. Please run a connection test.";

  const REDACTIONS: Array<[RegExp, string]> = [
    // Env-var name fragments — must never be shown to users
    [/MICROS_CLIENT_SECRET\s*(environment variable)?\s*(is not set\.?)?/gi, ""],
    [/MICROS_API_ACCOUNT_PASSWORD\s*/gi,                                    ""],
    // Legacy "X attempts" phrasing
    [/Authentication failed after \d+ attempts\.?/gi,
      "Authentication failed. Please run a connection test."],
    // Old "Check X, Y, Z" guidance
    [/Check\s+MICROS_AUTH_SERVER[^.]*\./gi,                                ""],
    [/Check\s+MICROS_[A-Z_]+[^.]*\./gi,                                    ""],
    // Missing config error message from old validator
    [/MICROS is enabled but missing configuration:\s*[^.]+\./gi,
      "Setup is incomplete. Please review your server configuration."],
    // Redundant verb fragments left after redaction
    [/\s*is not set\.\s*/gi,   " "],
    [/\s*environment variable\s*/gi, " "],
  ];

  let clean = raw;
  for (const [pattern, replacement] of REDACTIONS) {
    clean = clean.replace(pattern, replacement);
  }

  // Collapse multiple spaces / leading-trailing whitespace
  clean = clean.replace(/\s{2,}/g, " ").trim();

  // If nothing meaningful remains, return canonical fallback
  if (!clean || clean === "." || clean.length < 8) {
    return "Authentication failed. Please run a connection test.";
  }

  return clean;
}

// ── Derivation ────────────────────────────────────────────────────────────

/**
 * Pure function — derives MICROS integration status from already-loaded data.
 *
 * Call this server-side and pass the result down to all components.
 * Do NOT let individual components evaluate their own "is MICROS live?" logic.
 *
 * @param ms            Result of getMicrosStatus() — null if unavailable
 * @param envConfigured Result of getMicrosConfigStatus().configured
 * @param envEnabled    Result of getMicrosConfigStatus().enabled
 */
export function deriveMicrosIntegrationStatus(
  ms:                    MicrosStatusSummary | null,
  envConfigured:         boolean,
  envEnabled:            boolean,
  authModeUnconfirmed = false,
): MicrosIntegrationStatus {

  // ① Feature flag off
  if (!envEnabled) {
    return {
      health:               "disabled",
      label:                "Disabled",
      isLiveDataAvailable:  false,
      lastSuccessfulSyncAt: null,
      reasonCode:           "disabled",
      userMessage:          "MICROS integration is disabled. Set MICROS_ENABLED=true to activate.",
    };
  }

  // ② Auth mode not confirmed -- fail closed before other checks
  if (authModeUnconfirmed) {
    return {
      health:               "awaiting_setup",
      label:                "Authentication mode not confirmed",
      isLiveDataAvailable:  false,
      lastSuccessfulSyncAt: null,
      reasonCode:           "AUTH_MODE_UNCONFIRMED",
      userMessage:          "Awaiting Oracle confirmation. Set MICROS_AUTH_MODE=pkce or MICROS_AUTH_MODE=password to proceed.",
    };
  }

  // ③ Required env vars missing
  if (!envConfigured) {
    return {
      health:               "not_configured",
      label:                "Setup incomplete",
      isLiveDataAvailable:  false,
      lastSuccessfulSyncAt: null,
      reasonCode:           "missing_env_vars",
      userMessage:          "Setup incomplete — some required server configuration is missing. Contact your system administrator.",
    };
  }

  // ③ No connection row in DB yet
  if (!ms?.connection) {
    return {
      health:               "awaiting_setup",
      label:                "Awaiting setup",
      isLiveDataAvailable:  false,
      lastSuccessfulSyncAt: null,
      reasonCode:           "no_connection_row",
      userMessage:          "Integration has not been activated yet. Run a connection test to begin.",
    };
  }

  const conn        = ms.connection;
  const lastSuccess = conn.last_successful_sync_at ?? null;

  // ④ Last sync errored — sanitise message (strip deprecated env var references)
  if (conn.status === "error" || conn.last_sync_error) {
    const safeMsg = sanitizeMicrosError(conn.last_sync_error);
    return {
      health:               "auth_failed",
      label:                "Auth failed",
      isLiveDataAvailable:  false,
      lastSuccessfulSyncAt: lastSuccess,
      reasonCode:           "auth_error",
      userMessage:          safeMsg,
    };
  }

  // ⑤ Currently syncing
  if (conn.status === "syncing") {
    return {
      health:               "syncing",
      label:                "Sync in progress",
      isLiveDataAvailable:  false,
      lastSuccessfulSyncAt: lastSuccess,
      reasonCode:           null,
      userMessage:          "Sync in progress — live data will be available shortly.",
    };
  }

  // ⑥ Connected — verify freshness
  if (conn.status === "connected") {
    if (!lastSuccess) {
      return {
        health:               "degraded",
        label:                "Connected",
        isLiveDataAvailable:  false,
        lastSuccessfulSyncAt: null,
        reasonCode:           "no_successful_sync",
        userMessage:          "Connection established but no successful sync has completed yet.",
      };
    }
    const msSinceSync = Date.now() - new Date(lastSuccess).getTime();
    if (msSinceSync > STALE_THRESHOLD_MS) {
      const h = Math.floor(msSinceSync / 3_600_000);
      return {
        health:               "degraded",
        label:                "Stale",
        isLiveDataAvailable:  false,
        lastSuccessfulSyncAt: lastSuccess,
        reasonCode:           "stale_sync",
        userMessage:          `Live sync is stale — last successful sync was ${h}h ago. Data shown may not reflect current POS activity.`,
      };
    }
    return {
      health:               "connected",
      label:                "Connected",
      isLiveDataAvailable:  true,
      lastSuccessfulSyncAt: lastSuccess,
      reasonCode:           null,
      userMessage:          "MICROS POS integration is active and supplying live data.",
    };
  }

  // ⑦ Default: awaiting_setup DB status
  return {
    health:               "awaiting_setup",
    label:                "Awaiting setup",
    isLiveDataAvailable:  false,
    lastSuccessfulSyncAt: lastSuccess,
    reasonCode:           "awaiting_setup",
    userMessage:          "Integration saved. Run a connection test to verify authentication.",
  };
}

/**
 * Returns true only when MICROS is fully verified and supplying fresh live data.
 *
 * Use this as the single guard for every "show MICROS live" decision.
 * Fails closed: any non-connected state returns false.
 *
 * @example
 *   microsSource={canUseMicrosLiveData(microsHealth) ? "micros_live" : null}
 */
export function canUseMicrosLiveData(status: MicrosIntegrationStatus): boolean {
  return status.isLiveDataAvailable;
}
