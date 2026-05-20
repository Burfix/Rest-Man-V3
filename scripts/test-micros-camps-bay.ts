/**
 * scripts/test-micros-camps-bay.ts
 *
 * End-to-end test: token + BIAPI guest checks + time cards for Primi Camps Bay.
 * Usage: npm run micros:test:primi
 *
 * SECURITY: Never logs tokens or passwords.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.production.local" });
import { getLocationConfig } from "../lib/micros/micros-location-registry";
import { acquireLocationToken } from "../lib/micros/location-auth";
import { fetchGuestChecks, fetchTimeCardDetails, fetchJobCodeDimensions } from "../lib/micros/location-client";

const KEY = "primi-camps-bay";

// Use yesterday as the test business date
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const businessDate = yesterday.toISOString().slice(0, 10);

console.log("\n══════════════════════════════════════════════");
console.log("  Primi Camps Bay — Full BIAPI Connection Test");
console.log("══════════════════════════════════════════════\n");
console.log(`  Business date under test: ${businessDate}\n`);

const cfg = getLocationConfig(KEY);

if (!cfg.configured) {
  console.error("❌ Location not configured — missing env vars. Run: npm run micros:check:primi");
  process.exit(1);
}

async function main() {
  // ── Step 1: Token ─────────────────────────────────────────────────────────
  process.stdout.write("── Step 1: Token acquisition … ");
  try {
    await acquireLocationToken(cfg);
    console.log("✅ OK");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`❌ FAILED\n  ${msg}`);
    process.exit(1);
  }

  // ── Step 2: Guest Checks (Sales) ──────────────────────────────────────────
  process.stdout.write("── Step 2: getGuestChecks … ");
  try {
    const data = await fetchGuestChecks(cfg, businessDate);
    const guestCheckCount = data.guestChecks?.length ?? 0;
    console.log(`✅ OK — ${guestCheckCount} guest check(s) returned`);
    if (guestCheckCount > 0) {
      const first = data.guestChecks![0] as Record<string, unknown>;
      const keys = Object.keys(first).slice(0, 6).join(", ");
      console.log(`     First record fields: ${keys}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`❌ FAILED\n  ${msg}`);
  }

  // ── Step 3: Time Cards (Labour) ───────────────────────────────────────────
  process.stdout.write("── Step 3: getTimeCardDetails … ");
  try {
    const data = await fetchTimeCardDetails(cfg, businessDate) as Record<string, unknown>;
    const keys = Object.keys(data);
    const entries = keys.includes("timeCards")
      ? `${(data.timeCards as unknown[])?.length ?? 0} time card(s)`
      : `keys: ${keys.slice(0, 5).join(", ")}`;
    console.log(`✅ OK — ${entries}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`❌ FAILED\n  ${msg}`);
  }

  // ── Step 4: Job Code Dimensions ───────────────────────────────────────────
  process.stdout.write("── Step 4: getJobCodeDimensions … ");
  try {
    const data = await fetchJobCodeDimensions(cfg) as Record<string, unknown>;
    const keys = Object.keys(data).slice(0, 5).join(", ");
    console.log(`✅ OK — response keys: ${keys}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`❌ FAILED\n  ${msg}`);
  }

  console.log("\n══════════════════════════════════════════════");
  console.log("  Test complete.");
  console.log("══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
