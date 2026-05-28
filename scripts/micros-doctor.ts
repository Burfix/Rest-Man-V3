/**
 * scripts/micros-doctor.ts
 *
 * Operational health check for all registered MICROS integrations.
 * Reads env vars (from .env.local / .env.production.local) and the
 * micros_location_configs DB table to report configuration status.
 *
 * SECURITY:
 *   - Prints ONLY env var names and booleans — never values.
 *   - CLIENT_SECRET and PASSWORD are shown as "present (****)" or "MISSING".
 *   - Never prints tokens, credentials, or anything sensitive.
 *
 * Usage:
 *   npm run micros:doctor
 *
 * Exit codes:
 *   0 — all enabled locations are configured and no location_ref conflicts
 *   1 — one or more enabled locations are misconfigured or conflicts detected
 */

import * as dotenv from "dotenv";
import * as path   from "path";

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env.production.local") });

// Trim stray \n characters that Vercel sometimes injects into copy-pasted env values
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  if (process.env[key]) {
    process.env[key] = process.env[key]!.replace(/[\r\n]/g, "").trim();
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const RED    = "\x1b[31m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const DIM    = "\x1b[2m";

function ok(msg: string)    { return `${GREEN}✅ ${msg}${RESET}`; }
function warn(msg: string)  { return `${YELLOW}⚠️  ${msg}${RESET}`; }
function fail(msg: string)  { return `${RED}❌ ${msg}${RESET}`; }
function info(msg: string)  { return `${CYAN}ℹ  ${msg}${RESET}`; }
function dim(msg: string)   { return `${DIM}${msg}${RESET}`; }
function bold(msg: string)  { return `${BOLD}${msg}${RESET}`; }

function maskSecret(val: string | undefined): string {
  return val && val.trim() ? ok("present (****)") : fail("MISSING");
}

function showNonSecret(val: string | undefined, label: string): string {
  return val && val.trim() ? ok(`${label}: ${val.trim()}`) : fail(`${label}: MISSING`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + bold("══════════════════════════════════════════════════"));
  console.log(bold("  ForgeStack MICROS Integration Doctor"));
  console.log(bold("══════════════════════════════════════════════════") + "\n");

  // Lazy import after env is loaded
  const { getAllLocationConfigs, validateLocationRefUniqueness, getMissingEnvNames } =
    await import("../lib/micros/micros-location-registry");

  let configs: Awaited<ReturnType<typeof getAllLocationConfigs>>;
  try {
    configs = await getAllLocationConfigs();
  } catch (err) {
    console.error(fail("Failed to load location configs from DB:"));
    console.error(fail(String(err)));
    console.error(info("Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."));
    process.exit(1);
  }

  if (configs.length === 0) {
    console.log(warn("No rows found in micros_location_configs. Run migration 101."));
    process.exit(1);
  }

  let hasErrors = false;

  // ── Per-location report ──────────────────────────────────────────────────
  for (const cfg of configs) {
    const missingEnv = getMissingEnvNames(cfg);
    const isOk       = cfg.enabled && cfg.configured && missingEnv.length === 0;
    const isWarn     = !cfg.enabled;

    console.log(bold(`── ${cfg.displayName} (${cfg.key})`));
    console.log(`   Enabled:        ${cfg.enabled ? ok("yes") : warn("DISABLED")}`);
    console.log(`   Auth flow:      ${info(cfg.authFlow)}`);
    console.log(`   Env prefix:     ${dim(cfg.envPrefix)}`);
    console.log(`   Location ref:   ${cfg.locationRef ? ok(cfg.locationRef) : warn("(reads from env)")}`);
    console.log(`   Token isolation:${info("per-location")}`);
    console.log(`   Configured:     ${cfg.configured ? ok("YES") : fail("NO")}`);

    if (cfg.authFlow === "client_credentials") {
      const secret = process.env[`${cfg.envPrefix}CLIENT_SECRET`];
      console.log(`   CLIENT_SECRET:  ${maskSecret(secret)}`);

      // ── Credential/flow consistency guard ──────────────────────────────────
      // If a PKCE credential (USERNAME/PASSWORD) is present alongside
      // client_credentials flow, this is almost certainly a migration error
      // (e.g. migrations 102/103 for Primi). Warn loudly.
      const strayUser = process.env[`${cfg.envPrefix}USERNAME`] ?? process.env[`${cfg.envPrefix}API_ACCOUNT_NAME`];
      const strayPass = process.env[`${cfg.envPrefix}PASSWORD`] ?? process.env[`${cfg.envPrefix}API_ACCOUNT_PASSWORD`];
      if (strayUser || strayPass) {
        console.log(`   ${warn("CREDENTIAL MISMATCH: auth_flow=client_credentials but USERNAME/PASSWORD env vars are set.")}`);
        console.log(`   ${warn("  USERNAME/PASSWORD are only used for pkce flow — they will be ignored.")}`);
        console.log(`   ${warn("  If this location should use PKCE, update auth_flow in micros_location_configs.")}`);
      }
    } else {
      const user = process.env[`${cfg.envPrefix}USERNAME`] ?? process.env[`${cfg.envPrefix}API_ACCOUNT_NAME`];
      const pass = process.env[`${cfg.envPrefix}PASSWORD`] ?? process.env[`${cfg.envPrefix}API_ACCOUNT_PASSWORD`];
      console.log(`   USERNAME:       ${maskSecret(user)}`);
      console.log(`   PASSWORD:       ${maskSecret(pass)}`);

      // ── Credential/flow consistency guard ──────────────────────────────────
      // If a client_credentials secret is set but flow=pkce, it's unused.
      // Most commonly this is the stale MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET
      // left over from migrations 102/103. It won't cause a bug but flags drift.
      const straySecret = process.env[`${cfg.envPrefix}CLIENT_SECRET`];
      if (straySecret) {
        console.log(`   ${warn("NOTE: CLIENT_SECRET env var is set but auth_flow=pkce — it is unused.")}`);
        console.log(`   ${warn("  This is harmless but indicates a stale env var. Safe to delete from Vercel.")}`);
      }

      // ── Oracle password expiry reminder ────────────────────────────────────
      // Oracle PKCE API account passwords expire every 60 days.
      // This reminder fires for every enabled PKCE location.
      if (cfg.enabled && cfg.configured) {
        console.log(`   ${warn("REMINDER: Oracle PKCE passwords expire every 60 days.")}`);
        console.log(`   ${warn(`  Rotate ${cfg.envPrefix}PASSWORD in Vercel before expiry.`)}`);
        console.log(`   ${warn("  See docs/runbook.md → Password Rotation Procedure.")}`);
      }
    }

    if (missingEnv.length > 0) {
      console.log(`   Missing env:    ${fail(missingEnv.join(", "))}`);
      hasErrors = true;
    } else if (cfg.enabled) {
      console.log(`   Missing env:    ${ok("none — fully configured")}`);
    }

    if (cfg.enabled && !cfg.configured) {
      hasErrors = true;
    }

    console.log();
  }

  // ── Location ref uniqueness check ────────────────────────────────────────
  console.log(bold("── Location Reference Uniqueness Check"));
  let refConflicts: Awaited<ReturnType<typeof validateLocationRefUniqueness>>;
  try {
    refConflicts = await validateLocationRefUniqueness();
  } catch (err) {
    console.log(fail(`  Failed to check location_ref uniqueness: ${String(err)}`));
    hasErrors = true;
    refConflicts = [];
  }

  if (refConflicts.length === 0) {
    console.log(`   ${ok("No duplicate location_refs found among enabled + configured stores.")}`);
  } else {
    for (const conflict of refConflicts) {
      console.log(
        fail(
          `  CONFLICT: location_ref="${conflict.locationRef}" shared by: ` +
          conflict.keys.map((k) => `"${k}"`).join(", "),
        ),
      );
      console.log(
        info(
          `  Fix: ensure each store has a unique location_ref in micros_location_configs.`,
        ),
      );
    }
    hasErrors = true;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const enabled    = configs.filter((c) => c.enabled);
  const configured = configs.filter((c) => c.enabled && c.configured);
  const broken     = configs.filter((c) => c.enabled && !c.configured);

  console.log("\n" + bold("── Summary"));
  console.log(`   Total registered:  ${configs.length}`);
  console.log(`   Enabled:           ${enabled.length}`);
  console.log(`   Fully configured:  ${configured.length}`);
  console.log(
    broken.length === 0
      ? `   Misconfigured:     ${ok("0")}`
      : `   Misconfigured:     ${fail(String(broken.length))} — ${broken.map((c) => c.key).join(", ")}`,
  );
  console.log(
    refConflicts.length === 0
      ? `   Ref conflicts:     ${ok("none")}`
      : `   Ref conflicts:     ${fail(String(refConflicts.length))}`,
  );

  console.log();

  if (hasErrors) {
    console.log(fail("Doctor found issues. Fix the items above before running syncs.\n"));
    process.exit(1);
  } else {
    console.log(ok("All enabled locations are configured. Integration is healthy.\n"));
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Unexpected error in micros:doctor:", err);
  process.exit(1);
});
