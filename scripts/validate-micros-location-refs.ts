/**
 * scripts/validate-micros-location-refs.ts
 *
 * Validates the MICROS multi-location setup and surfaces any issues before
 * running sync jobs.
 *
 * PASS conditions (exit 0):
 *   - All enabled + configured locations have unique loc refs
 *   - Si Cantina, Primi Camps Bay, and Sea Castle each appear with expected refs
 *   - No duplicate location refs between active locations
 *
 * FAIL conditions (exit 1):
 *   - Two or more active locations share the same locRef
 *     ("MICROS location ref conflict detected")
 *   - A location is enabled but not configured (missing env vars)
 *
 * Usage:  npm run micros:validate
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.production.local" });

import {
  getAllLocationConfigs,
  validateLocationRefUniqueness,
  safeConfigSummary,
} from "../lib/micros/micros-location-registry";

void (async () => {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  MICROS Multi-Location Validation");
  console.log("══════════════════════════════════════════════════════════\n");

  const configs = await getAllLocationConfigs();
  let exitCode = 0;

  // ── 1. Print summary table ────────────────────────────────────────────────

  for (const cfg of configs) {
    const summary = safeConfigSummary(cfg);
    const status  =
      !summary.configured ? "⚠️  NOT CONFIGURED" :
      !summary.enabled    ? "⏸  DISABLED" :
                            "✅  ENABLED";

    console.log(`  [${summary.key}]`);
    console.log(`    Display name  : ${summary.displayName}`);
    console.log(`    Location ref  : ${summary.locationRef || "(none)"}`);
    console.log(`    Enterprise    : ${summary.enterpriseShortName || "(none)"}`);
    console.log(`    Auth URL      : ${summary.authUrl || "(none)"}`);
    console.log(`    Has credentials: username=${summary.hasUsername} password=${summary.hasPassword}`);
    console.log(`    Status        : ${status}`);
    console.log();

    if (summary.enabled && !summary.configured) {
      console.error(`  ❌ ERROR: ${summary.key} is enabled but NOT configured (missing env vars)`);
      exitCode = 1;
    }
  }

  // ── 2. Check for duplicate location refs ─────────────────────────────────

  const conflicts = await validateLocationRefUniqueness();

  if (conflicts.length === 0) {
    console.log("  ✅ Location ref uniqueness: PASS — no conflicts detected");
  } else {
    for (const c of conflicts) {
      console.error(
        `  ❌ MICROS location ref conflict detected: locRef "${c.locationRef}" is shared by: ${c.keys.join(", ")}`,
      );
      console.error("     This would cause data from different stores to be written to the same DB rows.");
      console.error("     Fix: Assign a unique MICROS locRef to each location.");
    }
    exitCode = 1;
  }

  // ── 3. Verify expected refs ───────────────────────────────────────────────

  const expectedRefs: Record<string, string> = {
    "si-cantina":           process.env.MICROS_LOCATION_REF ?? "",
    "primi-camps-bay":      process.env.MICROS_PRIMI_CAMPS_BAY_LOCATION_REF ?? "101003",
    "sea-castle-camps-bay": process.env.MICROS_SEA_CASTLE_LOCATION_REF ?? "2001002",
  };

  for (const cfg of configs) {
    const expected = expectedRefs[cfg.key];
    if (!expected) continue; // Not set in env — skip check
    if (cfg.locationRef && cfg.locationRef !== expected) {
      console.warn(
        `  ⚠️  WARNING: ${cfg.key} has locRef "${cfg.locationRef}" but env var says "${expected}"`,
      );
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────

  const enabled    = configs.filter((c) => c.enabled && c.configured).length;
  const disabled   = configs.filter((c) => !c.enabled).length;
  const badConfig  = configs.filter((c) => c.enabled && !c.configured).length;

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`  Summary: ${enabled} active, ${disabled} disabled, ${badConfig} misconfigured`);

  if (exitCode === 0) {
    console.log(`  Result : ✅  All checks passed`);
  } else {
    console.log(`  Result : ❌  Validation FAILED — see errors above`);
  }
  console.log(`══════════════════════════════════════════════════════════\n`);

  process.exit(exitCode);
})();
