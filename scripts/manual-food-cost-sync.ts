/**
 * Manual Food Cost Sync from MICROS BI API
 * 
 * Usage:
 *   npx tsx scripts/manual-food-cost-sync.ts [YYYY-MM-DD]
 * 
 * Syncs menu item dimensions + daily food cost data (prepCost) from
 * the BI API getMenuItemDimensions / getMenuItemDailyTotals endpoints.
 * 
 * Defaults to yesterday's date if no argument given (today may not be complete).
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env.production.local") });

// Fix trailing \n from Vercel CLI-generated .env.production.local
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (process.env[key]) process.env[key] = process.env[key]!.replace(/\\n$/g, "").trim();
}

import { syncFoodCostFromBI } from "../services/micros/foodCostSync";

const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";
const LOC_REF = process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "2000002";

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

async function main() {
  const businessDate = process.argv[2] || yesterday();
  console.log(`\n🍽️  Food Cost Sync — ${businessDate}`);
  console.log(`   Site: ${DEFAULT_SITE_ID}`);
  console.log(`   LocRef: ${LOC_REF}\n`);

  const result = await syncFoodCostFromBI({
    siteId: DEFAULT_SITE_ID,
    locRef: LOC_REF,
    businessDate,
    syncDimensions: true,
    actorUserId: "manual-cli",
  });

  if (result.ok) {
    console.log(`✅ Sync complete in ${result.durationMs}ms`);
    console.log(`   Menu items synced: ${result.dimensionsSynced}`);
    console.log(`   Item costs synced: ${result.itemCostsSynced}`);
    console.log(`   Total Sales: R${result.totalSales.toLocaleString()}`);
    console.log(`   Total Prep Cost: R${result.totalPrepCost.toLocaleString()}`);
    console.log(`   Food Cost %: ${result.foodCostPct !== null ? result.foodCostPct.toFixed(1) + "%" : "N/A"}`);
  } else {
    console.error(`❌ Sync failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
