/**
 * lib/alerts/rules.ts — Operational staleness and connectivity alert rules
 *
 * Pure functions: each rule takes the current OperationalContext and returns
 * an AlertEvent when the condition is met, or null when healthy.
 *
 * Rules are deliberately separated from delivery (Slack is in slack.ts,
 * DB persistence is in a future tier). This makes them testable and composable.
 *
 * Current rules:
 *   REVENUE_STALE        — live revenue >20 min or >60 min old
 *   LABOUR_STALE         — labour feed >4h or >8h old
 *   INVENTORY_STALE      — inventory feed >4h old (when MICROS IM enabled)
 *   MICROS_DISCONNECTED  — no MICROS connection registered for this site
 *   SYNC_FAILING         — consecutive failures ≥3 on any feed
 */

import type { OperationalContext } from "@/lib/ops/operational-context";
import type { ReliabilityScore } from "@/lib/reliability/score";

// ── Alert types ──────────────────────────────────────────────────────────────

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertEvent {
  /** Stable machine-readable key — used for deduplication */
  ruleKey: string;
  /** Human-readable label */
  label: string;
  severity: AlertSeverity;
  siteId: string;
  /** Plain-English explanation of why the alert fired */
  message: string;
  /** ISO-8601 when this alert was evaluated */
  triggeredAt: string;
  /** Supporting data for enrichment / rendering */
  metadata?: Record<string, unknown>;
}

export interface AlertRule {
  key: string;
  label: string;
  evaluate(
    context: OperationalContext,
    reliability?: ReliabilityScore,
  ): AlertEvent | null;
}

// ── Helper ───────────────────────────────────────────────────────────────────

function event(
  rule: Pick<AlertRule, "key" | "label">,
  siteId: string,
  severity: AlertSeverity,
  message: string,
  metadata?: Record<string, unknown>,
): AlertEvent {
  return {
    ruleKey: rule.key,
    label: rule.label,
    severity,
    siteId,
    message,
    triggeredAt: new Date().toISOString(),
    metadata,
  };
}

// ── Rule: Revenue staleness ───────────────────────────────────────────────────

export const REVENUE_STALE: AlertRule = {
  key: "REVENUE_STALE",
  label: "Revenue data stale",

  evaluate(ctx) {
    const { provenance } = ctx.revenue;

    // "no_connection" is handled by MICROS_DISCONNECTED — don't double-alert
    if (provenance.source === "no_connection") return null;

    // Only time-based staleness matters for live MICROS data
    if (provenance.source !== "live_micros" && provenance.source !== "stale_fallback") return null;

    const minutes = provenance.fetchedAt
      ? Math.round((Date.now() - new Date(provenance.fetchedAt).getTime()) / 60_000)
      : null;

    if (minutes === null || minutes <= 20) return null;

    const severity: AlertSeverity = minutes > 60 ? "critical" : "warning";
    return event(
      REVENUE_STALE,
      ctx.siteId,
      severity,
      `Revenue data is ${minutes} min old (SLA: 20 min). Last update: ${provenance.fetchedAt ?? "unknown"}.`,
      { minutesStale: minutes, locRef: provenance.locRef },
    );
  },
};

// ── Rule: Labour staleness ────────────────────────────────────────────────────

export const LABOUR_STALE: AlertRule = {
  key: "LABOUR_STALE",
  label: "Labour data stale",

  evaluate(ctx) {
    const { provenance } = ctx.labour;

    if (provenance.source === "no_connection") return null;

    const minutes = provenance.fetchedAt
      ? Math.round((Date.now() - new Date(provenance.fetchedAt).getTime()) / 60_000)
      : null;

    if (minutes === null || minutes <= 240) return null; // 4h SLA

    const severity: AlertSeverity = minutes > 480 ? "critical" : "warning"; // 8h = critical
    return event(
      LABOUR_STALE,
      ctx.siteId,
      severity,
      `Labour data is ${Math.round(minutes / 60 * 10) / 10}h old (SLA: 4h). Last sync: ${provenance.fetchedAt ?? "unknown"}.`,
      { minutesStale: minutes, locRef: provenance.locRef },
    );
  },
};

// ── Rule: Inventory staleness ─────────────────────────────────────────────────

export const INVENTORY_STALE: AlertRule = {
  key: "INVENTORY_STALE",
  label: "Inventory data stale",

  evaluate(ctx) {
    const { provenance } = ctx.inventory;

    // Only alert when MICROS IM is active — manual counts don't have a time SLA
    if (provenance.source !== "live_micros") return null;

    const minutes = provenance.fetchedAt
      ? Math.round((Date.now() - new Date(provenance.fetchedAt).getTime()) / 60_000)
      : null;

    if (minutes === null || minutes <= 240) return null; // 4h SLA

    return event(
      INVENTORY_STALE,
      ctx.siteId,
      "warning",
      `Inventory data is ${Math.round(minutes / 60 * 10) / 10}h old (SLA: 4h). MICROS IM sync may be stuck.`,
      { minutesStale: minutes },
    );
  },
};

// ── Rule: MICROS disconnected ─────────────────────────────────────────────────

export const MICROS_DISCONNECTED: AlertRule = {
  key: "MICROS_DISCONNECTED",
  label: "MICROS not connected",

  evaluate(ctx) {
    const revenueDisconnected = ctx.revenue.provenance.source === "no_connection";
    const labourDisconnected  = ctx.labour.provenance.source  === "no_connection";

    // Only alert if both feeds are disconnected — one missing could be timing
    if (!revenueDisconnected && !labourDisconnected) return null;

    return event(
      MICROS_DISCONNECTED,
      ctx.siteId,
      "critical",
      "No MICROS connection registered for this site. Revenue and labour data unavailable.",
      { locRef: ctx.locRef },
    );
  },
};

// ── Rule: Consecutive sync failures ──────────────────────────────────────────

export const SYNC_FAILING: AlertRule = {
  key: "SYNC_FAILING",
  label: "Sync pipeline failing",

  evaluate(ctx, reliability) {
    if (!reliability) return null;

    const failing = reliability.feeds.filter((f) => f.consecutiveFailures >= 3);
    if (failing.length === 0) return null;

    const worst = failing.reduce((a, b) =>
      b.consecutiveFailures > a.consecutiveFailures ? b : a,
    );

    return event(
      SYNC_FAILING,
      ctx.siteId,
      "critical",
      `${worst.feedType} sync has failed ${worst.consecutiveFailures} consecutive times. Immediate investigation required.`,
      {
        failingFeeds: failing.map((f) => ({
          feedType: f.feedType,
          consecutiveFailures: f.consecutiveFailures,
          lastSuccessAt: f.lastSuccessAt,
        })),
      },
    );
  },
};

// ── All built-in rules ────────────────────────────────────────────────────────

export const BUILT_IN_RULES: AlertRule[] = [
  MICROS_DISCONNECTED,
  REVENUE_STALE,
  LABOUR_STALE,
  INVENTORY_STALE,
  SYNC_FAILING,
];

// ── Evaluator ────────────────────────────────────────────────────────────────

/**
 * Evaluate all built-in alert rules against the current operational context.
 * Returns only the rules that fired (empty array = all healthy).
 *
 * @param context    - From resolveOperationalContext()
 * @param reliability - Optional; SYNC_FAILING rule requires it
 * @param rules      - Override the rule set (useful for testing)
 */
export function evaluateAlerts(
  context: OperationalContext,
  reliability?: ReliabilityScore,
  rules = BUILT_IN_RULES,
): AlertEvent[] {
  return rules
    .map((rule) => {
      try {
        return rule.evaluate(context, reliability);
      } catch {
        return null; // a buggy rule never blocks the evaluator
      }
    })
    .filter((e): e is AlertEvent => e !== null);
}
