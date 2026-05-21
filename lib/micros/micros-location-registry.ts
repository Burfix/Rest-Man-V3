/**
 * lib/micros/micros-location-registry.ts
 *
 * Server-only multi-location MICROS config resolver.
 *
 * Maps location keys to their full integration config.
 * Credentials are read exclusively from server-side environment variables.
 *
 * SECURITY:
 *   - Never import this in client components or NEXT_PUBLIC code.
 *   - clientSecret and password are read from env vars and never logged.
 *
 * Supported locations:
 *   si-cantina            → PKCE auth (username + password), env: MICROS_*
 *   primi-camps-bay       → PKCE auth (username + password), env: MICROS_PRIMI_CAMPS_BAY_*
 *   sea-castle-camps-bay  → PKCE auth — shares Si Cantina credentials, own loc ref: env: MICROS_SEA_CASTLE_*
 */

export type LocationKey = "si-cantina" | "primi-camps-bay" | "sea-castle-camps-bay";

/**
 * Auth flow used by the location.
 *
 * pkce               — 4-step PKCE flow (username + password). Used by Si Cantina.
 * client_credentials — OAuth2 client credentials grant (clientId + clientSecret). Used by Primi.
 */
export type MicrosAuthFlow = "pkce" | "client_credentials";

export interface LocationConfig {
  /** Stable identifier used in API request bodies and DB rows. */
  key: LocationKey;
  /** Human-readable name for UI and logs. */
  displayName: string;
  /** Oracle Enterprise / Org short name — used in BIAPI URL path and x-app-key header. */
  enterpriseShortName: string;
  /** Oracle OIDC / IDM auth server base URL (no trailing slash). */
  authUrl: string;
  /** MICROS BI application server base URL (no trailing slash). */
  baseUrl: string;
  /** OAuth client ID. */
  clientId: string;
  /**
   * OAuth client secret. Only populated for client_credentials flow.
   * Null for PKCE locations (Si Cantina uses username+password instead).
   * NEVER log this value.
   */
  clientSecret: string | null;
  /**
   * API account username. Only populated for PKCE locations.
   * Null for client_credentials locations.
   */
  username: string | null;
  /**
   * API account password. Only populated for PKCE locations.
   * NEVER log this value.
   */
  password: string | null;
  /** MICROS location reference (locRef) for the store. */
  locationRef: string;
  /** Which OAuth flow to use when acquiring a token. */
  authFlow: MicrosAuthFlow;
  /** Feature flag — false means all sync routes should skip this location. */
  enabled: boolean;
  /**
   * True when all required env vars are present and non-empty.
   * Safe to surface in status APIs (no secret values exposed).
   */
  configured: boolean;
}

/**
 * Strips CR/LF and surrounding whitespace from an env var value.
 * Values pasted into Vercel panels often carry invisible characters.
 */
function n(v: string | undefined): string {
  return (v ?? "").replace(/[\r\n]/g, "").trim();
}

function buildSiCantinaConfig(): LocationConfig {
  const authUrl   = n(process.env.MICROS_AUTH_SERVER).replace(/\/$/, "");
  const baseUrl   = n(process.env.MICROS_BI_SERVER ?? process.env.MICROS_APP_SERVER).replace(/\/$/, "");
  const clientId  = n(process.env.MICROS_CLIENT_ID);
  const enterprise= n(process.env.MICROS_ORG_SHORT_NAME ?? process.env.MICROS_ORG_IDENTIFIER);
  const username  = n(process.env.MICROS_USERNAME ?? process.env.MICROS_API_ACCOUNT_NAME);
  const password  = n(process.env.MICROS_PASSWORD ?? process.env.MICROS_API_ACCOUNT_PASSWORD);
  const locRef    = n(process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF);
  const enabled   = n(process.env.MICROS_ENABLED).toLowerCase() === "true";

  const configured =
    !!authUrl && !!baseUrl && !!clientId && !!enterprise &&
    !!username && !!password && !!locRef;

  return {
    key:                "si-cantina",
    displayName:        "Si Cantina Sociale",
    enterpriseShortName: enterprise,
    authUrl,
    baseUrl,
    clientId,
    clientSecret:       null,      // PKCE flow — no client secret
    username,
    password,
    locationRef:        locRef,
    authFlow:           "pkce",
    enabled,
    configured,
  };
}

function buildPrimiCampsBayConfig(): LocationConfig {
  const authUrl   = n(process.env.MICROS_PRIMI_CAMPS_BAY_AUTH_URL).replace(/\/$/, "");
  const baseUrl   = n(process.env.MICROS_PRIMI_CAMPS_BAY_BASE_URL).replace(/\/$/, "");
  const clientId  = n(process.env.MICROS_PRIMI_CAMPS_BAY_CLIENT_ID);
  const enterprise= n(process.env.MICROS_PRIMI_CAMPS_BAY_ENTERPRISE);
  // USERNAME = API account name (e.g. PRI_THAMSANQA_BIAPI)
  const username  = n(process.env.MICROS_PRIMI_CAMPS_BAY_USERNAME);
  // PASSWORD = API account password — stored as CLIENT_SECRET in env for backward compat
  const password  = n(process.env.MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET);
  const locRef    = n(process.env.MICROS_PRIMI_CAMPS_BAY_LOCATION_REF);
  const enabled   = n(process.env.MICROS_PRIMI_CAMPS_BAY_ENABLED).toLowerCase() === "true";

  const configured =
    !!authUrl && !!baseUrl && !!clientId && !!enterprise &&
    !!username && !!password && !!locRef;

  return {
    key:                "primi-camps-bay",
    displayName:        "Primi Camps Bay",
    enterpriseShortName: enterprise,
    authUrl,
    baseUrl,
    clientId,
    clientSecret:       null,   // PKCE flow — no OAuth client secret
    username,
    password,                   // API account password — never log
    locationRef:        locRef,
    authFlow:           "pkce",
    enabled,
    configured,
  };
}

/**
 * Sea Castle Hotel Camps Bay
 *
 * Shares all Oracle MICROS auth credentials with Si Cantina (same enterprise,
 * same PKCE flow, same API account).  Only the location reference differs.
 *
 * Required env vars (shared — already set for Si Cantina):
 *   MICROS_AUTH_SERVER, MICROS_BI_SERVER, MICROS_CLIENT_ID,
 *   MICROS_USERNAME, MICROS_PASSWORD, MICROS_ORG_SHORT_NAME
 *
 * Sea-Castle-specific env vars:
 *   MICROS_SEA_CASTLE_ENABLED         "true" | "false"
 *   MICROS_SEA_CASTLE_LOCATION_REF    Oracle locRef for Sea Castle (e.g. "2001002")
 *
 * SECURITY: No secrets are duplicated.  Credential env vars are referenced
 * once (in buildSiCantinaConfig) and reused here by reading the same vars.
 */
function buildSeaCastleConfig(): LocationConfig {
  // ── Shared credentials (same as Si Cantina) ──────────────────────────────
  const authUrl   = n(process.env.MICROS_AUTH_SERVER).replace(/\/$/, "");
  const baseUrl   = n(process.env.MICROS_BI_SERVER ?? process.env.MICROS_APP_SERVER).replace(/\/$/, "");
  const clientId  = n(process.env.MICROS_CLIENT_ID);
  const enterprise= n(process.env.MICROS_ORG_SHORT_NAME ?? process.env.MICROS_ORG_IDENTIFIER);
  const username  = n(process.env.MICROS_USERNAME ?? process.env.MICROS_API_ACCOUNT_NAME);
  const password  = n(process.env.MICROS_PASSWORD ?? process.env.MICROS_API_ACCOUNT_PASSWORD);

  // ── Sea-Castle-specific ──────────────────────────────────────────────────
  const locRef    = n(process.env.MICROS_SEA_CASTLE_LOCATION_REF ?? "2001002");
  const enabled   = n(process.env.MICROS_SEA_CASTLE_ENABLED).toLowerCase() === "true";

  const configured =
    !!authUrl && !!baseUrl && !!clientId && !!enterprise &&
    !!username && !!password && !!locRef;

  return {
    key:                "sea-castle-camps-bay",
    displayName:        "Sea Castle Hotel Camps Bay",
    enterpriseShortName: enterprise,
    authUrl,
    baseUrl,
    clientId,
    clientSecret:       null,   // PKCE — no client secret
    username,
    password,
    locationRef:        locRef,
    authFlow:           "pkce",
    enabled,
    configured,
  };
}

/**
 * Returns the config for a specific location key.
 * Throws if the key is unknown.
 * Does NOT throw for unconfigured or disabled locations — callers must check
 * the `configured` and `enabled` fields before calling auth/sync functions.
 */
export function getLocationConfig(key: LocationKey): LocationConfig {
  switch (key) {
    case "si-cantina":           return buildSiCantinaConfig();
    case "primi-camps-bay":      return buildPrimiCampsBayConfig();
    case "sea-castle-camps-bay": return buildSeaCastleConfig();
    default: {
      const _exhaustive: never = key;
      throw new Error(`[MICROS] Unknown location key: ${_exhaustive}`);
    }
  }
}

/**
 * Returns configs for all known location keys.
 * Safe to iterate for health checks and admin dashboards.
 */
export function getAllLocationConfigs(): LocationConfig[] {
  return [buildSiCantinaConfig(), buildPrimiCampsBayConfig(), buildSeaCastleConfig()];
}

// ── Location-ref uniqueness validation ───────────────────────────────────

export interface LocationRefConflict {
  locationRef: string;
  keys: LocationKey[];
}

/**
 * Checks that no two ENABLED + CONFIGURED locations share the same
 * MICROS location reference.  Duplicate refs would cause data from
 * different stores to be written to the same DB rows.
 *
 * Call this at startup or in a health-check route to surface conflicts.
 *
 * Returns an array of conflicts (empty = all clear).
 *
 * WARNING if conflicts detected:
 *   "MICROS location ref conflict detected"
 */
export function validateLocationRefUniqueness(): LocationRefConflict[] {
  const configs = getAllLocationConfigs().filter((c) => c.configured && c.enabled && !!c.locationRef);
  const refMap  = new Map<string, LocationKey[]>();

  for (const c of configs) {
    const existing = refMap.get(c.locationRef) ?? [];
    existing.push(c.key);
    refMap.set(c.locationRef, existing);
  }

  return Array.from(refMap.entries())
    .filter(([, keys]) => keys.length > 1)
    .map(([locationRef, keys]) => ({ locationRef, keys }));
}

/**
 * Returns a safe (non-secret) summary of a location config for
 * logging, API responses, and admin UIs.
 * clientSecret and password are NEVER included.
 */
export function safeConfigSummary(cfg: LocationConfig) {
  return {
    key:                  cfg.key,
    displayName:          cfg.displayName,
    enterpriseShortName:  cfg.enterpriseShortName,
    authUrl:              cfg.authUrl,
    baseUrl:              cfg.baseUrl,
    clientId:             cfg.clientId,
    locationRef:          cfg.locationRef,
    authFlow:             cfg.authFlow,
    enabled:              cfg.enabled,
    configured:           cfg.configured,
    hasClientSecret:      cfg.clientSecret !== null && cfg.clientSecret.length > 0,
    hasPassword:          cfg.password !== null && cfg.password.length > 0,
    hasUsername:          cfg.username !== null && cfg.username.length > 0,
  };
}

/**
 * Validates that a string is a known LocationKey.
 * Use this to sanitize user-supplied locationKey query params.
 */
export function isValidLocationKey(key: string): key is LocationKey {
  return key === "si-cantina" || key === "primi-camps-bay" || key === "sea-castle-camps-bay";
}

/**
 * Finds the LocationConfig whose `enterpriseShortName` matches the given
 * Oracle org identifier (case-insensitive).
 *
 * Returns null when the org is not registered — callers should fall back
 * to the global token in that case and log a TOKEN_ORG_MISMATCH_RISK warning.
 *
 * Used by SimphonyClient and perConnectionPost() to resolve per-org
 * credentials from env vars when only `org_identifier` (from the DB
 * micros_connections row) is available.
 *
 * @example
 *   getLocationConfigByOrgIdentifier("PRI")  // → Primi config
 *   getLocationConfigByOrgIdentifier("SCS")  // → Si Cantina config
 *   getLocationConfigByOrgIdentifier("UNK")  // → null
 */
export function getLocationConfigByOrgIdentifier(
  orgIdentifier: string,
): LocationConfig | null {
  const norm = orgIdentifier.trim().toUpperCase();
  return (
    getAllLocationConfigs().find(
      (cfg) => cfg.enterpriseShortName.trim().toUpperCase() === norm,
    ) ?? null
  );
}
