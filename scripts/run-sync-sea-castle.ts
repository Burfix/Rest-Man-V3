/**
 * scripts/run-sync-sea-castle.ts
 *
 * Runs a full sales + labour sync for Sea Castle Hotel Camps Bay for a given date.
 *
 * Sea Castle shares MICROS auth credentials with Si Cantina.
 * Only the location ref differs (2001002).
 *
 * Usage:  npm run micros:sync:sea-castle [YYYY-MM-DD]
 * Example: npm run micros:sync:sea-castle 2026-05-13
 *
 * Requires .env.local with:
 *   MICROS_* (Si Cantina shared credentials)
 *   MICROS_SEA_CASTLE_ENABLED=true
 *   MICROS_SEA_CASTLE_LOCATION_REF=2001002
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.production.local" });

import { getLocationConfig, validateLocationRefUniqueness } from "../lib/micros/micros-location-registry";
import { runLocationSync }   from "../services/micros/location-sync";

const KEY          = "sea-castle-camps-bay";
const argDate      = process.argv[2];
const businessDate = argDate ?? (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
})();

console.log("\n══════════════════════════════════════════════");
console.log("  Sea Castle Hotel Camps Bay — MICROS Sync");
console.log("══════════════════════════════════════════════");
console.log(`  Business date: ${businessDate}\n`);

// Validate no duplicate location refs before proceeding
const conflicts = validateLocationRefUniqueness();
if (conflicts.length > 0) {
  for (const c of conflicts) {
    console.error(
      `❌  MICROS location ref conflict detected: locRef "${c.locationRef}" shared by ${c.keys.join(", ")}`,
    );
  }
  process.exit(1);
}

const cfg = getLocationConfig(KEY);

if (!cfg.configured) {
  console.error("❌ Location not configured — missing env vars.");
  console.error("   Required: MICROS_AUTH_SERVER, MICROS_BI_SERVER, MICROS_CLIENT_ID,");
  console.error("             MICROS_USERNAME, MICROS_PASSWORD, MICROS_ORG_SHORT_NAME,");
  console.error("             MICROS_SEA_CASTLE_LOCATION_REF");
  process.exit(1);
}

if (!cfg.enabled) {
  console.warn("⚠️  Sea Castle is disabled (MICROS_SEA_CASTLE_ENABLED != true). Exiting.");
  process.exit(0);
}

console.log(`  Location ref : ${cfg.locationRef}`);
console.log(`  Enterprise   : ${cfg.enterpriseShortName}`);
console.log(`  Auth URL     : ${cfg.authUrl}`);
console.log();

async function main() {
  const result = await runLocationSync(cfg, businessDate);

  if (result.success) {
    console.log(`✅  Sync complete`);
    console.log(`    Sales checks  : ${result.salesChecks ?? 0}`);
    console.log(`    Labour timecards: ${result.labourTimecards ?? 0}`);
  } else {
    console.error(`❌  Sync failed: ${result.message}`);
    if (result.errors.length > 0) {
      console.error("   Errors:");
      for (const e of result.errors) console.error(`     · ${e}`);
    }
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
