/**
 * scripts/verify-sites.ts
 *
 * Post-deploy verification for the Head Office Sites Overview.
 * Runs a series of checks against the production Supabase DB to confirm
 * all expected sites are visible, connected, and have real data.
 *
 * Usage:
 *   npm run verify:sites
 *
 * Exit codes:
 *   0  — all checks passed
 *   1  — one or more checks failed (details printed to stdout)
 *
 * Requires .env.local or .env.production.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.production.local" });

import { createClient } from "@supabase/supabase-js";

// ── Config ────────────────────────────────────────────────────────────────────

const EXPECTED_SITES: Array<{
  name:       string;
  id:         string;
  storeCode:  string | null;
  isSandbox:  boolean;
  hasRevenue: boolean;   // expect revenue rows in micros_sales_daily
  hasLabour:  boolean;   // expect rows in labour_daily_summary
  hasMicros:  boolean;   // expect a micros_connections row
}> = [
  {
    name:       "Si Cantina Sociale",
    id:         "00000000-0000-0000-0000-000000000001",
    storeCode:  "SC-SOC",
    isSandbox:  false,
    hasRevenue: true,
    hasLabour:  true,
    hasMicros:  true,
  },
  {
    name:       "Sea Castle Hotel",
    id:         "00000000-0000-0000-0000-000000000004",
    storeCode:  "SEA-CT",
    isSandbox:  false,
    hasRevenue: true,
    hasLabour:  true,
    hasMicros:  true,
  },
  {
    name:       "Primi Camps Bay",
    id:         "00000000-0000-0000-0000-000000000003",
    storeCode:  "PRIMI-CB",
    isSandbox:  false,
    hasRevenue: true,
    hasLabour:  true,
    hasMicros:  true,
  },
  {
    name:       "Test Store (Sandbox)",
    id:         "00000000-0000-0000-0000-00000000ff01",
    storeCode:  "TEST-01",
    isSandbox:  true,
    hasRevenue: false,   // sandbox has no real MICROS data
    hasLabour:  false,
    hasMicros:  false,
  },
];

const EXPECTED_ACTIVE_COUNT = 4;
// MICROS connections that must not be in error state
const ACCEPTABLE_MICROS_STATUSES = new Set(["connected", "syncing", "pending"]);

// ── Check helpers ─────────────────────────────────────────────────────────────

type Result = { label: string; pass: boolean; detail?: string };

function pass(label: string, detail?: string): Result {
  return { label, pass: true, detail };
}
function fail(label: string, detail: string): Result {
  return { label, pass: false, detail };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const results: Result[] = [];

  // ── Check 1: Total active sites ─────────────────────────────────────────────

  const { data: activeSites, error: activeErr } = await db
    .from("sites")
    .select("id, name, store_code, is_active")
    .eq("is_active", true);

  if (activeErr) {
    results.push(fail("Total active sites query", activeErr.message));
  } else {
    const count = activeSites?.length ?? 0;
    results.push(
      count >= EXPECTED_ACTIVE_COUNT
        ? pass(`Total active sites = ${count}`, `(expected ≥ ${EXPECTED_ACTIVE_COUNT})`)
        : fail(`Total active sites = ${count}`, `expected ≥ ${EXPECTED_ACTIVE_COUNT}`),
    );
  }

  // ── Check 2: Each expected site ─────────────────────────────────────────────

  for (const expected of EXPECTED_SITES) {
    const site = activeSites?.find((s) => s.id === expected.id);

    if (!site) {
      results.push(fail(`${expected.name} — is_active`, `Site ${expected.id} not found or not active`));
      continue;
    }

    results.push(pass(`${expected.name} — is_active`, `store_code=${site.store_code ?? "null"}`));

    // store_code match
    if (expected.storeCode && site.store_code !== expected.storeCode) {
      results.push(
        fail(
          `${expected.name} — store_code`,
          `expected ${expected.storeCode}, got ${site.store_code ?? "null"}`,
        ),
      );
    } else if (expected.storeCode) {
      results.push(pass(`${expected.name} — store_code`, site.store_code ?? ""));
    }
  }

  // ── Check 3: MICROS connection rows ─────────────────────────────────────────

  const { data: connRows, error: connErr } = await db
    .from("micros_connections")
    .select("site_id, loc_ref, status, last_successful_sync_at");

  if (connErr) {
    results.push(fail("micros_connections query", connErr.message));
  } else {
    const connBySite = new Map(
      (connRows ?? []).map((c) => [c.site_id as string, c]),
    );

    for (const expected of EXPECTED_SITES) {
      if (!expected.hasMicros) continue;
      const conn = connBySite.get(expected.id);

      if (!conn) {
        results.push(fail(`${expected.name} — MICROS connection row`, "missing from micros_connections"));
        continue;
      }

      if (!ACCEPTABLE_MICROS_STATUSES.has(conn.status)) {
        results.push(
          fail(
            `${expected.name} — MICROS status`,
            `status = '${conn.status}' (expected: connected | syncing | pending)`,
          ),
        );
      } else {
        results.push(pass(`${expected.name} — MICROS status`, `${conn.status}, loc_ref=${conn.loc_ref}`));
      }

      // Warn if no sync in >48h (not a hard fail — could be new site)
      if (conn.last_successful_sync_at) {
        const ageH = (Date.now() - new Date(conn.last_successful_sync_at).getTime()) / 3_600_000;
        if (ageH > 48) {
          results.push(
            fail(
              `${expected.name} — MICROS last sync`,
              `${Math.round(ageH)}h since last sync (threshold: 48h)`,
            ),
          );
        } else {
          results.push(
            pass(`${expected.name} — MICROS last sync`, `${Math.round(ageH)}h ago`),
          );
        }
      } else {
        results.push(fail(`${expected.name} — MICROS last sync`, "never synced"));
      }
    }
  }

  // ── Check 4: Revenue rows in micros_sales_daily ───────────────────────────

  for (const expected of EXPECTED_SITES) {
    if (!expected.hasRevenue) continue;

    const conn = (connRows ?? []).find((c) => c.site_id === expected.id);
    if (!conn?.loc_ref) {
      results.push(fail(`${expected.name} — sales data`, "no loc_ref to query against"));
      continue;
    }

    const { count, error: salesErr } = await db
      .from("micros_sales_daily")
      .select("*", { count: "exact", head: true })
      .eq("loc_ref", conn.loc_ref);

    if (salesErr) {
      results.push(fail(`${expected.name} — sales data query`, salesErr.message));
    } else if ((count ?? 0) === 0) {
      results.push(fail(`${expected.name} — sales data`, `0 rows in micros_sales_daily (loc_ref=${conn.loc_ref})`));
    } else {
      results.push(pass(`${expected.name} — sales data`, `${count} rows (loc_ref=${conn.loc_ref})`));
    }
  }

  // ── Check 5: Labour rows ─────────────────────────────────────────────────

  for (const expected of EXPECTED_SITES) {
    if (!expected.hasLabour) continue;

    const conn = (connRows ?? []).find((c) => c.site_id === expected.id);
    if (!conn?.loc_ref) {
      results.push(fail(`${expected.name} — labour data`, "no loc_ref to query against"));
      continue;
    }

    const { count, error: labourErr } = await db
      .from("labour_daily_summary")
      .select("*", { count: "exact", head: true })
      .eq("loc_ref", conn.loc_ref);

    if (labourErr) {
      results.push(fail(`${expected.name} — labour data query`, labourErr.message));
    } else if ((count ?? 0) === 0) {
      results.push(fail(`${expected.name} — labour data`, `0 rows in labour_daily_summary (loc_ref=${conn.loc_ref})`));
    } else {
      results.push(pass(`${expected.name} — labour data`, `${count} rows (loc_ref=${conn.loc_ref})`));
    }
  }

  // ── Check 6: No site returns health = UNKNOWN from v_micros_system_health ──

  const { data: healthRows, error: healthErr } = await db
    .from("v_micros_system_health")
    .select("site_id, connection_status, data_age_minutes");

  if (healthErr) {
    results.push(fail("v_micros_system_health query", healthErr.message));
  } else {
    for (const expected of EXPECTED_SITES) {
      if (expected.isSandbox) continue;
      const h = (healthRows ?? []).find((r) => r.site_id === expected.id);
      if (!h) {
        results.push(fail(`${expected.name} — health view`, "not returned by v_micros_system_health"));
      } else if (h.connection_status === "error") {
        results.push(fail(`${expected.name} — health view`, `connection_status = error`));
      } else {
        results.push(
          pass(
            `${expected.name} — health view`,
            `status=${h.connection_status}, age=${h.data_age_minutes ?? "?"}min`,
          ),
        );
      }
    }
  }

  // ── Check 7: Sandbox site exists + is active ─────────────────────────────

  const sandbox = activeSites?.find((s) => s.store_code === "TEST-01");
  if (!sandbox) {
    results.push(fail("Sandbox site — active", "TEST-01 not found in active sites"));
  } else {
    results.push(pass("Sandbox site — active", `name=${sandbox.name}`));
  }

  // ── Print results ─────────────────────────────────────────────────────────

  const width = 60;
  console.log("\n" + "═".repeat(width));
  console.log(" ForgeStack — Site Verification");
  console.log("═".repeat(width));

  let failures = 0;
  for (const r of results) {
    const icon   = r.pass ? "✓" : "✗";
    const detail = r.detail ? `  (${r.detail})` : "";
    console.log(`  ${icon}  ${r.label}${detail}`);
    if (!r.pass) failures++;
  }

  console.log("─".repeat(width));
  if (failures === 0) {
    console.log(`  ✓  All ${results.length} checks passed\n`);
  } else {
    console.log(`  ✗  ${failures} of ${results.length} checks FAILED\n`);
  }
  console.log("═".repeat(width) + "\n");

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
