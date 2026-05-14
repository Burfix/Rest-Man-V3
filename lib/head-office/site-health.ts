/**
 * Site health scoring for the Head Office Sites overview.
 *
 * Computes a 0–100 score and severity label from live site metrics.
 * Replaces the dependency on v_site_health_summary.health (which uses
 * sync_runs / sync_errors tables that may be empty).
 */

export type HealthSeverity = "healthy" | "warning" | "critical" | "unknown";

export interface SiteHealthInput {
  microsStatus:     string;          // 'connected' | 'syncing' | 'stale' | 'error' | 'unknown' | …
  dataAgeMinutes:   number | null;   // minutes since last successful sync (null = never synced)
  failures24h:      number;          // error count in last 24 h (from v_micros_system_health)
  labourHours:      number | null;   // total labour hours today (null = no data)
  complianceScore:  number | null;   // 0–100 compliance pass rate (null = no items)
}

export interface SiteHealthResult {
  score:    number;
  severity: HealthSeverity;
}

/** Compute health score + severity from live metrics. */
export function scoreSite(input: SiteHealthInput): SiteHealthResult {
  // If we have no MICROS data at all, can't assess
  if (
    input.microsStatus === "awaiting_setup" ||
    (input.dataAgeMinutes === null && input.microsStatus === "unknown")
  ) {
    return { score: 0, severity: "unknown" };
  }

  let score = 100;

  // MICROS connectivity (-40 if not connected/syncing)
  if (input.microsStatus !== "connected" && input.microsStatus !== "syncing") {
    score -= 40;
  }

  // Data freshness (-20 if stale > 6 hours; -35 if stale > 24 hours)
  if (input.dataAgeMinutes !== null) {
    if (input.dataAgeMinutes > 1440) {
      score -= 35;
    } else if (input.dataAgeMinutes > 360) {
      score -= 20;
    }
  } else {
    // Never synced
    score -= 25;
  }

  // Recent failures (-15 if any failures in last 24 h)
  if (input.failures24h > 0) {
    score -= Math.min(15, input.failures24h * 5);
  }

  // Labour data present (-10 if missing for the day)
  if (input.labourHours === null || input.labourHours === 0) {
    score -= 10;
  }

  // Compliance score (-20 if < 80%)
  if (input.complianceScore !== null && input.complianceScore < 80) {
    score -= 20;
  }

  score = Math.max(0, score);

  const severity: HealthSeverity =
    score >= 80 ? "healthy" :
    score >= 60 ? "warning" :
                  "critical";

  return { score, severity };
}
