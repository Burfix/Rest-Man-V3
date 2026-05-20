/**
 * POST /api/reliability/recover
 *
 * Operator-triggered stale-state recovery.
 *
 * Orchestrates the full recovery loop in a single request:
 *   1. Resolve current OperationalContext
 *   2. Score reliability
 *   3. Evaluate alert rules
 *   4. Trigger dispatchSync() for each stale/failing MICROS feed
 *   5. Notify HQ via Slack (non-blocking)
 *   6. Return prioritized remediation suggestions to the caller
 *
 * Access: any authenticated site-level role (managers need recovery actions).
 * Idempotent via distributed locking — concurrent requests safely de-dupe.
 */

import { NextResponse }                  from "next/server";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { resolveOperationalContext }     from "@/lib/ops/operational-context";
import { computeReliabilityScore }       from "@/lib/reliability/score";
import { evaluateAlerts }                from "@/lib/alerts/rules";
import { triggerStaleRecovery }          from "@/lib/reliability/auto-retry";
import { notifyOperationalAlerts }       from "@/lib/alerts/slack";
import { prioritizedRemediation }        from "@/lib/reliability/remediation";
import { recordIncidentForAlerts }      from "@/lib/reliability/incident-bridge";
import { logger }                        from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST() {
  let ctx: Awaited<ReturnType<typeof getUserContext>>;
  try {
    ctx = await getUserContext();
  } catch {
    return authErrorResponse();
  }

  const { siteId, orgId } = ctx;
  const startedAt = Date.now();

  try {
    // ── Step 1 + 2: Resolve context and reliability in parallel ──────────────
    const [operationalContext, reliability] = await Promise.all([
      resolveOperationalContext(siteId, orgId),
      computeReliabilityScore(siteId, 7),
    ]);

    // ── Step 3: Evaluate alert rules ─────────────────────────────────────────
    const alerts = evaluateAlerts(operationalContext, reliability);

    if (alerts.length === 0) {
      logger.info("api.recover.healthy", { siteId, durationMs: Date.now() - startedAt });
      return NextResponse.json({
        ok:          true,
        siteId,
        healthy:     true,
        alerts:      [],
        triggered:   [],
        suggestions: [],
        reliability: { overall: reliability.overall, grade: reliability.grade },
      });
    }

    // ── Step 4: Trigger retries for stale/failing feeds ───────────────────────
    const triggered = await triggerStaleRecovery(operationalContext, alerts);

    // ── Step 5: Record incidents for critical/warning alerts ─────────────────
    recordIncidentForAlerts(alerts, siteId).catch((err) => {
      logger.warn("api.recover.incident-bridge-failed", { siteId, err: String(err) });
    });

    // ── Step 6: Notify HQ via Slack (fire-and-forget — never blocks response) ──
    notifyOperationalAlerts(alerts, siteId).catch((err) => {
      logger.warn("api.recover.slack_notify_failed", { siteId, err: String(err) });
    });

    // ── Step 6: Build operator suggestions ───────────────────────────────────
    const suggestions = prioritizedRemediation(alerts);

    logger.info("api.recover.complete", {
      siteId,
      alertCount:   alerts.length,
      retriedCount: triggered.filter((t) => t.triggered).length,
      durationMs:   Date.now() - startedAt,
    });

    return NextResponse.json({
      ok:          true,
      siteId,
      healthy:     false,
      alerts:      alerts.map((a) => ({
        ruleKey:     a.ruleKey,
        label:       a.label,
        severity:    a.severity,
        message:     a.message,
        triggeredAt: a.triggeredAt,
      })),
      triggered: triggered.map((t) => ({
        feed:      t.feed,
        syncType:  t.syncType,
        triggered: t.triggered,
        reason:    t.reason,
      })),
      suggestions: suggestions.map((s) => ({
        ruleKey:  s.ruleKey,
        label:    s.label,
        severity: s.severity,
        actions:  s.actions,
        priority: s.priority,
      })),
      reliability: {
        overall: reliability.overall,
        grade:   reliability.grade,
      },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    logger.error("api.recover.failed", { siteId, err: String(err) });
    return NextResponse.json(
      { ok: false, error: "Recovery attempt failed" },
      { status: 500 },
    );
  }
}
