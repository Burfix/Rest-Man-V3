/**
 * lib/micros/micros-location-registry.ts
 *
 * Server-only multi-location MICROS config resolver.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 * Non-secret metadata (location_key, display_name, auth_flow, env_prefix,
 * location_ref, enabled) is stored in the micros_location_configs DB table
 * (migration 101). Adding a new client requires a DB row + Vercel env vars —
 * no code change, no recompile, no deployment.
 *
 * Credentials (username, password, clientSecret) are NEVER stored in the DB.
 * They are read from environment variables using the location's env_prefix:
 *   username    = env[{prefix}USERNAME]       or env[{prefix}API_ACCOUNT_NAME]
 *   password    = env[{prefix}PASSWORD]       or env[{prefix}API_ACCOUNT_PASSWORD]
 *   clientSecret= env[{prefix}CLIENT_SECRET]  (client_credentials flow only)
 *   authUrl     = env[{prefix}AUTH_URL]       or env[{prefix}AUTH_SERVER]
 *   baseUrl     = env[{prefix}BI_SERVER]      or env[{prefix}APP_SERVER]
 *   clientId    = env[{prefix}CLIENT_ID]
 *   enterprise  = env[{prefix}ORG_SHORT_NAME] or env[{prefix}ORG_IDENTIFIER]
 *   locRef      = DB location_ref             or env[{prefix}LOCATION_REF]
 *
 * SECURITY:
 *   - Never import this in client components or NEXT_PUBLIC code.
 *   - clientSecret and password are never logged.
 *   - The DB table stores no secrets.
 *
 * Migration from typed union:
 *   LocationKey is now `string` (was a union of 3 literals). All functions
 *   that previously returned synchronously are now async (DB lookup).
 *   Call sites: `const cfg = await getLocationConfig(key)`.
 */

import { createClient } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Previously a union of 3 hardcoded literals. Now `string` — the valid values
 * live in micros_location_configs.location_key (DB).
 */
export type LocationKey = string;

/**
 * Auth flow used by the location.
 * pkce               — 4-step PKCE flow (username + password).
 * client_credentials — OAuth2 client credentials grant.
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
   * Null for PKCE locations. NEVER log this value.
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

export interface LocationRefConflict {
  locationRef: string;
  keys: LocationKey[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Strips CR/LF and surrounding whitespace from env var values. */
function n(v: string | undefined): string {
  return (v ?? "").replace(/[\r\n]/g, "").trim();
}

/** Service-role DB client — bypasses RLS for server-side registry reads. */
function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Builds a LocationConfig by combining a DB row (non-secret metadata)
 * with credentials from environment variables (via env_prefix).
 */
function buildConfigFromRow(row: {
  location_key:  string;
  display_name:  string;
  auth_flow:     string;
  env_prefix:    string;
  location_ref:  string | null;
  enabled:       boolean;
}): LocationConfig {
  const p = row.env_prefix; // e.g. "MICROS_" or "MICROS_PRIMI_CAMPS_BAY_"

  // ── Non-secret fields from env (shared for locations with same prefix) ─────
  const authUrl   = n(process.env[`${p}AUTH_URL`]       ?? process.env[`${p}AUTH_SERVER`]).replace(/\/$/, "");
  const baseUrl   = n(process.env[`${p}BI_SERVER`]      ?? process.env[`${p}APP_SERVER`]).replace(/\/$/, "");
  const clientId  = n(process.env[`${p}CLIENT_ID`]);
  const enterprise= n(process.env[`${p}ORG_SHORT_NAME`] ?? process.env[`${p}ORG_IDENTIFIER`]);

  // ── Credential fields from env (secret — never logged) ────────────────────
  const username     = n(process.env[`${p}USERNAME`]       ?? process.env[`${p}API_ACCOUNT_NAME`])     || null;
  // For PKCE locations, password may be stored under CLIENT_SECRET (legacy Vercel env naming for Primi).
  const password     = n(process.env[`${p}PASSWORD`]       ?? process.env[`${p}API_ACCOUNT_PASSWORD`] ?? process.env[`${p}CLIENT_SECRET`]) || null;
  const clientSecret = n(process.env[`${p}CLIENT_SECRET`]) || null;

  // ── Location ref: DB wins (allows multiple locations to share env_prefix) ──
  const locRef = row.location_ref
    ?? n(process.env[`${p}LOCATION_REF`] ?? process.env[`${p}LOC_REF`]);

  const authFlow = (row.auth_flow === "client_credentials" ? "client_credentials" : "pkce") as MicrosAuthFlow;

  const configured =
    !!authUrl && !!baseUrl && !!clientId && !!enterprise && !!locRef &&
    (authFlow === "pkce"
      ? !!username && !!password
      : !!clientSecret);

  return {
    key:                 row.location_key,
    displayName:         row.display_name,
    enterpriseShortName: enterprise,
    authUrl,
    baseUrl,
    clientId,
    clientSecret:        authFlow === "client_credentials" ? clientSecret : null,
    username:            authFlow === "pkce" ? username : null,
    password:            authFlow === "pkce" ? password : null,
    locationRef:         locRef,
    authFlow,
    enabled:             row.enabled,
    configured,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the config for a specific location key.
 * Throws if the key is not found in the DB registry.
 */
export async function getLocationConfig(key: LocationKey): Promise<LocationConfig> {
  const db = serviceDb();
  const { data, error } = await db
    .from("micros_location_configs")
    .select("location_key, display_name, auth_flow, env_prefix, location_ref, enabled")
    .eq("location_key", key)
    .maybeSingle();

  if (error) {
    throw new Error(`[MICROS] Registry DB error for key "${key}": ${error.message}`);
  }
  if (!data) {
    throw new Error(
      `[MICROS] Unknown location key: "${key}". ` +
      `Add a row to micros_location_configs to register this location.`,
    );
  }

  return buildConfigFromRow(data);
}

/**
 * Returns configs for all registered locations.
 * Safe to iterate for health checks and admin dashboards.
 */
export async function getAllLocationConfigs(): Promise<LocationConfig[]> {
  const db = serviceDb();
  const { data, error } = await db
    .from("micros_location_configs")
    .select("location_key, display_name, auth_flow, env_prefix, location_ref, enabled")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`[MICROS] Registry DB error (getAllLocationConfigs): ${error.message}`);
  }

  return (data ?? []).map(buildConfigFromRow);
}

/**
 * Returns all location keys registered in the DB.
 * Use for validation instead of `isValidLocationKey` when you need async.
 */
export async function getRegisteredLocationKeys(): Promise<string[]> {
  const db = serviceDb();
  const { data } = await db
    .from("micros_location_configs")
    .select("location_key");
  return (data ?? []).map((r: { location_key: string }) => r.location_key);
}

/**
 * Returns true if the given key exists in the DB registry.
 * Async — use in route handlers and Zod `.refine(async ...)`.
 */
export async function isValidLocationKey(key: string): Promise<boolean> {
  const keys = await getRegisteredLocationKeys();
  return keys.includes(key);
}

/**
 * Checks that no two ENABLED + CONFIGURED locations share the same
 * MICROS location reference. Duplicate refs cause data from different
 * stores to be written to the same DB rows.
 *
 * Returns an array of conflicts (empty = all clear).
 */
export async function validateLocationRefUniqueness(): Promise<LocationRefConflict[]> {
  const configs = await getAllLocationConfigs();
  const active  = configs.filter((c) => c.configured && c.enabled && !!c.locationRef);
  const refMap  = new Map<string, LocationKey[]>();

  for (const c of active) {
    const existing = refMap.get(c.locationRef) ?? [];
    existing.push(c.key);
    refMap.set(c.locationRef, existing);
  }

  return Array.from(refMap.entries())
    .filter(([, keys]) => keys.length > 1)
    .map(([locationRef, keys]) => ({ locationRef, keys }));
}

/**
 * Returns a safe (non-secret) summary of a location config.
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
 * Finds the LocationConfig whose enterpriseShortName matches the given
 * Oracle org identifier (case-insensitive).
 */
export async function getLocationConfigByOrgIdentifier(
  orgIdentifier: string,
): Promise<LocationConfig | null> {
  const norm = orgIdentifier.trim().toUpperCase();
  const all  = await getAllLocationConfigs();
  return all.find((cfg) => cfg.enterpriseShortName.trim().toUpperCase() === norm) ?? null;
}

/**
 * Resolves the LocationConfig for a micros_connections row.
 *
 * Resolution priority:
 *   1. Explicit location_key  — direct registry lookup (most reliable).
 *   2. Disambiguate by org_identifier.
 *      - Exactly one match → return it.
 *      - Multiple matches, identical credentials → return first configured.
 *      - Multiple matches, different credentials → throws AMBIGUOUS_MICROS_LOCATION_CONFIG.
 */
export async function getLocationConfigForConnection(connection: {
  org_identifier: string;
  location_key?:  string | null;
}): Promise<LocationConfig | null> {
  // ── 1. Explicit location_key ───────────────────────────────────────────────
  if (connection.location_key) {
    const valid = await isValidLocationKey(connection.location_key);
    if (valid) return getLocationConfig(connection.location_key);
  }

  // ── 2. Disambiguate by org_identifier ─────────────────────────────────────
  const norm       = connection.org_identifier.trim().toUpperCase();
  const all        = await getAllLocationConfigs();
  const orgMatches = all.filter(
    (c) => c.enterpriseShortName.trim().toUpperCase() === norm,
  );

  if (orgMatches.length === 0) return null;
  if (orgMatches.length === 1) return orgMatches[0];

  // Multiple configs share this org — check whether credentials are identical.
  const first = orgMatches[0];
  const allShareCredentials = orgMatches.every(
    (c) =>
      c.clientId  === first.clientId &&
      c.authUrl   === first.authUrl  &&
      c.username  === first.username,
  );

  if (allShareCredentials) {
    return orgMatches.find((c) => c.configured) ?? orgMatches[0];
  }

  throw new Error(
    `AMBIGUOUS_MICROS_LOCATION_CONFIG: org_identifier="${connection.org_identifier}" ` +
    `maps to ${orgMatches.length} LocationConfigs with different credentials. ` +
    `Set location_key on the micros_connections row to disambiguate ` +
    `(valid values: ${orgMatches.map((c) => `"${c.key}"`).join(", ")}).`,
  );
}
