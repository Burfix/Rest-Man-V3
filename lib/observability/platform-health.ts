/**
 * lib/observability/platform-health.ts
 *
 * Canonical observability helpers for the ForgeStack Platform Health layer.
 *
 * SINGLE SOURCE OF TRUTH for:
 *   - Sync staleness classification thresholds (GREEN / AMBER / RED)
 *   - Site alert derivation logic (staleness + reliability feeds + health view)
 *
 * Previously duplicated across:
 *   - app/api/admin/platform-health/route.ts (classifyStaleness local fn)
 *   - app/api/head-office/ops-center/route.ts (deriveAlerts local fn with inline thresholds)
 *
 * Rule: Never inline these thresholds in API routes or UI components.
 *       Import from here. If thresholds must change, change them once here.
 */

// ── Staleness classification ───────────────────────────────────────────────────

/** Traffic-light status for data freshness. */
export type StalenessStatus = "GREEN" | "AMBER" | "RED";

/**
 * Thresholds for sync staleness classification.
 * AMBER: data is delayed but recent enough for most operational decisions.
 * RED:   data is stale enough to be unreliable for live operational use.
 *
 * These thresholds are deliberately conservative — operational intelligence
 * requires high confidence in data freshness.
 */
export const STALENESS_THRESHOLDS = {
  /** Minutes before data is considered AMBER (delayed) */
  AMBER_MINUTES: 30,
  /** Minutes before data is considered RED (stale) */
  RED_MINUTES:   120,
  /** Minutes before data is flagged as critically stale in summaries */
  CRITICAL_MINUTES: 1440, // 24 hours
} as const;

/**
 * Classify data freshness based on minutes since last successful sync.
 *
 * @param minutesSince  Minutes since last successful sync, or null if never synced.
 * @returns GREEN | AMBER | RED
 *
 * GREEN  — within 30 minutes (operationally fresh)
 * AMBER  — 30–120 minutes (delayed, proceed with caution)
 * RED    — > 120 minutes or never synced (stale / unreliable)
 */
export function classifyStaleness(minutesSince: number | null): StalenessStatus {
  if (minutesSince === null) return "RED";
  if (minutesSince < STALENESS_THRESHOLDS.AMBER_MINUTES) return "GREEN";
  if (minutesSince < STALENESS_THRESHOLDS.RED_MINUTES)   return "AMBER";
  return "RED";
}

// ── Site alert summary ────────────────────────────────────────────────────────

export interface SiteAlertSummary {
  critical:   number;
  warning:    number;
  topMessage: string | null;
}

/**
 * Input shape for deriveAlertSummary.
 * Accepts the reliability feeds shape from computeReliabilityScore().
 */
export interface ReliabilityFeedSnapshot {
  feedType:            string;
  consecutiveFailures: number;
}

/**
 * Thresholds for consecutive failure alerts.
 * Kept here alongside staleness thresholds so all alerting rules live together.
 */
export const FAILURE_THRESHOLDS = {
  /** Consecutive failures before escalating to CRITICAL */
  CRITICAL_CONSECUTIVE: 5,
  /** Consecutive failures before raising a WARNING */
  WARNING_CONSECUTIVE:  3,
} as const;

/**
 * Derive an alert summary for a single site based on staleness, reliability
 * feed health, and the view's computed health column.
 *
 * Rules (in priority order):
 *   1. stale_minutes > 120 → critical ("Sync stale Xh")
 *   2. stale_minutes > 30  → warning  ("Sync delayed Xm")
 *   3. consecutiveFailures ≥ 5 per feed → critical
 *   4. consecutiveFailures ≥ 3 per feed → warning
 *   5. health === "critical" with no other criticals → add baseline critical
 *
 * @param staleMinutes  From v_site_health_summary.stale_minutes
 * @param health        From v_site_health_summary.health
 * @param feeds         From computeReliabilityScore().feeds
 */
export function deriveAlertSummary(
  staleMinutes: number | null,
  health:       string,
  feeds:        ReliabilityFeedSnapshot[],
): SiteAlertSummary {
  let critical = 0;
  let warning  = 0;
  const messages: string[] = [];

  // 1 & 2. Staleness
  if (staleMinutes !== null) {
    if (staleMinutes > STALENESS_THRESHOLDS.RED_MINUTES) {
      critical++;
      messages.push(`Sync stale ${Math.round((staleMinutes / 60) * 10) / 10}h`);
    } else if (staleMinutes > STALENESS_THRESHOLDS.AMBER_MINUTES) {
      warning++;
      messages.push(`Sync delayed ${staleMinutes}m`);
    }
  }

  // 3 & 4. Consecutive failures per feed
  for (const feed of feeds) {
    if (feed.consecutiveFailures >= FAILURE_THRESHOLDS.CRITICAL_CONSECUTIVE) {
      critical++;
      messages.push(`${feed.feedType} feed: ${feed.consecutiveFailures} consecutive failures`);
    } else if (feed.consecutiveFailures >= FAILURE_THRESHOLDS.WARNING_CONSECUTIVE) {
      warning++;
      messages.push(`${feed.feedType} feed failing`);
    }
  }

  // 5. Baseline critical from view health column (catch-all for unknown degradation)
  if (health === "critical" && critical === 0) {
    critical++;
    messages.push("Critical operational state");
  }

  return {
    critical,
    warning,
    topMessage: messages[0] ?? null,
  };
}
