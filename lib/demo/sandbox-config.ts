/**
 * lib/demo/sandbox-config.ts
 *
 * Centralised configuration for sandbox / demo environments.
 *
 * RULE: All pilot-specific constants that affect query filters or data routing
 *       must live here, not inline in route files or service files.
 *       If these values change, change them here — one place only.
 *
 * ── Sandbox site ─────────────────────────────────────────────────────────────
 *
 * The "sandbox" site is a demo/test site populated with mirrored data from
 * the reference site (Si Cantina Sociale). It is identified by store_code
 * "TEST-01" and excluded from all production aggregations.
 *
 * ── Reference site (mirror source) ──────────────────────────────────────────
 *
 * Si Cantina Sociale is the primary live reference site used to mirror metrics
 * into the sandbox. Identified by store_code because store_codes are stable
 * business identifiers — unlike UUIDs which can change across migrations.
 */

/**
 * Store code for the sandbox / demo site.
 * Used in query filters: .neq("store_code", SANDBOX_STORE_CODE)
 * and in sandbox detection: isSandboxSite()
 */
export const SANDBOX_STORE_CODE = "TEST-01" as const;

/**
 * Store codes that identify the Si Cantina Sociale reference site.
 * Multiple codes exist due to historical naming changes across migrations.
 * The sandbox mirror logic uses the first match.
 *
 * Prefer store_codes over UUIDs: store_codes are defined by the business
 * and survive data migrations; UUIDs may change between seed runs.
 */
export const REFERENCE_SITE_STORE_CODES: ReadonlySet<string> = new Set([
  "SCS",    // Si Cantina Sociale (original)
  "SC-CB",  // Si Cantina Camps Bay
  "SC-SOC", // Si Cantina Sociale (alternate slug)
]);

/**
 * Returns true if the given store code belongs to the Si Cantina reference site.
 * Use this instead of inline UUID or string comparisons.
 */
export function isReferenceSite(storeCode: string | null): boolean {
  if (!storeCode) return false;
  return REFERENCE_SITE_STORE_CODES.has(storeCode);
}
