/**
 * GM Co-Pilot — Shared Type Definitions
 *
 * Every module in lib/copilot imports from here.
 * Types are service-led, operationally grounded, and strongly typed.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Service Windows
// ═══════════════════════════════════════════════════════════════════════════════

export type ServiceWindow =
  | "pre_open"
  | "breakfast"
  | "lunch_build"
  | "lunch_peak"
  | "afternoon_lull"
  | "dinner_build"
  | "dinner_peak"
  | "close";

export interface ServiceWindowInfo {
  window: ServiceWindow;
  label: string;
  startsAt: string;   // HH:mm
  endsAt: string;     // HH:mm
  isActive: boolean;
  minutesRemaining: number | null;
  nextWindow: ServiceWindow | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service State
// ═══════════════════════════════════════════════════════════════════════════════

export type EnergyLevel = "high" | "moderate" | "low" | "critical";
export type UpsellStrength = "strong" | "moderate" | "weak" | "none";
export type ConversionLevel = "high" | "moderate" | "low" | "critical";
export type EngagementLevel = "high" | "moderate" | "low" | "critical";
export type ServiceRiskLevel = "none" | "low" | "moderate" | "high" | "critical";

export interface ServiceState {
  energyLevel: EnergyLevel;
  upsellStrength: UpsellStrength;
  conversionRate: ConversionLevel;
  engagementLevel: EngagementLevel;
  serviceRiskLevel: ServiceRiskLevel;
  serviceSummary: string;
  signals: ServiceSignals;
}

export interface ServiceSignals {
  floorEnergyScore: number;          // 0-100
  tableTurnRate: number;             // turns per hour
  upsellRate: number;                // 0-1
  avgSpend: number;
  walkInConversionRate: number;      // 0-1
  bookingConversionRate: number;     // 0-1
  guestEngagementScore: number;      // 0-100
  tableTouchFrequency: number;       // touches per table per hour
  serviceSpeedRisk: "none" | "low" | "medium" | "high" | "critical";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service Impact (Service → Revenue mapping)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ServiceRevenueImpact {
  revenueImpactExplanation: string;
  estimatedRevenueLoss: number;
  likelyDrivers: ServiceRevenueDriver[];
}

export interface ServiceRevenueDriver {
  signal: string;
  currentLevel: string;
  revenueEffect: string;
  estimatedLoss: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GM Brief
// ═══════════════════════════════════════════════════════════════════════════════

export type UrgencyState = "critical" | "urgent" | "attention" | "on_track";

export interface GMBrief {
  serviceWindow: ServiceWindow;
  urgencyState: UrgencyState;
  headline: string;
  summary: string;
  todayTarget: number;
  actualRevenue: number;
  revenueGap: number;
  labourPercent: number;
  coversActual: number;
  coversForecast: number;
  avgSpend: number;
  criticalIssues: number;
  serviceRiskSummary: string[];
  topThreeActions: GMDecision[];
  consequenceIfIgnored: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GM Insight (Pattern + Cause Engine)
// ═══════════════════════════════════════════════════════════════════════════════

export type ConfidenceType = "measured" | "inferred" | "estimated";

export interface GMInsight {
  detectedPattern: string;
  likelyCause: string;
  recommendedAction: string;
  expectedImpact: string;
  confidenceType: ConfidenceType;
  category: GMDecisionCategory;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GM Decisions (Action Engine)
// ═══════════════════════════════════════════════════════════════════════════════

export type GMDecisionCategory =
  | "service"
  | "revenue"
  | "labour"
  | "bookings"
  | "compliance"
  | "maintenance"
  | "data";

export type GMDecisionSeverity = "critical" | "high" | "medium" | "low";

export type GMActionType =
  | "reposition_staff"
  | "cut_shift"
  | "push_upsell"
  | "call_bookings"
  | "place_order"
  | "start_renewal"
  | "escalate_issue"
  | "sync_data"
  | "extend_service"
  | "push_walk_ins"
  | "review_labour"
  | "inspect_issue";

export interface GMDecision {
  id: string;
  priorityRank: number;
  category: GMDecisionCategory;
  title: string;
  directInstruction: string;
  whyItMatters: string;
  expectedImpactText: string;
  expectedImpactValue: number | null;
  dueAt: string | null;      // HH:mm or ISO
  owner: string | null;      // "GM" | "Shift Lead" | "FOH Manager"
  severity: GMDecisionSeverity;
  status: "pending" | "in_progress" | "completed" | "escalated";
  consequenceIfIgnored: string;
  actionType: GMActionType;
  serviceWindowRelevance: ServiceWindow | null;
  confidenceType: ConfidenceType;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Data Trust
// ═══════════════════════════════════════════════════════════════════════════════

export type TrustState = "trusted" | "partial" | "degraded" | "unreliable";

export interface DataTrustState {
  trustState: TrustState;
  staleSources: StaleSource[];
  explanation: string;
}

export interface StaleSource {
  source: string;
  lastUpdated: string | null;
  ageMinutes: number | null;
  impact: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Operating Score (service-weighted)
// ═══════════════════════════════════════════════════════════════════════════════

export type ScoreGrade = "A" | "B" | "C" | "D" | "F";

export interface CopilotOperatingScore {
  totalScore: number;
  grade: ScoreGrade;
  breakdown: {
    service: number;    // max 25
    revenue: number;    // max 25
    labour: number;     // max 20
    maintenance: number; // max 10
    compliance: number; // max 10
  };
  scoreSummary: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Action Impact Measurement
// ═══════════════════════════════════════════════════════════════════════════════

export interface ActionImpact {
  actionId: string;
  impactSummary: string;
  beforeMetric: number | null;
  afterMetric: number | null;
  estimatedImpactValue: number | null;
  operatingScoreContribution: number | null;
  measuredAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Escalation
// ═══════════════════════════════════════════════════════════════════════════════

export interface EscalationTarget {
  role: string;
  name: string | null;
}

export interface EscalationResult {
  actionId: string | null;
  escalatedTo: EscalationTarget;
  reason: string;
  escalatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service Score (Gamification)
// ═══════════════════════════════════════════════════════════════════════════════

export type ServiceLabel =
  | "Service Leader"
  | "Most Improved"
  | "Best Shift Recovery"
  | "Top Conversion Store"
  | "Strongest Guest Spend";

export interface ServiceScoreBreakdown {
  floorEnergy: number;
  walkInConversion: number;
  upsellRate: number;
  bookingConversion: number;
  avgSpendVsTarget: number;
  tableTurnRate: number;
  reviewSentiment: number;
}

export interface ServiceScoreOutput {
  totalScore: number;
  serviceGrade: ScoreGrade;
  breakdown: ServiceScoreBreakdown;
  biggestDriverUp: string | null;
  biggestDriverDown: string | null;
  movementVsYesterday: number | null;
  movementVsLastSameShift: number | null;
  labels: ServiceLabel[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full Copilot Output (what the page consumes)
// ═══════════════════════════════════════════════════════════════════════════════

export interface CopilotOutput {
  brief: GMBrief;
  serviceState: ServiceState;
  serviceImpact: ServiceRevenueImpact;
  serviceScore: ServiceScoreOutput;
  insights: GMInsight[];
  decisions: GMDecision[];
  trustState: DataTrustState;
  operatingScore: CopilotOperatingScore;
  generatedAt: string;
}
