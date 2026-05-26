/**
 * lib/command-center/types.ts
 *
 * Canonical contract for the Command Center state engine.
 *
 * ─── SINGLE SOURCE OF TRUTH ───────────────────────────────────────────────────
 * Every panel on the Command Center dashboard (hero banner, Business Status,
 * System Pulse, Performance Momentum, Service Pulse, Command Feed) MUST derive
 * its display values from this contract — never from independent calculations.
 *
 * Scoring model (canonical — do not redefine elsewhere):
 *   Revenue:       30 pts
 *   Labour:        20 pts
 *   Duties / Ops:  20 pts
 *   Maintenance:   15 pts
 *   Compliance:    15 pts
 *
 * Grade thresholds (canonical):
 *   A: 85–100
 *   B: 70–84
 *   C: 55–69
 *   D: 40–54
 *   F: 0–39
 */

// ── Score ─────────────────────────────────────────────────────────────────────

export type ScoreGrade = "A" | "B" | "C" | "D" | "F";
export type ScoreStatus = "strong" | "ok" | "at_risk" | "critical";
export type DataReliability = "live" | "stale" | "missing" | "insufficient";

/** Canonical grade — maps score to letter grade. */
export function toCanonicalGrade(score: number): ScoreGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** Canonical status label from score. */
export function toScoreStatus(score: number): ScoreStatus {
  if (score >= 85) return "strong";
  if (score >= 70) return "ok";
  if (score >= 55) return "at_risk";
  return "critical";
}

/** Points to next grade (null when already A). */
export function ptsToNextGrade(score: number): { nextGrade: ScoreGrade | null; pts: number } {
  if (score >= 85) return { nextGrade: null, pts: 0 };
  if (score >= 70) return { nextGrade: "A", pts: 85 - score };
  if (score >= 55) return { nextGrade: "B", pts: 70 - score };
  if (score >= 40) return { nextGrade: "C", pts: 55 - score };
  return { nextGrade: "D", pts: 40 - score };
}

export interface ScoreBreakdownItem {
  pts: number;
  max: number;
  explanation: string;
  /** false = no POS connection; score is neutral not penalised */
  connected?: boolean;
}

export interface CanonicalScore {
  value: number;
  grade: ScoreGrade;
  status: ScoreStatus;
  /** Up to 3 modules dragging the score (module names, highest loss first). */
  drivers: string[];
  /** One-sentence summary for sub-headline. */
  explanation: string;
  breakdown: {
    revenue:     ScoreBreakdownItem & { max: 30 };
    labour:      ScoreBreakdownItem & { max: 20 };
    duties:      ScoreBreakdownItem & { max: 20 };
    maintenance: ScoreBreakdownItem & { max: 15 };
    compliance:  ScoreBreakdownItem & { max: 15 };
  };
}

// ── Revenue ───────────────────────────────────────────────────────────────────

export type RevenueStatus = "on_target" | "behind" | "at_risk" | "critical" | "unknown";

export interface CanonicalRevenue {
  actual: number;
  target: number;
  projectedClose: number | null;
  gap: number;      // target − actual (always ≥ 0; 0 = on or ahead of target)
  gapPct: number;   // (actual − target) / target × 100 (negative = behind)
  status: RevenueStatus;
  reliability: DataReliability;
}

// ── Labour ────────────────────────────────────────────────────────────────────

export type LabourStatus = "efficient" | "healthy" | "elevated" | "high" | "critical" | "unknown";

export interface CanonicalLabour {
  labourPct: number;
  targetPct: number;
  variancePct: number; // labourPct − targetPct (positive = over target)
  status: LabourStatus;
  /** Reliability flag: "insufficient" when revenue data is unavailable (labour % is unreliable) */
  reliability: DataReliability;
}

// ── Compliance ────────────────────────────────────────────────────────────────

export type ComplianceStatus = "ok" | "at_risk" | "critical" | "not_configured";

export interface CanonicalCompliance {
  scorePct: number;
  compliantCount: number;
  totalCount: number;
  expiredCount: number;
  dueSoonCount: number;
  status: ComplianceStatus;
}

// ── Maintenance ───────────────────────────────────────────────────────────────

export type MaintenanceStatus = "ok" | "attention" | "critical";

export interface CanonicalMaintenance {
  openItems: number;
  criticalItems: number;
  status: MaintenanceStatus;
}

// ── Hero banner ───────────────────────────────────────────────────────────────

export type HeroSeverity = "good" | "warning" | "critical";

export interface HeroBanner {
  headline: string;
  subline: string;
  severity: HeroSeverity;
}

// ── Business Status ───────────────────────────────────────────────────────────

export type BusinessStatusTone = "positive" | "warning" | "critical" | "neutral";

export interface BusinessStatusItem {
  key: string;
  label: string;
  value: string;
  delta: string | null;
  /** Tone used by the UI for colour coding. */
  status: BusinessStatusTone;
  severity: "critical" | "high" | "medium" | "low" | "good";
  source: string;
}

// ── System Pulse ──────────────────────────────────────────────────────────────

export interface SystemPulse {
  score: number;
  grade: ScoreGrade;
  /** Names of highest-loss score drivers. */
  drivers: string[];
  breakdown: {
    revenue:     { pts: number; max: 30; reason: string; connected?: boolean };
    labour:      { pts: number; max: 20; reason: string; connected?: boolean };
    duties:      { pts: number; max: 20; reason: string };
    maintenance: { pts: number; max: 15; reason: string };
    compliance:  { pts: number; max: 15; reason: string };
  };
  /** Shortest path to the next grade — null when already A. */
  fastestPathToNextGrade: string | null;
  /** Projected end-of-day revenue (from brain forecast). */
  projectedClose: number | null;
}

// ── Command Feed ──────────────────────────────────────────────────────────────

export type CommandFeedSeverity = "critical" | "high" | "medium" | "low";
export type CommandFeedCategory =
  | "revenue" | "labour" | "maintenance" | "compliance"
  | "service" | "forecast" | "inventory" | "duties";

export interface CommandFeedItem {
  id: string;
  severity: CommandFeedSeverity;
  category: CommandFeedCategory;
  title: string;
  description: string;
  action: string;
  ifIgnored: string | null;
  owner: string | null;
  deadline: string | null;
  impact: string | null;
  status: "pending" | "in_progress" | "completed";
}

// ── Service Session ───────────────────────────────────────────────────────────

export interface ServiceSession {
  period: string;     // "Breakfast" | "Lunch" | "Dinner" | "After Hours" | "Closed"
  hour: number;       // 0–23 in Africa/Johannesburg
  minutesElapsed: number; // minutes since 10:00 SAST (service open)
  isDutyWindow: boolean;  // true from noon onwards
}

// ── Canonical State ───────────────────────────────────────────────────────────

/**
 * CommandCenterState — the single canonical object that EVERY Command Center
 * panel must read from.
 *
 * Frontend: display only. This object: truth engine.
 *
 * Reading contract:
 *   score / grade / status   → score field (and riskVector.overallScore / grade)
 *   ranked operational risks  → riskVector.governed
 *   all narrative copy        → riskVector.narrative
 *   projections               → riskVector.projections
 *   raw domain data           → revenue / labour / compliance / maintenance
 */
export interface CommandCenterState {
  siteId: string;
  siteName: string;
  serviceSession: ServiceSession;
  lastSyncAt: string;

  /** Canonical score — single source of truth. Panels must NOT derive their own. */
  score: CanonicalScore;

  revenue: CanonicalRevenue;
  labour: CanonicalLabour;
  compliance: CanonicalCompliance;
  maintenance: CanonicalMaintenance;

  hero: HeroBanner;

  /**
   * Business status rows — ordered for display.
   * Revenue, Labour, Maintenance, Compliance.
   */
  businessStatus: BusinessStatusItem[];

  /** System Pulse panel data — identical score/grade as score field. */
  systemPulse: SystemPulse;

  /** Command Feed items — derived from same risk signals as score. */
  commandFeed: CommandFeedItem[];

  /**
   * Governed operational risk vector.
   *
   * This is the NEW canonical layer — all panels should prefer reading
   * from here rather than re-deriving risk, severity, or narrative copy.
   *
   * governed.critical (≤ 2) → Requires Action board
   * governed.high     (≤ 4) → Command Feed top items
   * narrative               → Hero subline + Recommended Action copy
   * projections             → Performance Momentum + Service Pulse confidence
   */
  riskVector: import("@/lib/ops/risk-vector").OperationalRiskVector;
}

// ── API Response envelope ─────────────────────────────────────────────────────

export interface CommandCenterApiResponse {
  data: CommandCenterState | null;
  error: string | null;
  meta: {
    requestedAt: string;
    siteId: string;
    cacheHit?: boolean;
  };
}
