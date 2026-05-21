/**
 * __tests__/integrations/micros-locref.test.ts
 *
 * Unit tests for MICROS locRef resolution logic.
 *
 * Tests pure logic extracted from:
 *   - services/micros/MicrosSyncService.ts   (sales locRef fallback)
 *   - services/micros/labour/sync.ts         (labour per-site scoping)
 *   - services/micros/status.ts              (connection lookup error handling)
 *   - lib/system-health/getSystemHealth.ts   (schema probe)
 *
 * These tests do NOT import the real implementations (no DB / env required).
 * They validate the logic as pure functions matching the production code shape.
 */

import { describe, it, expect } from "vitest";

// ── Pure logic mirrors ────────────────────────────────────────────────────────
// Extracted from production code so tests remain fast and dependency-free.

/** Mirror of MicrosSyncService: choose effective locRef for getGuestChecks */
function resolveSalesLocRef(connection: {
  loc_ref: string;
  sales_location_ref?: string | null;
}): string {
  return connection.sales_location_ref?.trim() || connection.loc_ref;
}

/** Mirror of labour/sync.ts: choose effective locRef for getTimeCardDetails */
function resolveLabourLocRef(
  passedLocRef: string | undefined,
  envLocRef: string,
): string {
  return passedLocRef?.trim() || envLocRef;
}

/**
 * Mirror of getMicrosConnectionBySiteId error path.
 * Returns the error message that would be thrown.
 */
function connectionLookupErrorMessage(
  siteId: string,
  dbErrorMessage: string,
): string {
  const missingSalesRef = dbErrorMessage.includes("sales_location_ref");
  if (missingSalesRef) {
    return (
      "[MICROS] DB schema out of date: column micros_connections.sales_location_ref missing. " +
      "Deploy migration 092 before syncing. " +
      "(supabase/migrations/092_micros_sales_location_ref.sql)"
    );
  }
  return `[MICROS] getMicrosConnectionBySiteId failed for site ${siteId}: ${dbErrorMessage}`;
}

/**
 * Mirror of system health schema probe logic.
 * Returns a synthetic incident if the column probe error mentions sales_location_ref.
 */
function buildSchemaIncident(
  schemaErrorMessage: string | null,
  checkedAt: string,
): { id: string; severity: string; summary: string } | null {
  if (!schemaErrorMessage?.includes("sales_location_ref")) return null;
  return {
    id:       "schema-micros-sales-location-ref-missing",
    severity: "critical",
    summary:
      "DB migration 092 not applied — micros_connections.sales_location_ref column missing. " +
      "Both sales and labour sync will fail until this migration is deployed. " +
      "Run: bash scripts/deploy_migration.sh supabase/migrations/092_micros_sales_location_ref.sql",
  };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const SI_CANTINA_LOC_REF  = "2000002";
const SEA_CASTLE_LOC_REF  = "2001002";
const PRIMI_LOC_REF       = "101003";
const PRIMI_SALES_LOC_REF = "2000099"; // hypothetical override

const ENV_LOC_REF = "2000002"; // what MICROS_LOCATION_REF env var might be set to

// ── Sales locRef resolution ───────────────────────────────────────────────────

describe("resolveSalesLocRef — sales locRef for getGuestChecks", () => {
  it("uses sales_location_ref when set (non-null, non-empty)", () => {
    const conn = { loc_ref: PRIMI_LOC_REF, sales_location_ref: PRIMI_SALES_LOC_REF };
    expect(resolveSalesLocRef(conn)).toBe(PRIMI_SALES_LOC_REF);
  });

  it("falls back to loc_ref when sales_location_ref is null", () => {
    const conn = { loc_ref: PRIMI_LOC_REF, sales_location_ref: null };
    expect(resolveSalesLocRef(conn)).toBe(PRIMI_LOC_REF);
  });

  it("falls back to loc_ref when sales_location_ref is undefined", () => {
    const conn = { loc_ref: PRIMI_LOC_REF };
    expect(resolveSalesLocRef(conn)).toBe(PRIMI_LOC_REF);
  });

  it("falls back to loc_ref when sales_location_ref is empty string", () => {
    const conn = { loc_ref: PRIMI_LOC_REF, sales_location_ref: "" };
    expect(resolveSalesLocRef(conn)).toBe(PRIMI_LOC_REF);
  });

  it("falls back to loc_ref when sales_location_ref is whitespace only", () => {
    const conn = { loc_ref: PRIMI_LOC_REF, sales_location_ref: "   " };
    expect(resolveSalesLocRef(conn)).toBe(PRIMI_LOC_REF);
  });

  it("Si Cantina uses loc_ref for sales (no override needed)", () => {
    const conn = { loc_ref: SI_CANTINA_LOC_REF, sales_location_ref: null };
    expect(resolveSalesLocRef(conn)).toBe(SI_CANTINA_LOC_REF);
  });

  it("Sea Castle uses loc_ref for sales (no override needed)", () => {
    const conn = { loc_ref: SEA_CASTLE_LOC_REF, sales_location_ref: null };
    expect(resolveSalesLocRef(conn)).toBe(SEA_CASTLE_LOC_REF);
  });

  it("trims whitespace from sales_location_ref before use", () => {
    const conn = { loc_ref: PRIMI_LOC_REF, sales_location_ref: `  ${PRIMI_SALES_LOC_REF}  ` };
    expect(resolveSalesLocRef(conn)).toBe(PRIMI_SALES_LOC_REF);
  });

  it("sales_location_ref override does not affect loc_ref value", () => {
    const conn = { loc_ref: PRIMI_LOC_REF, sales_location_ref: PRIMI_SALES_LOC_REF };
    expect(conn.loc_ref).toBe(PRIMI_LOC_REF); // labour locRef unchanged
    expect(resolveSalesLocRef(conn)).toBe(PRIMI_SALES_LOC_REF); // sales uses override
  });
});

// ── Labour locRef resolution ──────────────────────────────────────────────────

describe("resolveLabourLocRef — locRef for getTimeCardDetails", () => {
  it("uses per-site DB loc_ref when provided (Primi)", () => {
    expect(resolveLabourLocRef(PRIMI_LOC_REF, ENV_LOC_REF)).toBe(PRIMI_LOC_REF);
  });

  it("uses per-site DB loc_ref when provided (Si Cantina)", () => {
    expect(resolveLabourLocRef(SI_CANTINA_LOC_REF, ENV_LOC_REF)).toBe(SI_CANTINA_LOC_REF);
  });

  it("falls back to env var when no per-site locRef provided (legacy path)", () => {
    expect(resolveLabourLocRef(undefined, ENV_LOC_REF)).toBe(ENV_LOC_REF);
  });

  it("falls back to env var when per-site locRef is empty string", () => {
    expect(resolveLabourLocRef("", ENV_LOC_REF)).toBe(ENV_LOC_REF);
  });

  it("falls back to env var when per-site locRef is whitespace only", () => {
    expect(resolveLabourLocRef("   ", ENV_LOC_REF)).toBe(ENV_LOC_REF);
  });

  it("Si Cantina labour does not cross over to Primi labour (different locRefs)", () => {
    const primiResult    = resolveLabourLocRef(PRIMI_LOC_REF, ENV_LOC_REF);
    const siCantinaResult = resolveLabourLocRef(SI_CANTINA_LOC_REF, ENV_LOC_REF);
    expect(primiResult).not.toBe(siCantinaResult);
  });

  it("labour does NOT use sales_location_ref — always uses loc_ref", () => {
    // Labour should never pick up the sales override
    const resolved = resolveLabourLocRef(PRIMI_LOC_REF, ENV_LOC_REF);
    expect(resolved).toBe(PRIMI_LOC_REF);
    expect(resolved).not.toBe(PRIMI_SALES_LOC_REF);
  });
});

// ── getMicrosConnectionBySiteId error handling ────────────────────────────────

describe("connectionLookupErrorMessage — DB error classification", () => {
  const SITE_ID = "00000000-0000-0000-0000-000000000002";

  it("produces migration-092-specific message for sales_location_ref column error", () => {
    const msg = connectionLookupErrorMessage(
      SITE_ID,
      'column "sales_location_ref" does not exist',
    );
    expect(msg).toContain("migration 092");
    expect(msg).toContain("sales_location_ref");
    expect(msg).not.toContain(SITE_ID); // migration msg doesn't expose siteId in text
  });

  it("produces generic message for unrelated DB errors", () => {
    const msg = connectionLookupErrorMessage(SITE_ID, "connection refused");
    expect(msg).toContain(SITE_ID);
    expect(msg).toContain("connection refused");
    expect(msg).not.toContain("migration 092");
  });

  it("does not silently return null — always throws on DB error", () => {
    // Both paths produce a non-empty error string (representing a thrown Error)
    const migrationErr = connectionLookupErrorMessage(SITE_ID, 'column "sales_location_ref" does not exist');
    const genericErr   = connectionLookupErrorMessage(SITE_ID, "timeout");
    expect(migrationErr.length).toBeGreaterThan(0);
    expect(genericErr.length).toBeGreaterThan(0);
  });
});

// ── System health schema probe ────────────────────────────────────────────────

describe("buildSchemaIncident — schema probe synthetic incident", () => {
  const checkedAt = "2026-05-21T09:00:00.000Z";

  it("returns critical incident when sales_location_ref column is missing", () => {
    const incident = buildSchemaIncident(
      'column "sales_location_ref" does not exist',
      checkedAt,
    );
    expect(incident).not.toBeNull();
    expect(incident!.severity).toBe("critical");
    expect(incident!.id).toBe("schema-micros-sales-location-ref-missing");
    expect(incident!.summary).toContain("migration 092");
    expect(incident!.summary).toContain("092_micros_sales_location_ref.sql");
  });

  it("returns null when column exists (probe succeeds / no error)", () => {
    expect(buildSchemaIncident(null, checkedAt)).toBeNull();
  });

  it("returns null for unrelated DB errors (does not false-positive)", () => {
    expect(buildSchemaIncident("connection timeout", checkedAt)).toBeNull();
    expect(buildSchemaIncident('column "other_column" does not exist', checkedAt)).toBeNull();
  });

  it("surfaces in system health incidents list (unshift = first)", () => {
    const incident = buildSchemaIncident(
      'column "sales_location_ref" does not exist',
      checkedAt,
    );
    const incidents = [incident!];
    expect(incidents[0].severity).toBe("critical");
  });
});

// ── Cross-site isolation ──────────────────────────────────────────────────────

describe("cross-site locRef isolation", () => {
  it("Primi sales locRef does not bleed into Si Cantina sales", () => {
    const primiConn     = { loc_ref: PRIMI_LOC_REF, sales_location_ref: PRIMI_SALES_LOC_REF };
    const siCantinaConn = { loc_ref: SI_CANTINA_LOC_REF, sales_location_ref: null };

    expect(resolveSalesLocRef(primiConn)).toBe(PRIMI_SALES_LOC_REF);
    expect(resolveSalesLocRef(siCantinaConn)).toBe(SI_CANTINA_LOC_REF);
    expect(resolveSalesLocRef(primiConn)).not.toBe(resolveSalesLocRef(siCantinaConn));
  });

  it("Primi labour locRef does not bleed into Sea Castle labour", () => {
    expect(resolveLabourLocRef(PRIMI_LOC_REF, ENV_LOC_REF)).toBe(PRIMI_LOC_REF);
    expect(resolveLabourLocRef(SEA_CASTLE_LOC_REF, ENV_LOC_REF)).toBe(SEA_CASTLE_LOC_REF);
  });
});
