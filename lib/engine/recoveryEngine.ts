/**
 * lib/engine/recoveryEngine.ts
 *
 * ══ Restaurant-Grade Revenue Recovery Engine ══
 *
 * calculateRecoveryOpportunity(input) → RecoveryOpportunity
 *
 * Answers the GM's question:
 *   "How much revenue can I still recover before close, and how?"
 *
 * Single source of truth — used by:
 *   - Operating Brain (services/brain/operating-brain.ts)
 *   - GM Co-Pilot (lib/copilot/orchestrator.ts)
 *   - Forecast page (app/dashboard/forecast/)
 *   - Command Center Recovery Meter (components/brain/RecoveryMeter.tsx)
 *
 * Do NOT duplicate this logic anywhere else.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecoveryInput {
  /** Revenue earned so far today (net VAT excl). */
  revenueActual: number;
  /** Full-day revenue target. */
  revenueTarget: number;
  /** Average spend per cover — used to convert covers ↔ revenue. */
  avgSpend: number;
  /** Covers (guests) served so far. */
  coversActual: number;
  /** Target covers for the service window. */
  coversTarget: number;
  /** Minutes until end of service window. */
  minutesRemaining: number;
  /** Average table turn time in minutes (e.g. 45 for casual dining). */
  avgTurnMinutes: number;
  /** Number of tables currently available for new seatings. */
  availableTables?: number | null;
  /** Total covers the venue can still fit in the remaining time based on capacity. */
  serviceCapacityCovers?: number | null;
  /** Current labour cost as % of revenue. */
  labourPct: number;
  /** Target labour cost %. */
  targetLabourPct: number;
}

export type RecoveryWindow = "wide" | "narrow" | "closed";
export type RecoveryConfidence = "high" | "medium" | "low";

export interface RecoveryOpportunity {
  /** Amount below target (0 if on track). */
  revenueGap: number;
  /** Covers needed to close the gap (rounded up). */
  coversGap: number;
  /** Maximum revenue recoverable given time and capacity. */
  recoverableRevenue: number;
  /** Maximum covers achievable in remaining time. */
  recoverableCovers: number;
  /** Fraction of the gap that is recoverable (0–1). */
  recoverablePct: number;
  /** Data quality — drives how the UI presents the figure. */
  confidence: RecoveryConfidence;
  /** Time available for recovery actions. */
  window: RecoveryWindow;
  /** Ordered list of best actions for the GM right now. */
  actions: string[];
  /** One-sentence human summary, e.g. "Recoverable: R1,080 via +4 covers before close". */
  explanation: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function calculateRecoveryOpportunity(input: RecoveryInput): RecoveryOpportunity {
  const {
    revenueActual,
    revenueTarget,
    avgSpend,
    coversActual,
    coversTarget,
    minutesRemaining,
    avgTurnMinutes,
    availableTables,
    serviceCapacityCovers,
    labourPct,
    targetLabourPct,
  } = input;

  // ── Window ────────────────────────────────────────────────────────────────
  const window: RecoveryWindow =
    minutesRemaining <= 0 ? "closed" :
    minutesRemaining <= 60 ? "narrow" :
    "wide";

  // ── Gap ───────────────────────────────────────────────────────────────────
  const revenueGap = Math.max(0, revenueTarget - revenueActual);
  const coversGap  = avgSpend > 0 ? Math.ceil(revenueGap / avgSpend) : 0;

  // ── Confidence ────────────────────────────────────────────────────────────
  let confidence: RecoveryConfidence;
  if (avgSpend > 0 && minutesRemaining > 0 && revenueTarget > 0) {
    confidence = serviceCapacityCovers != null ? "high" : "medium";
  } else if (avgSpend <= 0 || revenueTarget <= 0 || minutesRemaining <= 0) {
    confidence = "low";
  } else {
    confidence = "medium";
  }

  // ── Recoverable covers ────────────────────────────────────────────────────
  // Remaining turns × assumed floor size (8 covers per turn) as fallback
  const safeAvgTurn = avgTurnMinutes > 0 ? avgTurnMinutes : 45;
  const remainingTurns = minutesRemaining / safeAvgTurn;

  let maxRecoverableCovers: number;
  if (serviceCapacityCovers != null) {
    maxRecoverableCovers = Math.max(0, Math.min(coversGap, serviceCapacityCovers - coversActual));
  } else {
    maxRecoverableCovers = Math.min(coversGap, Math.floor(remainingTurns * 8));
  }
  if (window === "closed") maxRecoverableCovers = 0;

  const recoverableCovers = Math.max(0, maxRecoverableCovers);

  // ── Recoverable revenue ───────────────────────────────────────────────────
  const recoverableRevenue =
    avgSpend > 0
      ? Math.min(revenueGap, recoverableCovers * avgSpend)
      : 0;

  // ── Recoverable % ─────────────────────────────────────────────────────────
  const recoverablePct = revenueGap > 0 ? recoverableRevenue / revenueGap : 1;

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions: string[] = [];

  if (window === "closed") {
    actions.push("Service window closed — prepare post-service recovery note");
    actions.push("Review today's revenue gap in morning debrief");
  } else if (recoverablePct >= 0.5) {
    actions.push("Push walk-ins now");
    actions.push("Activate upsell on current tables");
    actions.push("Prioritise fast-turn tables");
  } else {
    actions.push("Focus on high-value upsell");
    actions.push("Protect labour cost");
    actions.push("Prepare post-service recovery note");
  }

  if (labourPct > targetLabourPct) {
    actions.push("Review staffing before next service window");
  }

  // ── Explanation ───────────────────────────────────────────────────────────
  let explanation: string;

  if (window === "closed") {
    explanation = revenueGap > 0
      ? `Service closed with ${fmt(revenueGap)} gap — no further recovery possible`
      : "Service closed — target met";
  } else if (revenueGap === 0) {
    explanation = "On target — maintain current pace";
  } else if (confidence === "low") {
    explanation = `Revenue gap of ${fmt(revenueGap)} — recovery estimate unavailable (missing data)`;
  } else if (recoverableCovers > 0) {
    const windowLabel = window === "narrow" ? "before close (narrow window)" : "before close";
    explanation = `Recoverable: ${fmt(recoverableRevenue)} via +${recoverableCovers} cover${recoverableCovers !== 1 ? "s" : ""} ${windowLabel}`;
  } else {
    explanation = `Gap of ${fmt(revenueGap)} — capacity insufficient to recover fully in remaining time`;
  }

  return {
    revenueGap,
    coversGap,
    recoverableRevenue,
    recoverableCovers,
    recoverablePct,
    confidence,
    window,
    actions,
    explanation,
  };
}
