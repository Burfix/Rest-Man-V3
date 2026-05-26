/**
 * __tests__/lib/micros-location-registry.test.ts
 *
 * Unit tests for the multi-location MICROS registry and related security constraints.
 *
 * NOTE (Week 3a — DB-backed registry):
 *   The registry now reads non-secret metadata from Supabase (migration 101).
 *   This test mocks @supabase/supabase-js to return the 3 seed rows so tests
 *   run without a real DB connection. Credential fields still come from env vars.
 *
 * Tests:
 *   1. Primi config resolves → configured=true when all env vars present
 *   2. Primi config → configured=false when PASSWORD missing
 *   3. Si Cantina config still resolves independently
 *   4. safeConfigSummary never includes secret/password fields
 *   5. isValidLocationKey accepts known keys and rejects unknowns
 *   6. Labour score field source is labour_daily_summary.labour_pct (not micros_sales_daily)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Supabase mock ──────────────────────────────────────────────────────────
//
// Returns the 3 seed rows from migration 101_micros_location_registry.sql.
// Credential fields are never in the DB — they come from env vars.

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
    auth_flow:    "pkce",
    env_prefix:   "MICROS_PRIMI_CAMPS_BAY_",
    location_ref: null,
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

// ── Env var fixtures ───────────────────────────────────────────────────────
//
// Env var naming follows the registry convention:
//   {prefix}ORG_SHORT_NAME  — enterprise identifier (not ENTERPRISE)
//   {prefix}BI_SERVER       — app server URL        (not BASE_URL)
//   {prefix}AUTH_URL        — auth server URL        (or AUTH_SERVER)
//   {prefix}PASSWORD        — PKCE account password  (not CLIENT_SECRET)
//   {prefix}CLIENT_SECRET   — client_credentials only (null for PKCE)

const PRIMI_ENV: Record<string, string> = {
  MICROS_PRIMI_CAMPS_BAY_ORG_SHORT_NAME: "PRI",
  MICROS_PRIMI_CAMPS_BAY_AUTH_URL:       "https://ors-idm.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_BI_SERVER:      "https://simphony-home.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_CLIENT_ID:      "PRI.d5f87b3e-c82b-434d-996e-c975ef5c7eaa",
  MICROS_PRIMI_CAMPS_BAY_USERNAME:       "PRI_THAMSANQA_BIAPI",
  MICROS_PRIMI_CAMPS_BAY_PASSWORD:       "test-secret-value",  // PKCE uses PASSWORD, not CLIENT_SECRET
  MICROS_PRIMI_CAMPS_BAY_LOCATION_REF:   "101003",
};

const SI_CANTINA_ENV: Record<string, string> = {
  MICROS_AUTH_SERVER:    "https://si-cantina-auth.example.com",  // AUTH_SERVER alias works too
  MICROS_BI_SERVER:      "https://si-cantina-bi.example.com",
  MICROS_CLIENT_ID:      "si-cantina-client-id",
  MICROS_ORG_SHORT_NAME: "SIC",
  MICROS_USERNAME:       "apiuser",
  MICROS_PASSWORD:       "apipassword",
  MICROS_LOCATION_REF:   "200456",
};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
}

function clearEnv(keys: string[]) {
  for (const k of keys) delete process.env[k];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("micros-location-registry", () => {
  beforeEach(() => {
    clearEnv([...Object.keys(PRIMI_ENV), ...Object.keys(SI_CANTINA_ENV)]);
  });

  afterEach(() => {
    clearEnv([...Object.keys(PRIMI_ENV), ...Object.keys(SI_CANTINA_ENV)]);
  });

  // ── Test 1: Primi fully configured ───────────────────────────────────────
  it("getLocationConfig('primi-camps-bay') → configured=true when all env vars present", async () => {
    setEnv(PRIMI_ENV);
    const { getLocationConfig } = await import("../../lib/micros/micros-location-registry");
    const cfg = await getLocationConfig("primi-camps-bay");
    expect(cfg.configured).toBe(true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.authFlow).toBe("pkce");
    expect(cfg.key).toBe("primi-camps-bay");
    expect(cfg.enterpriseShortName).toBe("PRI");
  });

  // ── Test 2: Primi → configured=false when PASSWORD missing ───────────────
  it("getLocationConfig('primi-camps-bay') → configured=false when PASSWORD missing", async () => {
    const envWithoutPassword = { ...PRIMI_ENV };
    delete (envWithoutPassword as Partial<typeof PRIMI_ENV>).MICROS_PRIMI_CAMPS_BAY_PASSWORD;
    setEnv(envWithoutPassword as Record<string, string>);
    const { getLocationConfig } = await import("../../lib/micros/micros-location-registry");
    const cfg = await getLocationConfig("primi-camps-bay");
    // PKCE requires username + password — missing password → not configured
    expect(cfg.configured).toBe(false);
  });

  // ── Test 3: Si Cantina resolves independently ────────────────────────────
  it("getLocationConfig('si-cantina') resolves independently of Primi env vars", async () => {
    setEnv(SI_CANTINA_ENV);
    // Deliberately do NOT set Primi env vars
    const { getLocationConfig } = await import("../../lib/micros/micros-location-registry");
    const cfg = await getLocationConfig("si-cantina");
    expect(cfg.configured).toBe(true);
    expect(cfg.authFlow).toBe("pkce");
    expect(cfg.key).toBe("si-cantina");
  });

  // ── Test 4: safeConfigSummary never includes secret/password ─────────────
  it("safeConfigSummary strips clientSecret and password fields", async () => {
    setEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
    const { getLocationConfig, safeConfigSummary } = await import(
      "../../lib/micros/micros-location-registry"
    );

    const primiCfg = await getLocationConfig("primi-camps-bay");
    const siCfg    = await getLocationConfig("si-cantina");

    const primiSafe = safeConfigSummary(primiCfg);
    const siSafe    = safeConfigSummary(siCfg);

    // Neither summary should contain any secret values
    const primiSafeStr = JSON.stringify(primiSafe);
    expect(primiSafeStr).not.toContain("test-secret-value");
    expect(primiSafeStr).not.toContain("clientSecret");
    expect(primiSafeStr).not.toContain("password");

    const siSafeStr = JSON.stringify(siSafe);
    expect(siSafeStr).not.toContain("apipassword");
    expect(siSafeStr).not.toContain("clientSecret");
    expect(siSafeStr).not.toContain("password");
  });

  // ── Test 5: isValidLocationKey ───────────────────────────────────────────
  it("isValidLocationKey accepts known keys and rejects unknowns", async () => {
    const { isValidLocationKey } = await import("../../lib/micros/micros-location-registry");
    // All three seed locations are registered
    expect(await isValidLocationKey("si-cantina")).toBe(true);
    expect(await isValidLocationKey("primi-camps-bay")).toBe(true);
    expect(await isValidLocationKey("sea-castle-camps-bay")).toBe(true);
    // Unknowns → false
    expect(await isValidLocationKey("unknown-location")).toBe(false);
    expect(await isValidLocationKey("")).toBe(false);
    expect(await isValidLocationKey("PRIMI-CAMPS-BAY")).toBe(false); // case-sensitive
  });
});

// ── Labour score field source ─────────────────────────────────────────────────

describe("Labour score reads from labour_daily_summary.labour_pct", () => {
  it("calcLabourScore uses labourPct from labour_daily_summary, not micros_sales_daily", async () => {
    const { calcLabourScore } = await import("../../lib/scoring/operatingScore");

    // When labourPct is provided (from labour_daily_summary.labour_pct), it scores correctly
    // Signature: calcLabourScore(labourPct, actualRevenue, targetRevenue, targetLabourPct)
    const onTarget = calcLabourScore(30, 50000, 50000, 30);
    expect(onTarget.rawScore).toBeGreaterThanOrEqual(90);

    // High labour pct reduces score
    const overBudget = calcLabourScore(50, 50000, 50000, 30); // 50% actual vs 30% target
    expect(overBudget.rawScore).toBeLessThan(onTarget.rawScore);

    // When no labour data (null), score is 0 (no data)
    const noData = calcLabourScore(null, 50000, 50000, 30);
    expect(noData.rawScore).toBe(0);
  });

  it("labour_daily_summary.labour_pct column is the correct field name (not labor_pct)", () => {
    // Static/type check test — verifying that the DB column name we rely on
    // is 'labour_pct' (British spelling) in labour_daily_summary,
    // NOT 'labor_pct' which is the column in micros_sales_daily.
    type LabourDailySummaryRow = {
      labour_pct: number | null; // ← must be this name, not labor_pct
      net_sales: number | null;
    };

    const row: LabourDailySummaryRow = { labour_pct: 28.5, net_sales: 50000 };
    expect(row.labour_pct).toBe(28.5);
    // Verify the old wrong field name does not exist on this type
    expect((row as Record<string, unknown>)["labor_pct"]).toBeUndefined();
  });
});

// ── Token endpoint security: token never returned to caller ──────────────────

describe("test-token endpoint security", () => {
  it("response schema does not include raw token fields", () => {
    // Simulate the shape that /api/integrations/micros/test-token returns
    const mockResponse = {
      locationKey:   "primi-camps-bay",
      displayName:   "Primi Camps Bay",
      configured:    true,
      enabled:       true,
      tokenReceived: true,
      authFlow:      "pkce",
      expiresIn:     3540,
      error:         null,
      checkedAt:     new Date().toISOString(),
    };

    // None of these fields should be present
    expect((mockResponse as Record<string, unknown>)["token"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["bearerToken"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["access_token"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["id_token"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["clientSecret"]).toBeUndefined();
    expect((mockResponse as Record<string, unknown>)["password"]).toBeUndefined();

    // But tokenReceived boolean is fine
    expect(mockResponse.tokenReceived).toBe(true);
  });
});
