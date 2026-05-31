/**
 * lib/db/row-schemas.ts
 *
 * Zod schemas for raw database query results.
 *
 * PURPOSE:
 *   Supabase's TypeScript client does not infer types for relational selects
 *   (joins). Files that query joined tables must cast results as `any`. These
 *   schemas make that boundary explicit and add runtime validation so that
 *   DB column renames or unexpected nulls fail fast with a clear message
 *   instead of silently propagating `undefined` into monitoring logic.
 *
 * RULE:
 *   - These schemas describe the QUERY RESULT SHAPE, not the full table schema.
 *   - Only include the columns actually selected in the query.
 *   - Use `.safeParse()` — never throw on schema violations in monitoring paths;
 *     log and skip the offending row instead.
 *   - Do NOT use these for POST/PATCH input validation — that lives in
 *     lib/validation/schemas.ts.
 */

import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

const isoString    = z.string().min(1);
const nullableIso  = z.string().nullable();
const nullableStr  = z.string().nullable();
const uuid         = z.string().uuid();

// ── micros_connections (monitoring queries) ───────────────────────────────────

/**
 * Shape returned by:
 *   .from("micros_connections")
 *   .select("id, loc_ref, token_expires_at, site_id, sites ( name )")
 *
 * Used by: lib/monitoring/token-expiry.ts → getTokenExpiryReport()
 */
export const MicrosConnectionTokenRowSchema = z.object({
  id:               uuid,
  loc_ref:          z.string(),
  token_expires_at: nullableIso,
  site_id:          uuid,
  sites:            z.object({ name: z.string() }).nullable(),
});
export type MicrosConnectionTokenRow = z.infer<typeof MicrosConnectionTokenRowSchema>;

/**
 * Shape returned by:
 *   .from("micros_connections")
 *   .select("id, last_successful_sync_at, site_id, sites ( name )")
 *
 * Used by: app/api/admin/platform-health → getSyncStaleness()
 */
export const MicrosConnectionStalenessRowSchema = z.object({
  id:                      uuid,
  last_successful_sync_at: nullableIso,
  site_id:                 uuid,
  sites:                   z.object({ name: z.string() }).nullable(),
});
export type MicrosConnectionStalenessRow = z.infer<typeof MicrosConnectionStalenessRowSchema>;

// ── micros_sync_runs (monitoring queries) ────────────────────────────────────

/**
 * Shape returned by:
 *   .from("micros_sync_runs")
 *   .select("id, sync_type, started_at, connection_id,
 *            micros_connections ( site_id, sites ( name ) )")
 *
 * Used by: app/api/admin/platform-health → getZombieRuns()
 */
export const MicrosSyncRunZombieRowSchema = z.object({
  id:          uuid,
  sync_type:   z.string(),
  started_at:  isoString,
  connection_id: uuid,
  micros_connections: z.object({
    site_id: uuid,
    sites:   z.object({ name: z.string() }).nullable(),
  }).nullable(),
});
export type MicrosSyncRunZombieRow = z.infer<typeof MicrosSyncRunZombieRowSchema>;

// ── manager_performance_scores (coverage queries) ─────────────────────────────

/**
 * Shape returned by:
 *   .from("manager_performance_scores")
 *   .select("site_id, period_date")
 *
 * Used by: app/api/admin/platform-health → getMpsCoverage()
 */
export const MpsScoreCoverageRowSchema = z.object({
  site_id:     uuid,
  period_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type MpsScoreCoverageRow = z.infer<typeof MpsScoreCoverageRowSchema>;

// ── Helper: safe parse array with logging ─────────────────────────────────────

/**
 * Parses an array of raw DB rows against a Zod schema.
 * Invalid rows are SKIPPED and logged — never thrown. This keeps monitoring
 * endpoints alive even during partial DB schema drift.
 *
 * Usage:
 *   const rows = safeParseRows(data, MicrosConnectionTokenRowSchema, "token-expiry");
 */
export function safeParseRows<T>(
  raw:       unknown[],
  schema:    z.ZodSchema<T>,
  context:   string,
): T[] {
  const results: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = schema.safeParse(raw[i]);
    if (parsed.success) {
      results.push(parsed.data);
    } else {
      // Structured log — observable without crashing the caller
      console.warn(`[db/row-schemas] ${context}: row ${i} failed validation`, {
        issues: parsed.error.issues.map((e) => ({ path: e.path.join("."), msg: e.message })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row: JSON.stringify(raw[i]).slice(0, 200),
      });
    }
  }
  return results;
}
