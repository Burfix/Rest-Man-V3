/**
 * lib/scoring/scoreConsistency.ts
 *
 * Dev-only cross-module score consistency checker.
 *
 * Compares scores from different modules (Command Center, Forecast, GM Co-Pilot)
 * and logs a loud error if they diverge by more than 2 points.
 *
 * A mismatch > 2 points means a module is using stale data or the wrong input —
 * NOT a different scoring formula (which was fixed in Phase 1).
 *
 * Usage:
 *   import { checkScoreConsistency } from "@/lib/scoring/scoreConsistency";
 *   checkScoreConsistency({ commandCenter: 74, forecast: 82 });
 *
 * This file is safe to import in production — the check is a no-op when
 * NODE_ENV !== "development".
 */

const IS_DEV = process.env.NODE_ENV === "development";

/** Maximum allowed point difference between any two module scores. */
const MAX_DRIFT_POINTS = 2;

export interface ScoreSnapshot {
  commandCenter?: number | null;
  forecast?:      number | null;
  copilot?:       number | null;
  headOffice?:    number | null;
}

/**
 * Compares all provided scores and logs an error if any two diverge by more than
 * MAX_DRIFT_POINTS. No-op outside development.
 */
export function checkScoreConsistency(scores: ScoreSnapshot, context?: string): void {
  if (!IS_DEV) return;

  const entries = Object.entries(scores).filter(
    ([, v]) => v !== null && v !== undefined,
  ) as [string, number][];

  if (entries.length < 2) return; // nothing to compare

  let hasMismatch = false;
  const mismatches: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [labelA, scoreA] = entries[i];
      const [labelB, scoreB] = entries[j];
      const drift = Math.abs(scoreA - scoreB);
      if (drift > MAX_DRIFT_POINTS) {
        hasMismatch = true;
        mismatches.push(`${labelA}=${scoreA} vs ${labelB}=${scoreB} (drift=${drift})`);
      }
    }
  }

  if (hasMismatch) {
    console.error(
      "SCORE MISMATCH DETECTED" + (context ? ` [${context}]` : ""),
      { ...scores, mismatches },
    );
  } else {
    // Optional: log passing check at debug level
    if (process.env.SCORE_DEBUG === "1") {
      console.debug("Score consistency OK:", scores);
    }
  }
}
