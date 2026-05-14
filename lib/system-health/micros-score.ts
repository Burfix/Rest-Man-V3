/**
 * lib/system-health/micros-score.ts
 *
 * Health scoring engine for individual MICROS connections.
 * Score: 0–100.  Severity bands: Healthy (90+), Warning (70–89), Critical (<70).
 */

export type MicrosSeverity = "healthy" | "warning" | "critical";

export interface MicrosHealthScore {
  score:         number;         // 0–100
  severity:      MicrosSeverity;
  deductions:    string[];       // human-readable list of what reduced the score
}

export interface MicrosHealthInput {
  dataAgeMinutes:    number | null;
  failures24h:       number;
  failures7d:        number;
  avgDurationMs:     number;
  connectionStatus:  string | null;
}

export function scoreMicrosHealth(input: MicrosHealthInput): MicrosHealthScore {
  let score = 100;
  const deductions: string[] = [];

  if (input.connectionStatus && input.connectionStatus !== "connected") {
    score -= 30;
    deductions.push(`Connection status: ${input.connectionStatus} (−30)`);
  }

  if (input.dataAgeMinutes === null) {
    score -= 25;
    deductions.push("Never synced (−25)");
  } else if (input.dataAgeMinutes > 480) {
    score -= 25;
    deductions.push(`Data stale ${Math.round(input.dataAgeMinutes / 60)}h (−25)`);
  } else if (input.dataAgeMinutes > 120) {
    score -= 15;
    deductions.push(`Data stale ${Math.round(input.dataAgeMinutes / 60)}h (−15)`);
  }

  if (input.failures24h > 3) {
    score -= 20;
    deductions.push(`${input.failures24h} failures in 24h (−20)`);
  } else if (input.failures24h > 0) {
    score -= 10;
    deductions.push(`${input.failures24h} failure(s) in 24h (−10)`);
  }

  if (input.failures7d > 5) {
    score -= 20;
    deductions.push(`${input.failures7d} failures in 7d (−20)`);
  } else if (input.failures7d > 3) {
    score -= 10;
    deductions.push(`${input.failures7d} failures in 7d (−10)`);
  }

  if (input.avgDurationMs > 8000) {
    score -= 10;
    deductions.push(`Avg sync ${(input.avgDurationMs / 1000).toFixed(1)}s (−10)`);
  } else if (input.avgDurationMs > 5000) {
    score -= 5;
    deductions.push(`Avg sync ${(input.avgDurationMs / 1000).toFixed(1)}s (−5)`);
  }

  const clamped = Math.max(0, Math.min(100, score));

  const severity: MicrosSeverity =
    clamped >= 90 ? "healthy" :
    clamped >= 70 ? "warning" :
    "critical";

  return { score: clamped, severity, deductions };
}

export function severityColor(severity: MicrosSeverity): string {
  return severity === "healthy" ? "emerald" :
         severity === "warning" ? "amber"   :
         "red";
}
