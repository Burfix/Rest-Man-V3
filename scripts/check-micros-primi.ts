/**
 * Primi Camps Bay MICROS Integration Health Check
 * Usage: npx tsx scripts/check-micros-primi.ts
 *
 * Checks:
 *   - Environment variable presence (secrets masked as ****)
 *   - Token acquisition (pass/fail — token never printed)
 *   - Latest micros_sales_daily row for this location
 *   - Latest labour_daily_summary row for this location
 *   - micros_connections status for primi-camps-bay
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env.production.local") });

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  if (process.env[key])
    process.env[key] = process.env[key]!.replace(/\\n$/g, "").trim();
}

function present(val: string | undefined): string {
  return val && val.trim() ? "✅ present" : "❌ MISSING";
}

function masked(val: string | undefined): string {
  return val && val.trim() ? "✅ present (****)" : "❌ MISSING";
}

async function main() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  Primi Camps Bay MICROS Integration Check");
  console.log("══════════════════════════════════════════════\n");

  // ── 1. Env var presence ──────────────────────────────────────────
  const enabled = process.env.MICROS_PRIMI_CAMPS_BAY_ENABLED;
  const enterprise = process.env.MICROS_PRIMI_CAMPS_BAY_ENTERPRISE;
  const authUrl = process.env.MICROS_PRIMI_CAMPS_BAY_AUTH_URL;
  const baseUrl = process.env.MICROS_PRIMI_CAMPS_BAY_BASE_URL;
  const clientId = process.env.MICROS_PRIMI_CAMPS_BAY_CLIENT_ID;
  const clientSecret = process.env.MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET;
  const locationRef = process.env.MICROS_PRIMI_CAMPS_BAY_LOCATION_REF;

  console.log("── Environment Variables ──");
  console.log(`  ENABLED:        ${present(enabled)} (value: ${enabled ?? "undefined"})`);
  console.log(`  ENTERPRISE:     ${present(enterprise)} (value: ${enterprise ?? "undefined"})`);
  console.log(`  AUTH_URL:       ${present(authUrl)} (value: ${authUrl ?? "undefined"})`);
  console.log(`  BASE_URL:       ${present(baseUrl)} (value: ${baseUrl ?? "undefined"})`);
  console.log(`  CLIENT_ID:      ${present(clientId)}`);
  console.log(`  CLIENT_SECRET:  ${masked(clientSecret)}`);
  console.log(`  LOCATION_REF:   ${present(locationRef)} (value: ${locationRef ?? "undefined"})`);

  const allPresent =
    !!enabled?.trim() &&
    !!enterprise?.trim() &&
    !!authUrl?.trim() &&
    !!baseUrl?.trim() &&
    !!clientId?.trim() &&
    !!clientSecret?.trim() &&
    !!locationRef?.trim();

  console.log(`\n  Configured: ${allPresent ? "✅ YES" : "❌ NO (missing required vars above)"}`);

  if (!allPresent) {
    console.log(
      "\n⚠️  Cannot continue token test — required env vars are missing.\n"
    );
    process.exit(1);
  }

  // ── 2. Token acquisition ─────────────────────────────────────────
  console.log("\n── Token Acquisition ──");
  try {
    const { getLocationConfig } = await import(
      "../lib/micros/micros-location-registry"
    );
    const { clearLocationTokenCache, acquireLocationToken } = await import(
      "../lib/micros/location-auth"
    );

    const cfg = getLocationConfig("primi-camps-bay");

    if (!cfg.configured) {
      console.log("  ❌ Config reports configured=false");
    } else {
      clearLocationTokenCache("primi-camps-bay");
      const tokenSet = await acquireLocationToken(cfg);
      // Discard immediately — never print
      void tokenSet;
      console.log("  ✅ Token acquired successfully (token NOT printed)");
      console.log(
        `  Auth flow: ${cfg.authFlow} | Expires in ~${Math.round(
          ((tokenSet as any).expiresAt - Date.now()) / 1000
        )}s`
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ Token acquisition FAILED: ${message}`);
  }

  // ── 3. Supabase queries ──────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.log(
      "\n⚠️  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping DB checks.\n"
    );
    process.exit(0);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Connection row
  console.log("\n── micros_connections ──");
  const { data: conn, error: connErr } = await supabase
    .from("micros_connections")
    .select("id, status, loc_ref, last_sync_at, last_sync_error, last_successful_sync_at")
    .eq("location_key", "primi-camps-bay")
    .maybeSingle();

  if (connErr) {
    console.log(`  ❌ Query error: ${connErr.message}`);
  } else if (!conn) {
    console.log("  ⚠️  No micros_connections row found for location_key=primi-camps-bay");
    console.log("     Run migration 081_primi_camps_bay_connection.sql first.");
  } else {
    console.log(`  id:                    ${conn.id}`);
    console.log(`  status:                ${conn.status}`);
    console.log(`  loc_ref:               ${conn.loc_ref || "(not set yet)"}`);
    console.log(`  last_sync_at:          ${conn.last_sync_at ?? "never"}`);
    console.log(`  last_successful_sync:  ${conn.last_successful_sync_at ?? "never"}`);
    if (conn.last_sync_error) {
      console.log(`  last_sync_error:       ${conn.last_sync_error}`);
    }
  }

  // Latest sales
  console.log("\n── micros_sales_daily (latest row) ──");
  if (!locationRef) {
    console.log("  ⚠️  MICROS_PRIMI_CAMPS_BAY_LOCATION_REF not set — skipping sales check");
  } else {
    const { data: sales, error: salesErr } = await supabase
      .from("micros_sales_daily")
      .select("business_date, net_sales, check_count, guest_count, synced_at")
      .eq("loc_ref", locationRef)
      .order("business_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (salesErr) {
      console.log(`  ❌ Query error: ${salesErr.message}`);
    } else if (!sales) {
      console.log(`  ℹ️  No sales rows found for loc_ref=${locationRef} — sync hasn't run yet`);
    } else {
      console.log(`  Latest business_date: ${sales.business_date}`);
      console.log(`  net_sales:            ${sales.net_sales}`);
      console.log(`  check_count:          ${sales.check_count}`);
      console.log(`  guest_count:          ${sales.guest_count}`);
      console.log(`  synced_at:            ${sales.synced_at}`);
    }
  }

  // Latest labour
  console.log("\n── labour_daily_summary (latest row) ──");
  if (!locationRef) {
    console.log("  ⚠️  MICROS_PRIMI_CAMPS_BAY_LOCATION_REF not set — skipping labour check");
  } else {
    const { data: labour, error: labourErr } = await supabase
      .from("labour_daily_summary")
      .select("business_date, total_pay, total_hours, labour_pct, net_sales, synced_at")
      .eq("loc_ref", locationRef)
      .order("business_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (labourErr) {
      console.log(`  ❌ Query error: ${labourErr.message}`);
    } else if (!labour) {
      console.log(`  ℹ️  No labour_daily_summary rows for loc_ref=${locationRef} — sync hasn't run yet`);
    } else {
      console.log(`  Latest business_date: ${labour.business_date}`);
      console.log(`  total_pay:            ${labour.total_pay}`);
      console.log(`  total_hours:          ${labour.total_hours}`);
      console.log(
        `  labour_pct:           ${
          labour.labour_pct != null ? `${labour.labour_pct.toFixed(2)}%` : "null"
        }`
      );
      console.log(`  net_sales:            ${labour.net_sales ?? "null"}`);
      console.log(`  synced_at:            ${labour.synced_at}`);
    }
  }

  console.log("\n══════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n💥 Unhandled error:", err);
  process.exit(1);
});
