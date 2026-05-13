/**
 * scripts/backfill-sea-castle-30-days.ts
 *
 * Backfills 30 days of sales + labour data for Sea Castle Hotel Camps Bay.
 *
 * Sea Castle shares MICROS auth credentials with Si Cantina.
 * Only the location ref differs (2001002).
 *
 * Usage:  npm run micros:backfill:sea-castle
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
import { runLocationSync }  from "../services/micros/location-sync";

const KEY = "sea-castle-camps-bay";

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

// Build 30-day list ending yesterday
const dates: string[] = [];
for (let i = 30; i >= 1; i--) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  dates.push(d.toISOString().slice(0, 10));
}

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  Sea Castle Hotel Camps Bay — 30-day backfill`);
console.log(`  Location ref : ${cfg.locationRef}`);
console.log(`  Dates        : ${dates[0]} → ${dates[dates.length - 1]}`);
console.log(`═══════════════════════════════════════════════\n`);

async function main() {
  let ok = 0, fail = 0;

  for (const date of dates) {
    process.stdout.write(`  ${date} … `);
    try {
      const r = await runLocationSync(cfg, date);
      if (r.success) {
        console.log(`✅  sales:${r.salesChecks ?? 0}  labour:${r.labourTimecards ?? 0}`);
        ok++;
      } else {
        console.log(`⚠️  ${r.message}`);
        fail++;
      }
    } catch (e: unknown) {
      console.log(`❌  ${e instanceof Error ? e.message : String(e)}`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n  Done: ${ok} OK, ${fail} failed`);
  console.log(`═══════════════════════════════════════════════\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
