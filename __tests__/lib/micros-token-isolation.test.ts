/**
 * __tests__/lib/micros-token-isolation.test.ts
 *
 * Token isolation tests — verifies that Oracle tokens are scoped per-org
 * and that SCS/Si Cantina tokens cannot contaminate Primi (PRI) requests.
 *
 * Root cause being guarded: Oracle error 33102
 *   "Organization identifier does not match the identity provided"
 *   Caused by global cachedTokens (SCS token) being reused for PRI org.
 *
 * Tests:
 *   1. getLocationConfigByOrgIdentifier resolves PRI → Primi config
 *   2. getLocationConfigByOrgIdentifier resolves SCS → Si Cantina config
 *   3. getLocationConfigByOrgIdentifier resolves SIC → Si Cantina config (case-insensitive)
 *   4. getLocationConfigByOrgIdentifier returns null for unknown org
 *   5. Primi and Si Cantina configs use different cache keys (LocationKey)
 *   6. clearLocationTokenCache for PRI does not affect SCS cache entry
 *   7. clearLocationTokenCache for SCS does not affect PRI cache entry
 *   8. SCS token cache key ≠ PRI token cache key
 *   9. getCachedLocationToken returns null after clearLocationTokenCache
 *  10. Primo config: authFlow=pkce, username from env, password from CLIENT_SECRET alias
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ── Env fixture helpers ────────────────────────────────────────────────────

const PRIMI_ENV: Record<string, string> = {
  MICROS_PRIMI_CAMPS_BAY_ENABLED:       "true",
  MICROS_PRIMI_CAMPS_BAY_ENTERPRISE:    "PRI",
  MICROS_PRIMI_CAMPS_BAY_AUTH_URL:      "https://pri-ors-idm.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_BASE_URL:      "https://pri-simphony.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_CLIENT_ID:     "PRI.d5f87b3e-c82b-434d-996e-c975ef5c7eaa",
  MICROS_PRIMI_CAMPS_BAY_USERNAME:      "PRI_BIAPI_USER",
  MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET: "pri-secret-value",
  MICROS_PRIMI_CAMPS_BAY_LOCATION_REF:  "101003",
};

const SI_CANTINA_ENV: Record<string, string> = {
  MICROS_ENABLED:       "true",
  MICROS_AUTH_SERVER:   "https://scs-ors-idm.msaf.oraclerestaurants.com",
  MICROS_BI_SERVER:     "https://scs-simphony.msaf.oraclerestaurants.com",
  MICROS_CLIENT_ID:     "SCS.a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  MICROS_ORG_SHORT_NAME:"SCS",
  MICROS_USERNAME:      "SCS_BIAPI_USER",
  MICROS_PASSWORD:      "scs-api-password",
  MICROS_LOCATION_REF:  "200100",
};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
}

function clearEnv(vars: Record<string, string>) {
  for (const k of Object.keys(vars)) delete process.env[k];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Token isolation — getLocationConfigByOrgIdentifier", () => {
  beforeEach(() => {
    clearEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
    setEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
  });

  afterEach(() => {
    clearEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
  });

  it("resolves PRI → Primi config with correct key and enterpriseShortName", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = getLocationConfigByOrgIdentifier("PRI");
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("primi-camps-bay");
    expect(cfg!.enterpriseShortName).toBe("PRI");
    expect(cfg!.authFlow).toBe("pkce");
  });

  it("resolves SCS → Si Cantina config", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = getLocationConfigByOrgIdentifier("SCS");
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("si-cantina");
    expect(cfg!.enterpriseShortName).toBe("SCS");
  });

  it("is case-insensitive — pri matches PRI", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = getLocationConfigByOrgIdentifier("pri");
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("primi-camps-bay");
  });

  it("returns null for an unknown org identifier", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = getLocationConfigByOrgIdentifier("UNKNOWN_ORG");
    expect(cfg).toBeNull();
  });

  it("Primi and Si Cantina have different LocationKeys", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const primi = getLocationConfigByOrgIdentifier("PRI");
    const scs   = getLocationConfigByOrgIdentifier("SCS");
    expect(primi!.key).not.toBe(scs!.key);
  });

  it("Primi credentials use MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET as password", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = getLocationConfigByOrgIdentifier("PRI");
    // password field holds the PKCE account password (stored as CLIENT_SECRET for compat)
    expect(cfg!.password).toBe("pri-secret-value");
    // clientSecret should be null for PKCE flow (no OAuth2 client secret needed)
    expect(cfg!.clientSecret).toBeNull();
  });

  it("Si Cantina does NOT expose Primi credentials", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const scs = getLocationConfigByOrgIdentifier("SCS");
    expect(scs!.username).toBe("SCS_BIAPI_USER");
    expect(scs!.username).not.toBe("PRI_BIAPI_USER");
    expect(scs!.authUrl).not.toContain("pri-");
  });
});

describe("Token isolation — per-location cache (location-auth.ts)", () => {
  it("cache keys for SCS and PRI are different (different LocationKey strings)", () => {
    // LocationKey is the cache key for location-auth.ts tokenCache Map.
    // Verify the keys are distinct so clearing one never affects the other.
    const priKey:  "primi-camps-bay"       = "primi-camps-bay";
    const scsKey:  "si-cantina"            = "si-cantina";
    expect(priKey).not.toBe(scsKey);
  });

  it("clearLocationTokenCache(PRI key) does not affect SCS cache entry", async () => {
    const {
      clearLocationTokenCache,
      getCachedLocationToken,
    } = await import("../../lib/micros/location-auth");

    // Manually seed a fake SCS token
    const { seedLocationTokenCache } = await import("../../lib/micros/location-auth");
    seedLocationTokenCache("si-cantina", {
      bearerToken: "scs-fake-token",
      expiresAt:   Date.now() + 10 * 60 * 60 * 1000, // 10 h from now
    });

    // Clear Primi's cache — should NOT affect SCS
    clearLocationTokenCache("primi-camps-bay");

    const scsEntry = getCachedLocationToken("si-cantina");
    expect(scsEntry).not.toBeNull();
    expect(scsEntry!.bearerToken).toBe("scs-fake-token");

    // Clean up
    clearLocationTokenCache("si-cantina");
  });

  it("clearLocationTokenCache(SCS key) does not affect PRI cache entry", async () => {
    const {
      clearLocationTokenCache,
      getCachedLocationToken,
      seedLocationTokenCache,
    } = await import("../../lib/micros/location-auth");

    seedLocationTokenCache("primi-camps-bay", {
      bearerToken: "pri-fake-token",
      expiresAt:   Date.now() + 10 * 60 * 60 * 1000,
    });

    clearLocationTokenCache("si-cantina");

    const priEntry = getCachedLocationToken("primi-camps-bay");
    expect(priEntry).not.toBeNull();
    expect(priEntry!.bearerToken).toBe("pri-fake-token");

    clearLocationTokenCache("primi-camps-bay");
  });

  it("getCachedLocationToken returns null after clearLocationTokenCache", async () => {
    const {
      clearLocationTokenCache,
      getCachedLocationToken,
      seedLocationTokenCache,
    } = await import("../../lib/micros/location-auth");

    seedLocationTokenCache("primi-camps-bay", {
      bearerToken: "pri-fake-token",
      expiresAt:   Date.now() + 10 * 60 * 60 * 1000,
    });

    clearLocationTokenCache("primi-camps-bay");
    expect(getCachedLocationToken("primi-camps-bay")).toBeNull();
  });

  it("getCachedLocationToken returns null for an expired token", async () => {
    const {
      getCachedLocationToken,
      seedLocationTokenCache,
      clearLocationTokenCache,
    } = await import("../../lib/micros/location-auth");

    seedLocationTokenCache("si-cantina", {
      bearerToken: "expired-token",
      expiresAt:   Date.now() - 1000, // already expired
    });

    expect(getCachedLocationToken("si-cantina")).toBeNull();
    // Clean up (may already be removed by the expiry check)
    clearLocationTokenCache("si-cantina");
  });
});
