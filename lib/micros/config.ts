/**
 * lib/micros/config.ts
 *
 * Secure environment variable loader for Oracle MICROS BI integration.
 *
 * All values come from server-side env vars only.
 * NEVER import this in client components.
 *
 * Required env vars when MICROS_ENABLED=true:
 *   MICROS_AUTH_SERVER             Oracle OIDC provider base URL (no trailing slash)
 *   MICROS_APP_SERVER              MICROS BI application server base URL
 *   MICROS_CLIENT_ID               Registered OIDC client / app ID
 *   MICROS_ORG_IDENTIFIER          Oracle org / tenant identifier
 *   MICROS_API_ACCOUNT_NAME        BI API account username
 *   MICROS_API_ACCOUNT_PASSWORD    BI API account password  (never logged/exposed)
 *   MICROS_LOC_REF                 Location reference for the pilot store
 *
 * Optional:
 *   MICROS_CLIENT_SECRET      OIDC client secret — enables Basic Auth if set
 *   MICROS_ENABLED            "true" | "false"  (default: "false")
 *   MICROS_AUTH_TOKEN_PATH    Token endpoint path override
 *                             (default: /oidc-provider/v1/oauth2/token)
 *   MICROS_AUTH_SCOPE         OAuth scope (default: "openid")
 */

export interface MicrosEnvConfig {
  /** Base URL of the Oracle Identity Cloud Service (no trailing slash) */
  authServer: string;
  /** Base URL of the MICROS BI app server (no trailing slash) */
  appServer: string;
  /** OAuth 2.0 client ID */
  clientId: string;
  /**
   * OIDC client secret — optional. When set, used in Authorization: Basic
   * header. When absent, client_id is sent in the POST body (public client).
   * NEVER logged, NEVER sent to client.
   */
  clientSecret: string;
  /** Oracle org / tenant identifier used in OAuth scope + x-app-key header */
  orgIdentifier: string;
  /** API account name (Oracle MICROS API account, used as x-app-key) */
  apiAccountName: string;
  /** Location reference for the pilot store (passed as locRef query param) */
  locRef: string;
  /** Feature flag — when false, sync routes are disabled */
  enabled: boolean;
}

/**
 * Variables that must be non-empty strings when MICROS is enabled.
 * MICROS_CLIENT_SECRET is intentionally absent — it is optional (public client
 * mode is used when it is not set).
 * MICROS_API_ACCOUNT_PASSWORD is checked separately because it is a secret
 * that must never appear in variable name lists shown to the frontend.
 */
const REQUIRED_VARS = [
  "MICROS_AUTH_SERVER",
  "MICROS_APP_SERVER",
  "MICROS_CLIENT_ID",
  "MICROS_ORG_IDENTIFIER",
  "MICROS_API_ACCOUNT_NAME",
  "MICROS_LOC_REF",
] as const;

/**
 * Returns the current MICROS env config.
 * Missing vars result in empty strings — check `enabled` first, or use
 * `assertMicrosConfigured()` when you need all vars to be present.
 */
export function getMicrosEnvConfig(): MicrosEnvConfig {
  return {
    authServer:     (process.env.MICROS_AUTH_SERVER     ?? "").replace(/\/$/, ""),
    appServer:      (process.env.MICROS_APP_SERVER      ?? "").replace(/\/$/, ""),
    clientId:       process.env.MICROS_CLIENT_ID        ?? "",
    clientSecret:   process.env.MICROS_CLIENT_SECRET    ?? "",
    orgIdentifier:  process.env.MICROS_ORG_IDENTIFIER   ?? "",
    apiAccountName: process.env.MICROS_API_ACCOUNT_NAME ?? "",
    locRef:         process.env.MICROS_LOC_REF          ?? "",
    enabled:        isMicrosEnabled(),
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
export function getMicrosConfig(): MicrosEnvConfig {
  const cfg = getMicrosEnvConfig();

  if (!cfg.enabled) {
    return cfg;
  }

  const missing = REQUIRED_VARS.filter(
    (key) => !(process.env[key] as string | undefined)?.trim(),
  );

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
 *
 * Also checks MICROS_API_ACCOUNT_PASSWORD (treated as a secret — never
 * included in error messages by name when it may be echoed to the frontend).
 */
export function assertMicrosConfigured(): MicrosEnvConfig {
  const missing = REQUIRED_VARS.filter(
    (key) => !(process.env[key] as string | undefined)?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `[MICROS] Integration is not fully configured. Missing: ${missing.join(", ")}`,
    );
  }

  if (!process.env.MICROS_API_ACCOUNT_PASSWORD?.trim()) {
    throw new Error(
      "MICROS credentials incomplete — API account password required. " +
      "Set MICROS_API_ACCOUNT_PASSWORD in your environment variables.",
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
} {
  const enabled = isMicrosEnabled();
  const missing: string[] = REQUIRED_VARS.filter(
    (key) => !(process.env[key] as string | undefined)?.trim(),
  );

  // Check the API account password separately — it is a secret so we use a
  // generic placeholder name rather than the actual var name in UI-facing lists.
  const passwordMissing = !process.env.MICROS_API_ACCOUNT_PASSWORD?.trim();
  if (passwordMissing) missing.push("MICROS_API_ACCOUNT_PASSWORD");

  const configured = missing.length === 0;

  let message: string;
  if (!enabled) {
    message = "MICROS integration is disabled (MICROS_ENABLED is not set to true).";
  } else if (passwordMissing && missing.length === 1) {
    // Specific admin-safe message when ONLY the password is missing
    message = "MICROS credentials incomplete — API account password required.";
  } else if (!configured) {
    message = `MICROS is enabled but missing configuration: ${missing.join(", ")}.`;
  } else {
    message = "MICROS integration is fully configured.";
  }

  return { configured, enabled, missing, message };
}
