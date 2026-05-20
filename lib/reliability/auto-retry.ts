/**
 * lib/reliability/auto-retry.ts
 *
 * Stale-state recovery: translates fired AlertEvents into targeted
 * dispatchSync() calls for the affected MICROS feeds.
 *
 * Gating:
 *   1. Context must have a locRef (MICROS connected)
 *   2. Distributed lock (acquireLock) prevents duplicate concurrent retries
 *   3. Only stale/failing feeds are retried — disconnected sites are skipped
 *
 * The sync itself runs fire-and-forget. The caller receives a RetryOutcome[]
 * immediately; actual sync completion is tracked in micros_sync_runs.
 */

import { dispatchSync }    from "@/lib/sync/orchestrator";
import { acquireLock }     from "@/lib/sync/locks";
import type { SyncType }   from "@/lib/sync/contract";
import type { AlertEvent } from "@/lib/alerts/rules";
import type { OperationalContext } from "@/lib/ops/operational-context";
import { logger }          from "@/lib/logger";
import { todayISO }        from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetryOutcome {
  feed: string;
  syncType: SyncType;
  triggered: boolean;
  /** Why the retry was skipped (only set when triggered=false) */
  reason?: "lock_held" | "no_locref" | "not_retryable" | "error";
}

// ── Feed → SyncType mapping ───────────────────────────────────────────────────

/**
 * Map a rule key or feed name to the most appropriate MICROS sync type.
 * Returns null for feeds we cannot/should not retry (inventory IM, disconnected).
 */
function resolveRetryTarget(
  ruleKey: string,
  meta?: Record<string, unknown>,
): Array<{ feed: string; syncType: SyncType }> {
  switch (ruleKey) {
    case "REVENUE_STALE":
      return [{ feed: "revenue", syncType: "intraday_sales" }];

    case "LABOUR_STALE":
      return [{ feed: "labour", syncType: "labour" }];

    case "SYNC_FAILING": {
      // metadata.failingFeeds = Array<{ feedType, consecutiveFailures, ... }>
      const failing = (meta?.failingFeeds as Array<{ feedType: string }> | undefined) ?? [];
      return failing.flatMap(({ feedType }) => {
        if (feedType === "sales")  return [{ feed: "revenue", syncType: "intraday_sales" as SyncType }];
        if (feedType === "labour") return [{ feed: "labour", syncType: "labour" as SyncType }];
        // inventory handled separately (MICROS IM, different client)
        return [];
      });
    }

    // INVENTORY_STALE — MICROS IM uses a different protocol; skip here
    // MICROS_DISCONNECTED — no connection to retry against
    default:
      return [];
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Evaluate fired alerts and trigger dispatchSync() for each recoverable feed.
 *
 * @param context  - From resolveOperationalContext() — provides locRef, siteId
 * @param alerts   - From evaluateAlerts() — only fired alerts
 * @returns        - Outcome per feed (triggered immediately; sync runs async)
 */
export async function triggerStaleRecovery(
  context: OperationalContext,
  alerts: AlertEvent[],
): Promise<RetryOutcome[]> {
  const { siteId, locRef } = context;
  const traceId = crypto.randomUUID();

  if (!locRef) {
    logger.info("auto-retry.skipped.no_locref", { siteId });
    // Return skipped outcomes for every alert that would have triggered a retry
    return alerts
      .flatMap((a) => resolveRetryTarget(a.ruleKey, a.metadata))
      .map(({ feed, syncType }) => ({
        feed,
        syncType,
        triggered: false,
        reason: "no_locref" as const,
      }));
  }

  const outcomes: RetryOutcome[] = [];
  // De-duplicate feeds — SYNC_FAILING may overlap with REVENUE_STALE
  const seen = new Set<SyncType>();

  for (const alert of alerts) {
    const targets = resolveRetryTarget(alert.ruleKey, alert.metadata);

    for (const { feed, syncType } of targets) {
      if (seen.has(syncType)) continue;
      seen.add(syncType);

      // ── Lock check: prevent duplicate concurrent retries ─────────────────
      const lockKey = `sync:auto-retry:${syncType}:${siteId}`;
      const lock = await acquireLock(lockKey, `auto-retry:${traceId}`, 30);

      if (!lock) {
        logger.info("auto-retry.lock_held", { siteId, syncType });
        outcomes.push({ feed, syncType, triggered: false, reason: "lock_held" });
        continue;
      }

      // ── Fire-and-forget dispatch ──────────────────────────────────────────
      // Lock is intentionally short (30s) — if sync takes longer, the
      // orchestrator's own run row prevents logical double-execution.
      dispatchSync(
        {
          loc_ref: locRef,
          sync_type: syncType,
          mode: "delta",
          business_date: todayISO(),
          trace_id: traceId,
        },
        siteId,
        traceId,
      ).catch((err) => {
        logger.error("auto-retry.dispatch_failed", {
          siteId,
          syncType,
          locRef,
          err: String(err),
        });
      });

      logger.info("auto-retry.triggered", { siteId, syncType, locRef, traceId });
      outcomes.push({ feed, syncType, triggered: true });
    }
  }

  return outcomes;
}
