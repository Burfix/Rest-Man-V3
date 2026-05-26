/**
 * lib/ops/govern-severity.ts
 *
 * Severity governor — prevents operator alert fatigue.
 *
 * Hard caps:
 *   MAX_CRITICAL = 2   (anything beyond is downgraded to "high")
 *   MAX_HIGH     = 4   (anything beyond is downgraded to "medium")
 *
 * Signals are sorted by impactScore descending before capping,
 * so the highest-impact risks always win their tier.
 *
 * Think air traffic control: not "alert for everything",
 * but "keep the critical runway clear".
 */

import type { RiskSignal, GovernedRisks } from "./risk-vector";
import { MAX_CRITICAL, MAX_HIGH }          from "./risk-vector";

/**
 * Apply severity governance to a list of raw risk signals.
 *
 * Input:  RiskSignal[] with `severity` set (pre-governor).
 * Output: GovernedRisks with `governedSeverity` set on every signal.
 */
export function governSeverity(signals: RiskSignal[]): GovernedRisks {
  if (signals.length === 0) {
    return { critical: [], high: [], medium: [], all: [] };
  }

  // Sort by impactScore desc — highest-impact risks win their severity tier.
  const sorted = [...signals].sort((a, b) => b.impactScore - a.impactScore);

  let criticalCount = 0;
  let highCount     = 0;

  const governed: RiskSignal[] = sorted.map((signal) => {
    let governedSeverity = signal.severity;

    if (signal.severity === "critical") {
      if (criticalCount >= MAX_CRITICAL) {
        // Downgrade: too many criticals already
        governedSeverity = "high";
      } else {
        criticalCount++;
      }
    }

    // Re-check high after potential downgrade from critical
    if (governedSeverity === "high") {
      if (highCount >= MAX_HIGH) {
        // Downgrade: too many highs already
        governedSeverity = "medium";
      } else {
        highCount++;
      }
    }

    return { ...signal, governedSeverity };
  });

  return {
    critical: governed.filter((s) => s.governedSeverity === "critical"),
    high:     governed.filter((s) => s.governedSeverity === "high"),
    medium:   governed.filter(
      (s) => s.governedSeverity === "medium" || s.governedSeverity === "low",
    ),
    all: governed,
  };
}
