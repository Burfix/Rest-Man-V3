#!/usr/bin/env tsx
/**
 * scripts/audit-api-routes.ts
 *
 * Scans every route.ts file under app/api/ and classifies each handler
 * by its protection mechanism.
 *
 * Usage:
 *   npx tsx scripts/audit-api-routes.ts
 *   npx tsx scripts/audit-api-routes.ts --fail-on-unprotected
 *
 * Protection classifications:
 *   apiGuard     — authenticated user session + RBAC
 *   cronGuard    — CRON_SECRET Bearer token (standardised helper)
 *   cron-inline  — inline CRON_SECRET check (not using cronGuard helper)
 *   webhook      — HMAC / webhook signature check
 *   api-key      — external API key (e.g. IMPORT_API_KEY)
 *   optional-auth — INSECURE: auth only if env var is set  ← fix these
 *   none         — no auth found  ← review required
 */

import * as fs from "fs";
import * as path from "path";

// ── Configuration ─────────────────────────────────────────────────────────────

const API_DIR = path.join(process.cwd(), "app", "api");
const FAIL_ON_UNPROTECTED = process.argv.includes("--fail-on-unprotected");

// ── Types ────────────────────────────────────────────────────────────────────

type Protection =
  | "apiGuard"
  | "cronGuard"
  | "cron-inline"
  | "webhook"
  | "api-key"
  | "optional-auth"
  | "none";

interface RouteAudit {
  file: string;       // workspace-relative path
  route: string;      // HTTP path  e.g. /api/micros/sync
  methods: string[];  // HTTP methods defined in file
  protection: Protection;
  notes: string;
}

// ── Routes that are intentionally public (no auth by design) ─────────────────
// These are listed explicitly here so the audit does not flag them as unprotected.
// Paths here must match the output of routeFromPath() — i.e. include the "app/" prefix.
const INTENTIONALLY_PUBLIC_ROUTES: string[] = [
  "/app/api/health",  // uptime / health check — safe to expose, returns no PII
];

// ── Detection helpers ─────────────────────────────────────────────────────────

function detectProtection(content: string, route?: string): { protection: Protection; notes: string } {
  if (route && INTENTIONALLY_PUBLIC_ROUTES.includes(route)) {
    return { protection: "webhook", notes: "Public by design — no auth (health check)" };
  }
  // cronGuard helper (standardised — best practice)
  if (/cronGuard\s*\(/.test(content)) {
    return { protection: "cronGuard", notes: "Uses cronGuard() helper" };
  }

  // apiGuard helper
  if (/apiGuard\s*\(/.test(content)) {
    return { protection: "apiGuard", notes: "Uses apiGuard() helper" };
  }

  // getUserContext + authErrorResponse pattern (legacy but secure)
  if (/getUserContext\s*\(/.test(content) && /authErrorResponse/.test(content)) {
    return {
      protection: "apiGuard",
      notes: "getUserContext() + authErrorResponse() — consider migrating to apiGuard()",
    };
  }

  // getUserContext with explicit null/401 check (e.g. .catch(() => null) + if (!ctx))
  if (/getUserContext\s*\(/.test(content) && /status:\s*401/.test(content)) {
    return {
      protection: "apiGuard",
      notes: "getUserContext() with explicit 401 fallback",
    };
  }

  // supabase.auth.getUser() / auth.getSession() inline check
  if (/\.auth\.getUser\(\)/.test(content) && /status:\s*401/.test(content)) {
    return {
      protection: "apiGuard",
      notes: "Inline supabase.auth.getUser() + 401 check",
    };
  }

  // HMAC / webhook signature
  if (/verifyMetaSignature|x-hub-signature|timingSafeEqual/.test(content)) {
    return { protection: "webhook", notes: "HMAC signature verification" };
  }

  // IMPORT_API_KEY (external API key)
  if (/IMPORT_API_KEY/.test(content)) {
    if (/if\s*\(\s*apiKey\s*\)/.test(content)) {
      return {
        protection: "optional-auth",
        notes: "INSECURE: IMPORT_API_KEY check is optional — fix with hard require",
      };
    }
    return { protection: "api-key", notes: "IMPORT_API_KEY external API key" };
  }

  // Inline CRON_SECRET check — check for optional pattern first
  if (/CRON_SECRET/.test(content)) {
    if (/if\s*\(\s*cronSecret\s*&&/.test(content) || /if\s*\(\s*secret\s*\)/.test(content)) {
      return {
        protection: "optional-auth",
        notes: "INSECURE: CRON_SECRET check is optional (only runs if env var is set)",
      };
    }
    return {
      protection: "cron-inline",
      notes: "Inline CRON_SECRET check — consider using cronGuard() helper",
    };
  }

  // ALERTS_CRON_SECRET
  if (/ALERTS_CRON_SECRET/.test(content)) {
    if (/if\s*\(\s*secret\s*\)/.test(content)) {
      return {
        protection: "optional-auth",
        notes: "INSECURE: ALERTS_CRON_SECRET check is optional",
      };
    }
    return { protection: "cron-inline", notes: "Inline ALERTS_CRON_SECRET check" };
  }

  return {
    protection: "none",
    notes: "No auth mechanism detected — review required",
  };
}

function findMethods(content: string): string[] {
  const methods: string[] = [];
  const methodPattern = /^export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = methodPattern.exec(content)) !== null) {
    methods.push(m[1]);
  }
  return methods;
}

function routeFromPath(filePath: string): string {
  // Convert   app/api/micros/sync/route.ts  →  /api/micros/sync
  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  return "/" + rel.replace(/\/route\.ts$/, "");
}

// ── Scanner ───────────────────────────────────────────────────────────────────

function scanDir(dir: string, results: RouteAudit[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full, results);
    } else if (entry.name === "route.ts" || entry.name === "route.js") {
      const content = fs.readFileSync(full, "utf-8");
      const route = routeFromPath(full);
      const { protection, notes } = detectProtection(content, route);
      const methods = findMethods(content);
      results.push({
        file: path.relative(process.cwd(), full).replace(/\\/g, "/"),
        route,
        methods,
        protection,
        notes,
      });
    }
  }
}

// ── Reporter ──────────────────────────────────────────────────────────────────

const PROTECTION_ORDER: Protection[] = [
  "optional-auth",
  "none",
  "cron-inline",
  "api-key",
  "webhook",
  "cronGuard",
  "apiGuard",
];

const PROTECTION_LABEL: Record<Protection, string> = {
  "optional-auth": "⚠️  OPTIONAL-AUTH",
  "none":          "❌  UNPROTECTED",
  "cron-inline":   "🔶  CRON-INLINE",
  "api-key":       "🔑  API-KEY",
  "webhook":       "✅  WEBHOOK-SIG",
  "cronGuard":     "✅  CRON-GUARD",
  "apiGuard":      "✅  API-GUARD",
};

function printReport(results: RouteAudit[]): void {
  const sorted = [...results].sort(
    (a, b) => PROTECTION_ORDER.indexOf(a.protection) - PROTECTION_ORDER.indexOf(b.protection),
  );

  const counts: Record<Protection, number> = {
    "optional-auth": 0, none: 0, "cron-inline": 0,
    "api-key": 0, webhook: 0, cronGuard: 0, apiGuard: 0,
  };

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  API ROUTE SECURITY AUDIT");
  console.log("═══════════════════════════════════════════════════════════\n");

  for (const r of sorted) {
    counts[r.protection]++;
    const label = PROTECTION_LABEL[r.protection];
    const methods = r.methods.join(", ") || "?";
    console.log(`${label.padEnd(22)}  [${methods.padEnd(16)}]  ${r.route}`);
    if (r.protection === "optional-auth" || r.protection === "none") {
      console.log(`                            ↳ ${r.notes}`);
      console.log(`                            ↳ file: ${r.file}`);
    }
  }

  console.log("\n───────────────────────────────────────────────────────────");
  console.log("  SUMMARY");
  console.log("───────────────────────────────────────────────────────────");
  for (const [protection, count] of Object.entries(counts)) {
    if (count > 0) {
      const label = PROTECTION_LABEL[protection as Protection];
      console.log(`  ${label.padEnd(24)}  ${count} route(s)`);
    }
  }
  console.log("");

  const critical = counts["optional-auth"] + counts["none"];
  if (critical > 0) {
    console.log(`  ⛔  ${critical} route(s) require immediate attention.\n`);
  } else {
    console.log("  🎉  All routes are protected.\n");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const results: RouteAudit[] = [];
scanDir(API_DIR, results);
printReport(results);

const unprotected = results.filter(
  (r) => r.protection === "none" || r.protection === "optional-auth",
);

if (FAIL_ON_UNPROTECTED && unprotected.length > 0) {
  console.error(`Audit failed: ${unprotected.length} unprotected route(s) found.`);
  process.exit(1);
}
