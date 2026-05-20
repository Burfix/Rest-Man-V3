/**
 * lib/reliability/remediation.ts
 *
 * Pure function: maps fired AlertEvents to operator action suggestions.
 *
 * This deliberately has no side effects and no async operations.
 * It is safe to call on every render / API response for inline UX hints.
 *
 * Priority scale: 1 (highest urgency) → 5 (low / informational)
 */

import type { AlertEvent, AlertSeverity } from "@/lib/alerts/rules";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RemediationSuggestion {
  /** Matches the alert's ruleKey */
  ruleKey: string;
  /** Human-readable rule label */
  label: string;
  severity: AlertSeverity;
  /** Ordered from most impactful to least */
  actions: string[];
  /** 1 = must do now · 5 = low / informational */
  priority: number;
}

// ── Action catalogue ──────────────────────────────────────────────────────────

const ACTIONS: Record<string, string[]> = {
  REVENUE_STALE: [
    "Check MICROS POS connectivity at the terminal and verify network access.",
    "Trigger a manual sync from Settings → Integrations → Retry.",
    "Confirm the Oracle Hospitality service is running on the local server.",
    "If persistent, review recent sync logs at /dashboard/settings/integrations.",
  ],

  LABOUR_STALE: [
    "Verify MICROS labour module is active and clocking events are being recorded.",
    "Trigger a manual labour sync from Settings → Integrations.",
    "Check if staff clock-ins for today have been registered in MICROS.",
    "Contact your support team if the feed has been silent for more than 8 hours.",
  ],

  INVENTORY_STALE: [
    "Confirm MICROS Inventory Management (IM) module is enabled and reachable.",
    "Verify the IM sync credential hasn't expired in Settings → Integrations.",
    "Check the most recent IM sync log for connection errors.",
  ],

  MICROS_DISCONNECTED: [
    "Navigate to Settings → Integrations and reconnect your MICROS account.",
    "Verify the Oracle Hospitality server is reachable from this network.",
    "Confirm your connection credentials (client ID, org identifier) are correct.",
    "Contact Head Office if the connection has never been configured for this site.",
  ],

  SYNC_FAILING: [
    "Open the System Health dashboard to review the specific feed that is failing.",
    "Check whether the MICROS API is returning errors (visit Settings → Integrations).",
    "Review recent error messages in /dashboard/settings/integrations.",
    "If failures persist beyond 24 hours, escalate to your IT or integration support team.",
  ],
};

const PRIORITIES: Record<string, number> = {
  MICROS_DISCONNECTED: 1,
  SYNC_FAILING:        1,
  REVENUE_STALE:       2,
  LABOUR_STALE:        3,
  INVENTORY_STALE:     4,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns ordered operator suggestions for a single fired alert.
 * Returns empty array for unknown rule keys.
 */
export function suggestRemediation(alert: AlertEvent): string[] {
  return ACTIONS[alert.ruleKey] ?? [];
}

/**
 * Returns prioritized remediation suggestions for all active alerts.
 * Sorted by priority (1 = most urgent first), then by severity.
 */
export function prioritizedRemediation(
  alerts: AlertEvent[],
): RemediationSuggestion[] {
  return alerts
    .filter((a) => ACTIONS[a.ruleKey])
    .map((a) => ({
      ruleKey:  a.ruleKey,
      label:    a.label,
      severity: a.severity,
      actions:  ACTIONS[a.ruleKey],
      priority: PRIORITIES[a.ruleKey] ?? 5,
    }))
    .sort((x, y) => {
      if (x.priority !== y.priority) return x.priority - y.priority;
      // secondary: critical before warning
      const sev = { critical: 0, warning: 1, info: 2 } as const;
      return (sev[x.severity] ?? 2) - (sev[y.severity] ?? 2);
    });
}

/**
 * Returns only the most urgent single action per active alert.
 * Useful for compact dashboard banners.
 */
export function topActions(alerts: AlertEvent[]): string[] {
  return prioritizedRemediation(alerts)
    .map((s) => s.actions[0])
    .filter(Boolean);
}
