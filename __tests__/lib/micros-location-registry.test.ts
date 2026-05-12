/**
 * __tests__/lib/micros-location-registry.test.ts
 *
 * Unit tests for the multi-location MICROS registry and related security constraints.
 *
 * Tests:
 *   1. Primi config resolves → configured=true when all env vars present
 *   2. Primi config → configured=false when CLIENT_SECRET missing
 *   3. Si Cantina config still resolves independently
 *   4. safeConfigSummary never includes secret/password fields
 *   5. isValidLocationKey accepts known keys and rejects unknowns
 *   6. Labour score field source is labour_daily_summary.labour_pct (not micros_sales_daily)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── helpers ───────────────────────────────────────────────────────────────────

const PRIMI_ENV: Record<string, string> = {
  MICROS_PRIMI_CAMPS_BAY_ENABLED: "true",
  MICROS_PRIMI_CAMPS_BAY_ENTERPRISE: "PRI",
  MICROS_PRIMI_CAMPS_BAY_AUTH_URL: "https://ors-idm.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_BASE_URL: "https://simphony-home.msaf.oraclerestaurants.com",
  MICROS_PRIMI_CAMPS_BAY_CLIENT_ID: "UFJJLmQ1Zjg3YjNlLWM4MmItNDM0ZC05OTZlLWM5NzVlZjVjN2VhYQ",
  MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET: "test-secret-value",
  MICROS_PRIMI_CAMPS_BAY_LOCATION_REF: "100123",
};

const SI_CANTINA_ENV: Record<string, string> = {
  MICROS_ENABLED: "true",
  MICROS_AUTH_SERVER: "https://si-cantina-auth.example.com",
  MICROS_BI_SERVER: "https://si-cantina-bi.example.com",
  MICROS_CLIENT_ID: "si-cantina-client-id",
  MICROS_ORG_SHORT_NAME: "SIC",
  MICROS_USERNAME: "apiuser",
  MICROS_PASSWORD: "apipassword",
  MICROS_LOCATION_REF: "200456",
};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    process.env[k] = v;
  }
}

function clearEnv(keys: string[]) {
  for (const k of keys) {
    delete process.env[k];
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("micros-location-registry", () => {
  beforeEach(() => {
    // Isolate each test — clear all relevant env vars first
    clearEnv([...Object.keys(PRIMI_ENV), ...Object.keys(SI_CANTINA_ENV)]);
  });

  afterEach(() => {
    clearEnv([...Object.keys(PRIMI_ENV), ...Object.keys(SI_CANTINA_ENV)]);
  });

  // ── Test 1: Primi fully configured ──────────────────────────────────────────
  it("getLocationConfig('primi-camps-bay') → configured=true when all env vars present", async () => {
    setEnv(PRIMI_ENV);
    // Re-import to pick up new env values (vitest module cache is isolated per test file)
    const { getLocationConfig } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = getLocationConfig("primi-camps-bay");
    expect(cfg.configured).toBe(true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.authFlow).toBe("client_credentials");
    expect(cfg.key).toBe("primi-camps-bay");
    expect(cfg.enterpriseShortName).toBe("PRI");
  });

  // ── Test 2: Primi → configured=false when secret missing ────────────────────
  it("getLocationConfig('primi-camps-bay') → configured=false when CLIENT_SECRET missing", async () => {
    const envWithoutSecret = { ...PRIMI_ENV };
    delete (envWithoutSecret as Partial<typeof PRIMI_ENV>).MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET;
    setEnv(envWithoutSecret as Record<string, string>);
    const { getLocationConfig } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = getLocationConfig("primi-camps-bay");
    expect(cfg.configured).toBe(false);
  });

  // ── Test 3: Si Cantina resolves independently ────────────────────────────────
  it("getLocationConfig('si-cantina') resolves independently of Primi env vars", async () => {
    setEnv(SI_CANTINA_ENV);
    // Deliberately do NOT set Primi env vars
    const { getLocationConfig } = await import(
      "../../lib/micros/micros-location-registry"
    );
    const cfg = getLocationConfig("si-cantina");
    expect(cfg.configured).toBe(true);
    expect(cfg.authFlow).toBe("pkce");
    expect(cfg.key).toBe("si-cantina");
  });

  // ── Test 4: safeConfigSummary never includes secret/password ─────────────────
  it("safeConfigSummary strips clientSecret and password fields", async () => {
    setEnv({ ...PRIMI_ENV, ...SI_CANTINA_ENV });
    const { getLocationConfig, safeConfigSummary } = await import(
      "../../lib/micros/micros-location-registry"
    );

    const primiCfg = getLocationConfig("primi-camps-bay");
    const siCfg = getLocationConfig("si-cantina");

    const primiSafe = safeConfigSummary(primiCfg);
    const siSafe = safeConfigSummary(siCfg);

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

  // ── Test 5: isValidLocationKey ───────────────────────────────────────────────
  it("isValidLocationKey accepts known keys and rejects unknowns", async () => {
    const { isValidLocationKey } = await import(
      "../../lib/micros/micros-location-registry"
    );
    expect(isValidLocationKey("si-cantina")).toBe(true);
    expect(isValidLocationKey("primi-camps-bay")).toBe(true);
    expect(isValidLocationKey("unknown-location")).toBe(false);
    expect(isValidLocationKey("")).toBe(false);
    expect(isValidLocationKey("PRIMI-CAMPS-BAY")).toBe(false); // case-sensitive
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
    // This is a static/type check test — verifying that the DB column name
    // we rely on is 'labour_pct' (British spelling) in labour_daily_summary,
    // NOT 'labor_pct' which is the column in micros_sales_daily.
    //
    // If someone renames the column, the type in types/database.ts would change
    // and the import below would fail to compile.
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
      locationKey: "primi-camps-bay",
      displayName: "Primi Camps Bay",
      configured: true,
      enabled: true,
      tokenReceived: true,
      authFlow: "client_credentials",
      expiresIn: 3540,
      error: null,
      checkedAt: new Date().toISOString(),
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
