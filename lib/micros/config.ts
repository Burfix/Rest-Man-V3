/**
 * lib/micros/config.ts
 *
 * Secure environment variable loader for Oracle MICROS BI integration.
 *
 * All values come from server-side env vars only.
 * NEVER import this in client components.
 *
 * Required env vars when MICROS_ENABLED=true:
 *   MICROS_AUTH_SERVER       Oracle OIDC provider base URL (no trailing slash)
 *   MICROS_BI_SERVER         MICROS BI application server base URL
 *   MICROS_CLIENT_ID         Registered OIDC client ID (public client — no secret)
 *   MICROS_USERNAME          BI API account username
 *   MICROS_PASSWORD          BI API account password (server-side only, never logged)
 *   MICROS_ORG_SHORT_NAME    Oracle org / tenant short name (e.g. "SCS")
 *   MICROS_LOCATION_REF      Location reference for the pilot store (e.g. "2000002")
 *
 * Optional:
 *   MICROS_ENABLED           "true" | "false"  (default: "false")
 *   MICROS_REDIRECT_URI      PKCE redirect URI (default: "apiaccount://callback")
 *
 * Backward-compat aliases still accepted (deprecated):
 *   MICROS_APP_SERVER        → MICROS_BI_SERVER
 *   MICROS_ORG_IDENTIFIER    → MICROS_ORG_SHORT_NAME
 *   MICROS_API_ACCOUNT_NAME  → MICROS_USERNAME
 *   MICROS_LOC_REF           → MICROS_LOCATION_REF
 */

export interface MicrosEnvConfig {
  /** Base URL of the Oracle Identity Cloud Service (no trailing slash) */
  authServer: string;
  /** Base URL of the MICROS BI app server (no trailing slash). Read from MICROS_BI_SERVER. */
  appServer: string;
  /** OAuth 2.0 client ID (public client — no secret for PKCE flow) */
  clientId: string;
  /** Oracle org / tenant short name used in x-app-key header. Read from MICROS_ORG_SHORT_NAME. */
  orgIdentifier: string;
  /** API account username. Read from MICROS_USERNAME. */
  apiAccountName: string;
  /** Location reference for the pilot store (passed as locRef query param). Read from MICROS_LOCATION_REF. */
  locRef: string;
  /** Feature flag — when false, sync routes are disabled */
  enabled: boolean;
}

/**
 * Variables that must be non-empty strings when MICROS is enabled.
 * Checks both new names and their backward-compat aliases.
 */
const REQUIRED_VARS = [
  "MICROS_AUTH_SERVER",
  "MICROS_CLIENT_ID",
] as const;

/** Additional vars checked with backward-compat alias fallback. */
const REQUIRED_VARS_WITH_ALIAS: Array<[primary: string, alias: string]> = [
  ["MICROS_BI_SERVER",       "MICROS_APP_SERVER"],
  ["MICROS_USERNAME",        "MICROS_API_ACCOUNT_NAME"],
  ["MICROS_PASSWORD",        "MICROS_API_ACCOUNT_PASSWORD"],
  ["MICROS_ORG_SHORT_NAME",  "MICROS_ORG_IDENTIFIER"],
  ["MICROS_LOCATION_REF",    "MICROS_LOC_REF"],
];

/**
 * Strips leading/trailing whitespace and stray CR/LF characters from a config
 * string.  Env values pasted into Vercel panels often carry invisible chars.
 */
function normalizeEnvValue(v: string): string {
  return v.replace(/[\r\n]/g, "").trim();
}

/**
 * Returns the current MICROS env config.
 * All string values are normalised (trimmed + CR/LF removed) so that a
 * client_id with invisible whitespace isn't silently mis-sent to Oracle.
 * Missing vars result in empty strings — check `enabled` first, or use
 * `assertMicrosConfigured()` when you need all vars to be present.
 */
export function getMicrosEnvConfig(): MicrosEnvConfig {
  return {
    authServer:    normalizeEnvValue(process.env.MICROS_AUTH_SERVER ?? "").replace(/\/$/, ""),
    appServer:     normalizeEnvValue(process.env.MICROS_BI_SERVER ?? process.env.MICROS_APP_SERVER ?? "").replace(/\/$/, ""),
    clientId:      normalizeEnvValue(process.env.MICROS_CLIENT_ID ?? ""),
    orgIdentifier: normalizeEnvValue(process.env.MICROS_ORG_SHORT_NAME ?? process.env.MICROS_ORG_IDENTIFIER ?? ""),
    apiAccountName: normalizeEnvValue(process.env.MICROS_USERNAME ?? process.env.MICROS_API_ACCOUNT_NAME ?? ""),
    locRef:        normalizeEnvValue(process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? ""),
    enabled:       isMicrosEnabled(),
  };
}

/**
 * Returns true only when MICROS_ENABLED=true (case-insensitive).
 * Safe to call anywhere — never throws.
 */
export function isMicrosEnabled(): boolean {
  return (process.env.MICROS_ENABLED ?? "false").toLowerCase() === "true";
}

/**
 * Returns a validated config object.
 * Throws a descriptive error if MICROS is enabled but any required var is missing.
 * If MICROS is disabled, returns the partial config (no throw).
 */
/** Returns missing var names (primary name shown, accepts alias as fallback). */
function getMissingVars(): string[] {
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    if (!(process.env[key] as string | undefined)?.trim()) missing.push(key);
  }

  for (const [primary, alias] of REQUIRED_VARS_WITH_ALIAS) {
    const hasValue =
      (process.env[primary] as string | undefined)?.trim() ||
      (process.env[alias]   as string | undefined)?.trim();
    if (!hasValue) missing.push(primary);
  }

  return missing;
}

export function getMicrosConfig(): MicrosEnvConfig {
  const cfg = getMicrosEnvConfig();

  if (!cfg.enabled) {
    return cfg;
  }

  const missing = getMissingVars();

  if (missing.length > 0) {
    throw new Error(
      `[MICROS] Missing required environment variables: ${missing.join(", ")}. ` +
      `Set them in your .env.local or Vercel project settings.`,
    );
  }

  return cfg;
}

/**
 * Validates required vars and throws if any are absent, regardless of
 * the MICROS_ENABLED flag.  Use this in auth + sync services.
 */
export function assertMicrosConfigured(): MicrosEnvConfig {
  const missing = getMissingVars();

  if (missing.length > 0) {
    throw new Error(
      `[MICROS] Integration is not fully configured. Missing: ${missing.join(", ")}`,
    );
  }

  return getMicrosEnvConfig();
}

/**
 * Returns a human-readable status string describing the current configuration.
 * Safe to show in non-sensitive logs or settings UI (never includes secret values).
 */
export function getMicrosConfigStatus(): {
  configured: boolean;
  enabled: boolean;
  missing: string[];
  message: string;
  authMode: string;
} {
  const enabled    = isMicrosEnabled();
  const missing    = getMissingVars();
  const configured = missing.length === 0;

  const rawMode   = (process.env.MICROS_AUTH_MODE ?? "").replace(/[\r\n]/g, "").trim().toLowerCase();
  const authMode  = rawMode === "password" ? rawMode : "unknown";

  let message: string;
  if (!enabled) {
    message = "MICROS integration is disabled (MICROS_ENABLED is not set to true).";
  } else if (!configured) {
    message = `MICROS is enabled but missing configuration: ${missing.join(", ")}.`;
  } else {
    message = "MICROS integration is fully configured.";
  }

  return { configured, enabled, missing, message, authMode };
}
