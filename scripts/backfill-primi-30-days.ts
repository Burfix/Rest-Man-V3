/**
 * scripts/backfill-primi-30-days.ts
 * Backfills last 30 days of sales + labour for Primi Camps Bay.
 * Usage: npm run micros:backfill:primi
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.production.local" });

import { getLocationConfig } from "../lib/micros/micros-location-registry";
import { runLocationSync }   from "../services/micros/location-sync";

async function main() {
  const cfg = await getLocationConfig("primi-camps-bay");

  if (!cfg.configured) { console.error("❌ Not configured"); process.exit(1); }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing Supabase keys"); process.exit(1);
  }

  const DAYS = 30;
  const dates: string[] = [];
  for (let i = 1; i <= DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Primi Camps Bay — 30-day backfill`);
  console.log(`  Dates: ${dates[dates.length-1]} → ${dates[0]}`);
  console.log(`═══════════════════════════════════════════════\n`);

  let ok = 0, fail = 0;
  for (const date of dates.reverse()) { // oldest first
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
    // Small delay to avoid hammering Oracle IDM
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n  Done: ${ok} OK, ${fail} failed`);
  console.log(`═══════════════════════════════════════════════\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
