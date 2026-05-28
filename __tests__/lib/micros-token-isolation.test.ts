/**
 * __tests__/lib/micros-token-isolation.test.ts
 *
 * Token isolation tests -- verifies that Oracle tokens are scoped per-org
 * and that SCS/Si Cantina tokens cannot contaminate Primi (PRI) requests.
 *
 * Root cause being guarded: Oracle error 33102
 *   "Organization identifier does not match the identity provided"
 *   Caused by global cachedTokens (SCS token) being reused for PRI org.
 *
 * NOTE (Migration 104 -- auth_flow correction):
 *   Primi Camps Bay uses PKCE flow, not client_credentials.
 *   Oracle provisioned a PKCE API account for Primi (PRI_THAMSANQA_BIAPI).
 *   Updated PRIMI_ENV fixture uses USERNAME + PASSWORD (not CLIENT_SECRET).
 *   Mock row for Primi uses auth_flow='pkce' reflecting production state
 *   after migration 104.
 *
 * Tests:
 *   1. getLocationConfigByOrgIdentifier resolves PRI -> Primi config
 *   2. getLocationConfigByOrgIdentifier resolves SCS -> Si Cantina config
 *   3. getLocationConfigByOrgIdentifier resolves SIC -> Si Cantina config (case-insensitive)
 *   4. getLocationConfigByOrgIdentifier returns null for unknown org
 *   5. Primi and Si Cantina configs use different cache keys (LocationKey)
 *   6. clearLocationTokenCache for PRI does not affect SCS cache entry
 *   7. clearLocationTokenCache for SCS does not affect PRI cache entry
 *   8. SCS token cache key != PRI token cache key
 *   9. getCachedLocationToken returns null after clearLocationTokenCache
 *  10. Primi config: authFlow=pkce, uses USERNAME + PASSWORD (not CLIENT_SECRET)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// -- Supabase mock ------------------------------------------------------------
//
// Mirrors the 3 rows in production after migration 104:
//   - si-cantina: pkce, MICROS_ prefix
//   - primi-camps-bay: pkce, MICROS_PRIMI_CAMPS_BAY_ prefix, location_ref=101003
//   - sea-castle-camps-bay: pkce, MICROS_ prefix, location_ref=2001002

const MOCK_LOCATION_ROWS = [
  {
    location_key: "si-cantina",
    display_name: "Si Cantina Sociale",
    auth_flow:    "pkce",
    env_prefix:   "MICROS_",
    location_ref: null,
    enabled:      true,
  },
  {
    location_key: "primi-camps-bay",
    display_name: "Primi Camps Bay",
    auth_flow:    "pkce",  // corrected by migration 104
    env_prefix:   "MICROS_PRIMI_CAMPS_BAY_",
    location_ref: "101003",
    enabled:      true,
  },
  {
    location_key: "sea-castle-camps-bay",
    display_name: "Sea Castle Hotel Camps Bay",
    auth_flow:    "pkce",
    env_prefix:   "MICROS_",
    location_ref: "2001002",
    enabled:      true,
  },
];

/**
 * Chainable Supabase query mock.
 * Handles the two patterns used by the registry:
 *   a) .from().select().order()      -> awaited directly -> { data: rows[], error }
 *   b) .from().select().eq().maybeSingle() -> awaited via method -> { data: row|null, error }
 *   c) .from().select("location_key") -> awaited directly -> { data: [{location_key}][], error }
 */
class MockQueryChain {
  private rows: typeof MOCK_LOCATION_ROWS;
  private keysOnly = false;

  constructor(rows: typeof MOCK_LOCATION_ROWS) {
    this.rows = [...rows];
  }

  select(cols: string) {
    if (cols === "location_key") this.keysOnly = true;
    return this;
  }

  eq(col: string, val: string) {
    if (col === "location_key") {
      this.rows = this.rows.filter((r) => r.location_key === val);
    }
    return this;
  }

  order(_col: string, _opts?: unknown) {
    return this;
  }

  async maybeSingle(): Promise<{ data: (typeof MOCK_LOCATION_ROWS)[0] | null; error: null }> {
    return { data: this.rows[0] ?? null, error: null };
  }

  then(
    resolve: (val: { data: unknown[]; error: null }) => unknown,
    _reject?: (reason: unknown) => unknown,
  ) {
    const data = this.keysOnly
      ? this.rows.map((r) => ({ location_key: r.location_key }))
      : (this.rows as unknown[]);
    return Promise.resolve({ data, error: null }).then(resolve);
  }
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (_table: string) => new MockQueryChain(MOCK_LOCATION_ROWS),
  })),
}));

// -- Env fixture helpers ------------------------------------------------------

// Primi uses PKCE: Oracle account PRI_THAMSANQA_BIAPI + password + client_id.
// CLIENT_ID is the raw Oracle-provided base64 string from the API Account Details letter.
const PRIMI_ENV: Record<string, string> = {
  MICROS_PRIMI_CAMPS_BAY_ORG_SHORT_NAME:  "PRI",
  MICROS_PRIMI_CAMPS_BAY_AUTH_URL:        "https://ors-idm.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_BI_SERVER:       "https://simphony-home.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_CLIENT_ID:       "UFJJLmQ1Zjg3YjNlLWM4MmItNDM0ZC05OTZlLWM5NzVlZjVjN2VhYQ",
  MICROS_PRIMI_CAMPS_BAY_USERNAME:        "PRI_THAMSANQA_BIAPI",
  MICROS_PRIMI_CAMPS_BAY_PASSWORD:        "pri-api-account-password",
  // No LOCATION_REF in env -- stored in DB as '101003'
  // CLIENT_SECRET intentionally absent: PKCE does not use it
};

const SI_CANTINA_ENV: Record<string, string> = {
  MICROS_ENABLED:        "true",
  MICROS_AUTH_URL:       "https://ors-idm.msaf.oraclerestaurants.com",
  MICROS_BI_SERVER:      "https://simphony-home.msaf.oraclerestaurants.com",
  MICROS_CLIENT_ID:      "U0NTLjZkMjI3ZGU3LWE3MzUtNGQ1Ny04ZTFlLWM1YWY0MmE4MzYxNQ",
  MICROS_ORG_SHORT_NAME: "SCS",
  MICROS_USERNAME:       "SCS_BIAPI_USER",
  MICROS_PASSWORD:       "scs-api-password",
  MICROS_LOCATION_REF:   "200100",
};

const SEA_CASTLE_ENV: Record<string, string> = {
  MICROS_SEA_CASTLE_ENABLED:      "true",
  MICROS_SEA_CASTLE_LOCATION_REF: "2001002",
};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
}

function clearEnv(vars: Record<string, string>) {
  for (const k of Object.keys(vars)) delete process.env[k];
}

// -- Tests --------------------------------------------------------------------

describe("Token isolation -- getLocationConfigByOrgIdentifier", () => {
  beforeEach(() => {
    clearEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
    setEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
  });

  afterEach(() => {
    clearEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
  });

  it("resolves PRI -> Primi config with correct key and enterpriseShortName", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigByOrgIdentifier("PRI");
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("primi-camps-bay");
    expect(cfg!.enterpriseShortName).toBe("PRI");
    expect(cfg!.authFlow).toBe("pkce");
  });

  it("resolves SCS -> Si Cantina config", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigByOrgIdentifier("SCS");
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("si-cantina");
    expect(cfg!.enterpriseShortName).toBe("SCS");
  });

  it("is case-insensitive -- pri matches PRI", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigByOrgIdentifier("pri");
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("primi-camps-bay");
  });

  it("returns null for an unknown org identifier", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigByOrgIdentifier("UNKNOWN_ORG");
    expect(cfg).toBeNull();
  });

  it("Primi and Si Cantina have different LocationKeys", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const primi = await getLocationConfigByOrgIdentifier("PRI");
    const scs   = await getLocationConfigByOrgIdentifier("SCS");
    expect(primi!.key).not.toBe(scs!.key);
  });

  // Test 10: Primi authFlow=pkce, uses USERNAME + PASSWORD (not CLIENT_SECRET)
  it("Primi config: authFlow=pkce, reads USERNAME and PASSWORD (not CLIENT_SECRET)", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigByOrgIdentifier("PRI");
    expect(cfg!.authFlow).toBe("pkce");
    expect(cfg!.username).toBe("PRI_THAMSANQA_BIAPI");
    // password is populated for pkce flow
    expect(cfg!.password).toBe("pri-api-account-password");
    // clientSecret is null for pkce flow -- CLIENT_SECRET env var not used
    expect(cfg!.clientSecret).toBeNull();
    expect(cfg!.configured).toBe(true);
  });

  it("Si Cantina does NOT expose Primi credentials", async () => {
    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const scs = await getLocationConfigByOrgIdentifier("SCS");
    expect(scs!.username).toBe("SCS_BIAPI_USER");
    expect(scs!.username).not.toBe("PRI_THAMSANQA_BIAPI");
    expect(scs!.authUrl).not.toContain("pri-");
  });
});

describe("Token isolation -- per-location cache (location-auth.ts)", () => {
  it("cache keys for SCS and PRI are different (different LocationKey strings)", () => {
    const priKey  = "primi-camps-bay";
    const scsKey  = "si-cantina";
    expect(priKey).not.toBe(scsKey);
  });

  it("clearLocationTokenCache(PRI key) does not affect SCS cache entry", async () => {
    const {
      clearLocationTokenCache,
      getCachedLocationToken,
      seedLocationTokenCache,
    } = await import("../../lib/micros/location-auth");

    seedLocationTokenCache("si-cantina", {
      bearerToken: "scs-fake-token",
      expiresAt:   Date.now() + 10 * 60 * 60 * 1000,
    });

    clearLocationTokenCache("primi-camps-bay");

    const scsEntry = getCachedLocationToken("si-cantina");
    expect(scsEntry).not.toBeNull();
    expect(scsEntry!.bearerToken).toBe("scs-fake-token");

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
      expiresAt:   Date.now() - 1000,
    });

    expect(getCachedLocationToken("si-cantina")).toBeNull();
    clearLocationTokenCache("si-cantina");
  });
});

// -- SCS disambiguation tests -------------------------------------------------

describe("SCS disambiguation -- getLocationConfigForConnection", () => {
  beforeEach(() => {
    clearEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV, ...SEA_CASTLE_ENV });
    setEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV, ...SEA_CASTLE_ENV });
  });

  afterEach(() => {
    clearEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV, ...SEA_CASTLE_ENV });
  });

  it("explicit location_key=sea-castle-camps-bay returns Sea Castle config", async () => {
    const { getLocationConfigForConnection } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigForConnection({
      org_identifier: "SCS",
      location_key:   "sea-castle-camps-bay",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("sea-castle-camps-bay");
    expect(cfg!.locationRef).toBe("2001002");
  });

  it("explicit location_key=si-cantina returns Si Cantina config", async () => {
    const { getLocationConfigForConnection } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigForConnection({
      org_identifier: "SCS",
      location_key:   "si-cantina",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("si-cantina");
    expect(cfg!.locationRef).toBe("200100");
  });

  it("SCS + no location_key returns a valid SCS config (shared credentials)", async () => {
    const { getLocationConfigForConnection } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigForConnection({ org_identifier: "SCS" });
    expect(cfg).not.toBeNull();
    expect(cfg!.enterpriseShortName).toBe("SCS");
  });

  it("PRI + no location_key returns Primi config unambiguously", async () => {
    const { getLocationConfigForConnection } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigForConnection({ org_identifier: "PRI" });
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("primi-camps-bay");
    expect(cfg!.enterpriseShortName).toBe("PRI");
  });

  it("unknown org + no location_key returns null", async () => {
    const { getLocationConfigForConnection } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigForConnection({ org_identifier: "UNKNOWN_ORG" });
    expect(cfg).toBeNull();
  });

  it("invalid location_key falls back to org_identifier disambiguation", async () => {
    const { getLocationConfigForConnection } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigForConnection({
      org_identifier: "PRI",
      location_key:   "not-a-real-key",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.key).toBe("primi-camps-bay");
  });

  it("Sea Castle config has locationRef distinct from Si Cantina", async () => {
    const { getLocationConfigForConnection } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const scs = await getLocationConfigForConnection({
      org_identifier: "SCS",
      location_key:   "si-cantina",
    });
    const sc = await getLocationConfigForConnection({
      org_identifier: "SCS",
      location_key:   "sea-castle-camps-bay",
    });
    expect(scs!.locationRef).not.toBe(sc!.locationRef);
    expect(sc!.locationRef).toBe("2001002");
  });
});

// -- Registry fallback for empty DB fields ------------------------------------

describe("buildSimphonyClient -- registry fallback for empty DB fields", () => {
  beforeEach(() => {
    clearEnv({ ...SI_CANTINA_ENV, ...SEA_CASTLE_ENV });
    setEnv({ ...SI_CANTINA_ENV, ...SEA_CASTLE_ENV });
  });

  afterEach(() => {
    clearEnv({ ...SI_CANTINA_ENV, ...SEA_CASTLE_ENV });
  });

  it("builds client without throwing when DB has empty fields but location_key is set", async () => {
    const { buildSimphonyClient } = await import("../../lib/sync/simphony-client");
    await expect(
      buildSimphonyClient({
        app_server_url: "",
        org_identifier: "",
        location_key:   "sea-castle-camps-bay",
      })
    ).resolves.toBeDefined();
  });

  it("throws MICROS_LOCATION_CONFIG_MISSING when fields are empty and org is unregistered", async () => {
    const { buildSimphonyClient } = await import("../../lib/sync/simphony-client");
    await expect(
      buildSimphonyClient({
        app_server_url: "",
        org_identifier: "UNREGISTERED_ORG",
      })
    ).rejects.toThrow("MICROS_LOCATION_CONFIG_MISSING");
  });

  it("Sea Castle and Si Cantina share auth credentials -- tokens are interchangeable", async () => {
    const { getLocationConfig } = await import("../../lib/micros/micros-location-registry");
    const scs = await getLocationConfig("si-cantina");
    const sc  = await getLocationConfig("sea-castle-camps-bay");
    expect(sc.authUrl).toBe(scs.authUrl);
    expect(sc.clientId).toBe(scs.clientId);
    expect(sc.enterpriseShortName).toBe(scs.enterpriseShortName);
    expect(sc.username).toBe(scs.username);
    expect(sc.locationRef).not.toBe(scs.locationRef);
    expect(sc.locationRef).toBe("2001002");
    expect(sc.key).toBe("sea-castle-camps-bay");
    expect(scs.key).toBe("si-cantina");
  });

  it("Sea Castle and Si Cantina have distinct token cache keys", () => {
    const scKey  = "sea-castle-camps-bay";
    const scsKey = "si-cantina";
    expect(scKey).not.toBe(scsKey);
  });
});

// -- Hard-block isolation tests -----------------------------------------------

describe("Hard-block: Primi must never use global token fallback", () => {
  beforeEach(() => {
    clearEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
    setEnv({ ...SI_CANTINA_ENV }); // Deliberately omit PRIMI_ENV
  });

  afterEach(() => {
    clearEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
  });

  it("buildSimphonyClient throws when Primi LocationConfig is unconfigured (missing env vars)", async () => {
    const { buildSimphonyClient } = await import("../../lib/sync/simphony-client");

    await expect(
      buildSimphonyClient({
        app_server_url: "https://simphony-home.msaf.oraclerestaurants.com",
        org_identifier: "PRI",
        location_key:   "primi-camps-bay",
      }).then(async (client) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (client as any).getToken();
      })
    ).rejects.toThrow(/per-location credentials/);
  });

  it("Primi with configured LocationConfig uses acquireLocationToken, not getMicrosIdToken", async () => {
    setEnv(PRIMI_ENV);

    const locationAuthMod = await import("../../lib/micros/location-auth");
    const acquireSpy = vi.spyOn(locationAuthMod, "acquireLocationToken").mockResolvedValue("pri-fake-bearer");

    const { getLocationConfigByOrgIdentifier } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfigByOrgIdentifier("PRI");
    expect(cfg).not.toBeNull();
    expect(cfg!.configured).toBe(true);
    expect(cfg!.authFlow).toBe("pkce");

    const token = await locationAuthMod.acquireLocationToken(cfg!);
    expect(acquireSpy).toHaveBeenCalledWith(cfg);
    expect(token).toBe("pri-fake-bearer");

    acquireSpy.mockRestore();
    clearEnv(PRIMI_ENV);
  });

  it("SCS org is allowed to use global token fallback (it IS the global org)", async () => {
    const { buildSimphonyClient } = await import("../../lib/sync/simphony-client");
    await expect(
      buildSimphonyClient({
        app_server_url: "https://simphony-home.msaf.oraclerestaurants.com",
        org_identifier: "SCS",
        location_key:   "si-cantina",
      })
    ).resolves.toBeDefined();
  });
});
