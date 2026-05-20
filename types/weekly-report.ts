/**
 * Weekly Performance Report — Type Definitions
 *
 * Structured output types for the Head Office Weekly Report system.
 * All monetary values are in the venue's local currency (ZAR by default).
 */

// ── Week Range ─────────────────────────────────────────────────────────────────

export interface WeekRange {
  /** Start of week (Monday, YYYY-MM-DD) */
  start: string;
  /** End of week (Sunday, YYYY-MM-DD) */
  end: string;
  /** ISO week number */
  weekNumber: number;
  /** Year */
  year: number;
}

// ── 1. Group Weekly Performance ────────────────────────────────────────────────

export interface WeeklyPerformance {
  weekRange: WeekRange;
  storeCount: number;

  /** Revenue */
  totalRevenue: number | null;
  totalRevenueTarget: number | null;
  revenueGapPct: number | null;
  revenueTrend: TrendDirection;

  /** Execution */
  avgExecutionScore: number | null;
  executionGrade: string | null;
  executionTrend: TrendDirection;

  /** Actions lifecycle */
  actionsAssigned: number;
  actionsCompleted: number;
  actionsOverdue: number;
  actionsEscalated: number;
  completionRate: number | null;

  /** Impact */
  totalImpactGenerated: number | null;

  /** Service */
  avgSpend: number | null;
  avgSpendTrend: TrendDirection;
  totalCovers: number | null;
  avgRating: number | null;
}

export type TrendDirection = "up" | "down" | "flat";

// ── 2. Store Ranking ───────────────────────────────────────────────────────────

export interface StoreWeeklyRank {
  rank: number;
  siteId: string;
  storeName: string;
  city: string;
  avgExecutionScore: number | null;
  totalRevenue: number | null;
  revenueGapPct: number | null;
  actionsCompleted: number;
  actionsOverdue: number;
  completionRate: number | null;
  impactGenerated: number | null;
  trend: TrendDirection;
}

// ── 3. GM Performance ──────────────────────────────────────────────────────────

export interface GMWeeklyPerformance {
  siteId: string;
  storeName: string;
  gmName: string | null;
  executionScore: number | null;
  completionRate: number | null;
  overdueActions: number;
  escalations: number;
  impactGenerated: number | null;
  /** Previous week's execution score for comparison */
  prevWeekScore: number | null;
  scoreDelta: number | null;
}

// ── 4. Impact Analytics ────────────────────────────────────────────────────────

export interface ImpactByCategory {
  category: string;
  count: number;
  totalImpact: number | null;
  avgImpact: number | null;
}

export interface ImpactByStore {
  siteId: string;
  storeName: string;
  count: number;
  totalImpact: number | null;
}

export interface ImpactByManager {
  gmName: string;
  siteId: string;
  count: number;
  totalImpact: number | null;
}

export interface WeeklyImpactSummary {
  totalImpact: number | null;
  actionsWithImpact: number;
  byCategory: ImpactByCategory[];
  byStore: ImpactByStore[];
  byManager: ImpactByManager[];
}

// ── 5. Service Insights ────────────────────────────────────────────────────────

export interface ServiceInsights {
  avgSpend: number | null;
  avgSpendPrevWeek: number | null;
  avgSpendTrend: TrendDirection;
  totalCovers: number | null;
  coversPrevWeek: number | null;
  avgRating: number | null;
  ratingPrevWeek: number | null;
  ratingTrend: TrendDirection;
  topPerformingStore: string | null;
  lowestPerformingStore: string | null;
}

// ── 6. Intervention / Focus Items ──────────────────────────────────────────────

export interface InterventionItem {
  store: string;
  siteId: string;
  issue: string;
  severity: "critical" | "high" | "medium";
  recommendation: string;
}

export interface FocusItem {
  area: string;
  description: string;
  priority: "critical" | "high" | "medium";
}

// ── 7. Complete Report ─────────────────────────────────────────────────────────

export interface WeeklyReport {
  id: string;
  generatedAt: string;
  weekRange: WeekRange;
  orgId: string;

  summary: WeeklyPerformance;
  storeRanking: StoreWeeklyRank[];
  gmPerformance: GMWeeklyPerformance[];
  executionStats: {
    avgScore: number | null;
    grade: string | null;
    trend: TrendDirection;
    storesAbove70: number;
    storesBelow45: number;
  };
  impactSummary: WeeklyImpactSummary;
  serviceInsights: ServiceInsights;
  interventionList: InterventionItem[];
  nextWeekFocus: FocusItem[];
}
