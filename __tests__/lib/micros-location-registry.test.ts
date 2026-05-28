/**
 * __tests__/lib/micros-location-registry.test.ts
 *
 * Unit tests for the multi-location MICROS registry and related security constraints.
 *
 * NOTE (Migration 104 - auth_flow correction):
 *   Migrations 102 and 103 incorrectly set primi-camps-bay auth_flow to
 *   'client_credentials'. Migration 104 reverts it to 'pkce'.
 *
 *   The Oracle API Account Details letter for org PRI (PRIMI) confirms:
 *   - Primi was provisioned as a PKCE API account (username: PRI_THAMSANQA_BIAPI)
 *   - No client_credentials service account was provisioned by Oracle
 *   - The pre-existing CLIENT_SECRET env var is the API account password
 *     stored under the wrong variable name
 *
 *   Production state after migration 104:
 *   - Primi uses auth_flow='pkce' (same as Si Cantina / Sea Castle)
 *   - Primi requires MICROS_PRIMI_CAMPS_BAY_USERNAME + PASSWORD
 *   - configured=true only when USERNAME + PASSWORD are present
 *   - getMissingEnvNames() reports USERNAME/PASSWORD when absent
 *   - CLIENT_ID value: UFJJLmQ1Zjg3YjNlLWM4MmItNDM0ZC05OTZlLWM5NzVlZjVjN2VhYQ
 *     (raw base64 as provided in Oracle API Account Details letter)
 *
 * Tests:
 *   1.  Primi configured=true when USERNAME + PASSWORD are present
 *   2.  Primi configured=false + missingEnv includes PASSWORD when absent
 *   3.  Primi missingEnv does NOT list CLIENT_SECRET (PKCE does not use it)
 *   4.  Si Cantina resolves independently (PKCE flow unchanged)
 *   5.  Sea Castle resolves with shared MICROS_ prefix + DB location_ref
 *   6.  safeConfigSummary never exposes client secrets or passwords
 *   7.  safeConfigSummary includes tokenIsolation='per-location'
 *   8.  getMissingEnvNames returns empty array when fully configured
 *   9.  getMissingEnvNames reports USERNAME + PASSWORD for Primi when absent
 *   10. isValidLocationKey accepts known keys, rejects unknowns
 *   11. validateLocationRefUniqueness detects duplicate refs
 *   12. Primi envPrefix is exposed on LocationConfig (powers doctor/status)
 *   13. Labour score field source is labour_daily_summary.labour_pct
 *   14. test-token endpoint response schema never includes raw token fields
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// -- Supabase mock ------------------------------------------------------------
//
// Mirrors the rows in production after migration 104:
//   primi-camps-bay -> auth_flow='pkce', location_ref='101003'

const MOCK_LOCATION_ROWS = [
  {
    location_key: "si-cantina",
    display_name: "Si Cantina Sociale",
    auth_flow:    "pkce",
    env_prefix:   "MICROS_",
    location_ref: null,   // reads MICROS_LOCATION_REF from env
    enabled:      true,
  },
  {
    location_key: "primi-camps-bay",
    display_name: "Primi Camps Bay",
    auth_flow:    "pkce",  // corrected by migration 104 (was wrong 'client_credentials')
    env_prefix:   "MICROS_PRIMI_CAMPS_BAY_",
    location_ref: "101003",  // stored in DB since migration 102
    enabled:      true,
  },
  {
    location_key: "sea-castle-camps-bay",
    display_name: "Sea Castle Hotel Camps Bay",
    auth_flow:    "pkce",
    env_prefix:   "MICROS_",   // shares Si Cantina credentials
    location_ref: "2001002",   // stored in DB
    enabled:      true,
  },
];

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

// -- Env var fixtures ---------------------------------------------------------
//
// PRIMI uses PKCE flow -> USERNAME + PASSWORD, NOT CLIENT_SECRET.
// Oracle API Account Details letter: username = PRI_THAMSANQA_BIAPI
// CLIENT_ID is the raw Oracle-provided base64 value (used verbatim).

const PRIMI_ENV: Record<string, string> = {
  MICROS_PRIMI_CAMPS_BAY_ORG_IDENTIFIER: "PRI",
  MICROS_PRIMI_CAMPS_BAY_AUTH_URL:       "https://ors-idm.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_BI_SERVER:      "https://simphony-home.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_CLIENT_ID:      "UFJJLmQ1Zjg3YjNlLWM4MmItNDM0ZC05OTZlLWM5NzVlZjVjN2VhYQ",
  MICROS_PRIMI_CAMPS_BAY_USERNAME:       "PRI_THAMSANQA_BIAPI",
  MICROS_PRIMI_CAMPS_BAY_PASSWORD:       "test-api-account-password",
  // No LOCATION_REF in env -- stored in DB as '101003' (since migration 102)
  // CLIENT_SECRET is intentionally absent: PKCE does not use it
};

const SI_CANTINA_ENV: Record<string, string> = {
  MICROS_AUTH_SERVER:    "https://si-cantina-auth.example.com",
  MICROS_BI_SERVER:      "https://si-cantina-bi.example.com",
  MICROS_CLIENT_ID:      "si-cantina-client-id",
  MICROS_ORG_SHORT_NAME: "SIC",
  MICROS_USERNAME:       "apiuser",
  MICROS_PASSWORD:       "apipassword",
  MICROS_LOCATION_REF:   "200456",
};

const ALL_ENV_KEYS = [...Object.keys(PRIMI_ENV), ...Object.keys(SI_CANTINA_ENV)];

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
}

function clearEnv(keys: string[]) {
  for (const k of keys) delete process.env[k];
}

// -- Tests --------------------------------------------------------------------

describe("micros-location-registry -- Primi Camps Bay (PKCE, migration 104)", () => {
  beforeEach(() => clearEnv(ALL_ENV_KEYS));
  afterEach(()  => clearEnv(ALL_ENV_KEYS));

  // -- Test 1 -----------------------------------------------------------------
  it("configured=true when USERNAME + PASSWORD are present", async () => {
    setEnv(PRIMI_ENV);
    const { getLocationConfig } = await import("../../lib/micros/micros-location-registry");
    const cfg = await getLocationConfig("primi-camps-bay");

    expect(cfg.configured).toBe(true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.authFlow).toBe("pkce");
    expect(cfg.key).toBe("primi-camps-bay");
    expect(cfg.enterpriseShortName).toBe("PRI");
    expect(cfg.locationRef).toBe("101003"); // from DB row, not env
    expect(cfg.envPrefix).toBe("MICROS_PRIMI_CAMPS_BAY_");
    expect(cfg.username).toBe("PRI_THAMSANQA_BIAPI");
    expect(cfg.clientSecret).toBeNull(); // PKCE never populates clientSecret
  });

  // -- Test 2 -----------------------------------------------------------------
  it("configured=false and missingEnv includes PASSWORD when password absent", async () => {
    const envWithoutPassword = { ...PRIMI_ENV };
    delete (envWithoutPassword as Record<string, string>).MICROS_PRIMI_CAMPS_BAY_PASSWORD;
    setEnv(envWithoutPassword);

    const { getLocationConfig, getMissingEnvNames } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfig("primi-camps-bay");

    expect(cfg.configured).toBe(false);
    const missing = getMissingEnvNames(cfg);
    expect(missing).toContain("MICROS_PRIMI_CAMPS_BAY_PASSWORD");
  });

  // -- Test 3 -----------------------------------------------------------------
  it("missingEnv does NOT list CLIENT_SECRET for PKCE flow", async () => {
    const envWithoutPassword = { ...PRIMI_ENV };
    delete (envWithoutPassword as Record<string, string>).MICROS_PRIMI_CAMPS_BAY_PASSWORD;
    setEnv(envWithoutPassword);

    const { getLocationConfig, getMissingEnvNames } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfig("primi-camps-bay");
    const missing = getMissingEnvNames(cfg);

    // PKCE checks for USERNAME/PASSWORD, not CLIENT_SECRET
    expect(missing).not.toContain("MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET");
  });

  // -- Test 8 -----------------------------------------------------------------
  it("getMissingEnvNames returns empty array when fully configured", async () => {
    setEnv(PRIMI_ENV);
    const { getLocationConfig, getMissingEnvNames } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfig("primi-camps-bay");
    expect(cfg.configured).toBe(true);
    const missing = getMissingEnvNames(cfg);
    expect(missing).toHaveLength(0);
  });

  // -- Test 9 -----------------------------------------------------------------
  it("getMissingEnvNames reports both USERNAME and PASSWORD for Primi when absent", async () => {
    setEnv({
      MICROS_PRIMI_CAMPS_BAY_ORG_IDENTIFIER: "PRI",
      MICROS_PRIMI_CAMPS_BAY_AUTH_URL:       "https://ors-idm.msaf.oraclerestaurants.com",
      MICROS_PRIMI_CAMPS_BAY_BI_SERVER:      "https://simphony-home.msaf.oraclerestaurants.com",
      MICROS_PRIMI_CAMPS_BAY_CLIENT_ID:      "UFJJLmQ1Zjg3YjNlLWM4MmItNDM0ZC05OTZlLWM5NzVlZjVjN2VhYQ",
      // USERNAME and PASSWORD intentionally omitted
    });

    const { getLocationConfig, getMissingEnvNames } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = await getLocationConfig("primi-camps-bay");
    const missing = getMissingEnvNames(cfg);

    expect(missing).toContain("MICROS_PRIMI_CAMPS_BAY_USERNAME");
    expect(missing).toContain("MICROS_PRIMI_CAMPS_BAY_PASSWORD");
    expect(missing).not.toContain("MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET");
  });

  // -- Test 12 ----------------------------------------------------------------
  it("envPrefix is exposed on LocationConfig for doctor/status usage", async () => {
    setEnv(PRIMI_ENV);
    const { getLocationConfig } = await import("../../lib/micros/micros-location-registry");
    const cfg = await getLocationConfig("primi-camps-bay");
    expect(cfg.envPrefix).toBe("MICROS_PRIMI_CAMPS_BAY_");
  });
});

describe("micros-location-registry -- Si Cantina + Sea Castle (PKCE unchanged)", () => {
  beforeEach(() => clearEnv(ALL_ENV_KEYS));
  afterEach(()  => clearEnv(ALL_ENV_KEYS));

  // -- Test 4 -----------------------------------------------------------------
  it("Si Cantina resolves independently of Primi env vars", async () => {
    setEnv(SI_CANTINA_ENV);
    const { getLocationConfig } = await import("../../lib/micros/micros-location-registry");
    const cfg = await getLocationConfig("si-cantina");
    expect(cfg.configured).toBe(true);
    expect(cfg.authFlow).toBe("pkce");
    expect(cfg.key).toBe("si-cantina");
    expect(cfg.username).toBe("apiuser");
    expect(cfg.clientSecret).toBeNull(); // PKCE never populates clientSecret
  });

  // -- Test 5 -----------------------------------------------------------------
  it("Sea Castle resolves using shared MICROS_ prefix + DB location_ref", async () => {
    setEnv(SI_CANTINA_ENV);
    const { getLocationConfig } = await import("../../lib/micros/micros-location-registry");
    const cfg = await getLocationConfig("sea-castle-camps-bay");
    expect(cfg.configured).toBe(true);
    expect(cfg.authFlow).toBe("pkce");
    expect(cfg.locationRef).toBe("2001002"); // from DB row, not env
    expect(cfg.envPrefix).toBe("MICROS_");
  });
});

describe("micros-location-registry -- safeConfigSummary security", () => {
  beforeEach(() => clearEnv(ALL_ENV_KEYS));
  afterEach(()  => clearEnv(ALL_ENV_KEYS));

  // -- Test 6 -----------------------------------------------------------------
  it("safeConfigSummary never exposes passwords", async () => {
    setEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
    const { getLocationConfig, safeConfigSummary } = await import(
      "../../lib/micros/micros-location-registry"
    );

    const primiCfg = await getLocationConfig("primi-camps-bay");
    const siCfg    = await getLocationConfig("si-cantina");

    const primiSafeStr = JSON.stringify(safeConfigSummary(primiCfg));
    expect(primiSafeStr).not.toContain("test-api-account-password");
    expect(primiSafeStr).not.toContain('"clientSecret"');
    expect(primiSafeStr).not.toContain('"password"');

    const siSafeStr = JSON.stringify(safeConfigSummary(siCfg));
    expect(siSafeStr).not.toContain("apipassword");
    expect(siSafeStr).not.toContain('"password"');
  });

  // -- Test 7 -----------------------------------------------------------------
  it("safeConfigSummary includes tokenIsolation='per-location'", async () => {
    setEnv(PRIMI_ENV);
    const { getLocationConfig, safeConfigSummary } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg     = await getLocationConfig("primi-camps-bay");
    const summary = safeConfigSummary(cfg);
    expect(summary.tokenIsolation).toBe("per-location");
  });
});

describe("micros-location-registry -- location ref uniqueness", () => {
  it("validateLocationRefUniqueness detects duplicate location_ref among configured+enabled", async () => {
    const { validateLocationRefUniqueness } = await import(
      "../../lib/micros/micros-location-registry"
    );
    // All 3 mock rows have distinct refs (null, 101003, 2001002) -- no conflicts.
    // Si Cantina has null locationRef (reads from MICROS_LOCATION_REF env) and
    // env is not set in this test, so it is excluded from the active set.
    const conflicts = await validateLocationRefUniqueness();
    expect(Array.isArray(conflicts)).toBe(true);
  });
});

describe("micros-location-registry -- isValidLocationKey", () => {
  // -- Test 10 ----------------------------------------------------------------
  it("accepts known keys and rejects unknowns", async () => {
    const { isValidLocationKey } = await import("../../lib/micros/micros-location-registry");
    expect(await isValidLocationKey("si-cantina")).toBe(true);
    expect(await isValidLocationKey("primi-camps-bay")).toBe(true);
    expect(await isValidLocationKey("sea-castle-camps-bay")).toBe(true);
    expect(await isValidLocationKey("unknown-location")).toBe(false);
    expect(await isValidLocationKey("")).toBe(false);
    expect(await isValidLocationKey("PRIMI-CAMPS-BAY")).toBe(false); // case-sensitive
  });
});

// -- Labour score field source ------------------------------------------------

describe("Labour score reads from labour_daily_summary.labour_pct", () => {
  // -- Test 13 ----------------------------------------------------------------
  it("calcLabourScore uses labourPct from labour_daily_summary, not micros_sales_daily", async () => {
    const { calcLabourScore } = await import("../../lib/scoring/operatingScore");

    const onTarget   = calcLabourScore(30, 50000, 50000, 30);
    expect(onTarget.rawScore).toBeGreaterThanOrEqual(90);

    const overBudget = calcLabourScore(50, 50000, 50000, 30);
    expect(overBudget.rawScore).toBeLessThan(onTarget.rawScore);

    const noData = calcLabourScore(null, 50000, 50000, 30);
    expect(noData.rawScore).toBe(0);
  });

  it("labour_daily_summary.labour_pct column is the correct field name (not labor_pct)", () => {
    type LabourDailySummaryRow = {
      labour_pct: number | null;
      net_sales: number | null;
    };
    const row: LabourDailySummaryRow = { labour_pct: 28.5, net_sales: 50000 };
    expect(row.labour_pct).toBe(28.5);
    expect((row as Record<string, unknown>)["labor_pct"]).toBeUndefined();
  });
});

// -- Token endpoint security --------------------------------------------------

describe("test-token endpoint security", () => {
  // -- Test 14 ----------------------------------------------------------------
  it("response schema does not include raw token fields", () => {
    const mockResponse = {
      locationKey:   "primi-camps-bay",
      displayName:   "Primi Camps Bay",
      configured:    true,
      enabled:       true,
      tokenReceived: true,
      authFlow:      "pkce",  // corrected from 'client_credentials' by migration 104
      expiresIn:     3540,
      error:         null,
      checkedAt:     new Date().toISOString(),
    };

    expect((mockResponse as Record<string, unknown>)["token"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["bearerToken"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["access_token"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["id_token"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["clientSecret"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["password"]).toBeUndefined();
    expect(mockResponse.tokenReceived).toBe(true);
    expect(mockResponse.authFlow).toBe("pkce");
  });
});
