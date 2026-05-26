/**
 * scripts/test-scs-auth.ts
 * Quick diagnostic: test SCS PKCE auth with current env vars.
 * Run: npx tsx scripts/test-scs-auth.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.production.local" });
import { getLocationConfig } from "../lib/micros/micros-location-registry";
import { acquireLocationToken } from "../lib/micros/location-auth";

async function main() {
  const cfg = await getLocationConfig("si-cantina");
  console.log("─── Si Cantina config ───────────────────────────────────");
  console.log("  configured     :", cfg.configured);
  console.log("  enabled        :", cfg.enabled);
  console.log("  authUrl        :", cfg.authUrl);
  console.log("  enterpriseShort:", cfg.enterpriseShortName);
  console.log("  username       :", cfg.username);
  console.log("  password       :", cfg.password ? `${cfg.password.slice(0, 2)}****` : "(empty)");
  console.log("  locationRef    :", cfg.locationRef);
  console.log("────────────────────────────────────────────────────────");

  if (!cfg.configured) {
    console.error("❌ Not configured — missing env vars");
    process.exit(1);
  }

  console.log("\nAttempting PKCE auth …");
  try {
    const token = await acquireLocationToken(cfg);
    console.log("✅ Auth SUCCESS — token acquired (first 12 chars):", token.slice(0, 12) + "…");
  } catch (e: unknown) {
    const err = e as Error;
    console.error("❌ Auth FAILED:", err.message);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
