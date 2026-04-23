/**
 * lib/sync/contract.ts
 *
 * Canonical Zod-typed contract for every sync endpoint, worker, and scheduler.
 *
 * Rules:
 * - outcome: 'empty' is mandatory when records_fetched === 0.
 *   Downstream code treats 'empty' differently from 'success'.
 * - All sync callsites must accept SyncRequest; all must return SyncResult.
 * - No `any`. No @ts-ignore.
 */

import { z } from "zod";

// ── Enumerations ──────────────────────────────────────────────────────────────

export const SyncTypeEnum = z.enum([
  "intraday_sales",
  "daily_sales",
  "guest_checks",
  "intervals",
  "labour",
]);
export type SyncType = z.infer<typeof SyncTypeEnum>;

export const SyncModeEnum = z.enum(["delta", "full", "backfill"]);
export type SyncMode = z.infer<typeof SyncModeEnum>;

export const SyncOutcomeEnum = z.enum(["success", "empty", "partial", "failed"]);
export type SyncOutcome = z.infer<typeof SyncOutcomeEnum>;

// ── Request ───────────────────────────────────────────────────────────────────

export const SyncRequest = z.object({
  /** Location reference identifier — resolves to a micros_connections row */
  loc_ref: z.string().min(1),
  sync_type: SyncTypeEnum,
  mode: SyncModeEnum.default("delta"),
  /** ISO date YYYY-MM-DD; defaults to today if absent */
  business_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "business_date must be YYYY-MM-DD")
    .optional(),
  /** Caller-supplied trace ID for log correlation; generated if absent */
  trace_id: z.string().uuid().optional(),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

// ── Result ────────────────────────────────────────────────────────────────────

export const SyncError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type SyncError = z.infer<typeof SyncError>;

export const SyncResult = z.object({
  ok: z.boolean(),
  outcome: SyncOutcomeEnum,
  sync_type: SyncTypeEnum,
  mode: SyncModeEnum,
  business_date: z.string(),
  connection_id: z.string().uuid(),
  records_fetched: z.number().int().nonnegative(),
  records_written: z.number().int().nonnegative(),
  records_skipped: z.number().int().nonnegative(),
  net_sales_captured: z.number().optional(),
  check_count_captured: z.number().int().optional(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  trace_id: z.string().uuid(),
  errors: z.array(SyncError).default([]),
});
export type SyncResult = z.infer<typeof SyncResult>;

// ── Scheduler types ───────────────────────────────────────────────────────────

/** Row returned by get_due_intraday_syncs() RPC */
export const DueSync = z.object({
  connection_id: z.string().uuid(),
  loc_ref: z.string(),
  sync_type: SyncTypeEnum,
  site_id: z.string().uuid(),
  schedule_config_id: z.string().uuid().optional(),
});
export type DueSync = z.infer<typeof DueSync>;

/** Row returned by claim_sync_work() RPC */
export const ClaimedWork = z.object({
  queue_id: z.string().uuid(),
  connection_id: z.string().uuid(),
  loc_ref: z.string(),
  sync_type: SyncTypeEnum,
  business_date: z.string(),
  site_id: z.string().uuid(),
  priority: z.number().int().optional(),
});
export type ClaimedWork = z.infer<typeof ClaimedWork>;

export const TickConfig = z.object({
  invocation_source: z.enum(["vercel_cron", "manual", "test"]),
  trace_id: z.string().uuid(),
  max_jobs_per_tick: z.number().int().positive().default(10),
  max_duration_ms: z.number().int().positive().default(50_000),
  dry_run: z.boolean().default(false),
});
export type TickConfig = z.infer<typeof TickConfig>;

export const TickResult = z.object({
  tick_id: z.string().uuid(),
  trace_id: z.string().uuid(),
  invocation_source: z.string(),
  intraday_dispatched: z.number().int().nonnegative(),
  backfill_dispatched: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  dry_run: z.boolean(),
  bailed_early: z.boolean(),
});
export type TickResult = z.infer<typeof TickResult>;

// ── Context passed into every handler ────────────────────────────────────────

export interface SyncContext {
  /** Authenticated Supabase client — already tenant-scoped */
  supabase: ReturnType<typeof import("@/lib/supabase/server").createServerClient>;
  trace_id: string;
  /** Connection row resolved from loc_ref */
  connection: {
    id: string;
    loc_ref: string;
    site_id: string;
    auth_server_url: string;
    app_server_url: string;
    client_id: string;
    org_identifier: string;
  };
  /** Whether to skip writes (shadow/gate mode) */
  dry_run: boolean;
}

// ── Helper: derive SyncOutcome from counts ────────────────────────────────────

export function deriveOutcome(
  records_fetched: number,
  records_written: number,
  errors: SyncError[],
): SyncOutcome {
  if (errors.some((e) => !e.retryable)) return "failed";
  if (records_fetched === 0) return "empty";
  if (errors.length > 0 && records_written === 0) return "failed";
  if (errors.length > 0) return "partial";
  return "success";
}
