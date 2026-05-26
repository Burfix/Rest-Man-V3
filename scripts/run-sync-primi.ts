/**
 * scripts/run-sync-primi.ts
 *
 * Runs a full sales + labour sync for Primi Camps Bay for a given date.
 * Usage:  npm run micros:sync:primi [YYYY-MM-DD]
 * Example: npm run micros:sync:primi 2026-05-12
 *
 * Requires .env.local with both MICROS_PRIMI_CAMPS_BAY_* and Supabase vars.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.production.local" });

import { getLocationConfig } from "../lib/micros/micros-location-registry";
import { runLocationSync }   from "../services/micros/location-sync";

const KEY          = "primi-camps-bay";
const argDate      = process.argv[2];
const businessDate = argDate ?? (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
})();

console.log("\n══════════════════════════════════════════════");
console.log("  Primi Camps Bay — MICROS Sync");
console.log("══════════════════════════════════════════════");
console.log(`  Business date: ${businessDate}\n`);

async function main() {
  const cfg = await getLocationConfig(KEY);

  if (!cfg.configured) {
    console.error("❌ Location not configured — missing env vars.");
    process.exit(1);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const result = await runLocationSync(cfg, businessDate);

  console.log(`  Sales synced:    ${result.salesSynced ? "✅" : "❌"}  (${result.salesChecks ?? 0} checks)`);
  console.log(`  Labour synced:   ${result.labourSynced ? "✅" : "❌"}  (${result.labourTimecards ?? 0} timecards)`);

  if (result.errors.length > 0) {
    console.log("\n  Errors:");
    for (const e of result.errors) console.log("   ⚠️  " + e);
  }

  console.log(`\n  ${result.success ? "✅ Sync complete" : "❌ Sync failed"}: ${result.message}`);
  console.log("══════════════════════════════════════════════\n");

  if (!result.success) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
