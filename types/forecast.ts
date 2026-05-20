/**
 * types/forecast.ts — GM Co-Pilot Forecast & Guidance Engine types
 */

// ── Priority & Category ────────────────────────────────────────────────────

export type ForecastPriority = "low" | "medium" | "high" | "urgent";

export type RecommendationCategory =
  | "staffing"
  | "prep"
  | "promo"
  | "compliance"
  | "maintenance"
  | "revenue"
  | "service";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type PrepRiskLevel = "low" | "medium" | "high";

export type ForecastConfidence = "low" | "medium" | "high";

// ── Core DB Shapes ─────────────────────────────────────────────────────────

export interface ForecastRun {
  id: string;
  store_id: string;
  forecast_date: string;        // YYYY-MM-DD
  generated_at: string;         // ISO timestamp
  sales_forecast_total: number;
  covers_forecast_total: number;
  labour_forecast_pct: number | null;
  risk_score: number;           // 0–100
  confidence_score: number;     // 0–100
  summary_json: ForecastSummaryJson;
  created_by_system: boolean;
}

export interface ForecastSummaryJson {
  headline: string;
  peak_window: string;
  top_action: string;
  forecast_avg_spend: number;
  event_name: string | null;
  day_name: string;
  risk_level: RiskSeverity;
  confidence: ForecastConfidence;
  signal_count: number;
}

export interface ForecastHourlyBreakdown {
  id: string;
  forecast_run_id: string;
  hour_slot: number;            // 0–23
  forecast_sales: number;
  forecast_covers: number;
  actual_sales: number | null;
  actual_covers: number | null;
  variance_sales: number | null;
  variance_covers: number | null;
}

export interface ForecastRecommendationRow {
  id: string;
  forecast_run_id: string;
  category: RecommendationCategory;
  priority: ForecastPriority;
  title: string;
  description: string;
  operational_reason: string | null;
  expected_impact: string | null;
  status: "open" | "acknowledged" | "completed" | "dismissed";
  created_at: string;
}

export interface PrepForecastRow {
  id: string;
  forecast_run_id: string;
  item_name: string;
  item_category: string | null;
  estimated_quantity: number | null;
  unit: string | null;
  risk_level: PrepRiskLevel | null;
  note: string | null;
}

export interface PromoForecastRow {
  id: string;
  forecast_run_id: string;
  promo_name: string;
  expected_sales_uplift_pct: number | null;
  expected_cover_uplift_pct: number | null;
  expected_margin_impact_pct: number | null;
  recommendation: string | null;
}

export interface ForecastRiskRow {
  id: string;
  forecast_run_id: string;
  risk_type: string;
  severity: RiskSeverity;
  title: string;
  description: string | null;
  recommended_action: string | null;
}

// ── Service Input / Output ─────────────────────────────────────────────────

export interface ForecastInput {
  storeId: string;
  date: string;                      // YYYY-MM-DD
  dayName: string;                   // "monday", "tuesday", etc.
  confirmedCovers: number;
  recentWeekdayAvgSales: number | null;
  sameDayLastYearSales: number | null;
  recentWeekdayAvgCovers: number | null;
  sameDayLastYearCovers: number | null;
  historicalAvgSpend: number | null;
  eventMultiplier: number;
  eventName: string | null;
  latestLabourPct: number | null;
  latestMarginPct: number | null;
  outOfServiceCount: number;
  salesTarget: number | null;
  complianceDueSoon: number;
  complianceExpired: number;
  maintenanceOverdue: number;
  maintenanceUrgent: number;
  activePromos: PromoInput[];
}

export interface PromoInput {
  name: string;
  expectedSalesUpliftPct: number;
  expectedCoverUpliftPct: number;
  expectedMarginImpactPct: number;
}

export interface DemandSnapshot {
  totalForecastSales: number;
  totalForecastCovers: number;
  forecastAvgSpend: number;
  peakHour: number;
  peakHourSales: number;
  peakWindow: string;           // "6pm – 9pm"
  hourlyBreakdown: HourlySlot[];
}

export interface HourlySlot {
  hour: number;
  forecastSales: number;
  forecastCovers: number;
}

export interface LabourGuidance {
  targetLabourPct: number;
  forecastLabourPct: number | null;
  status: "on_track" | "above_target" | "below_target";
  message: string;
  suggestedActions: string[];
}

export interface PrepGuidanceItem {
  itemName: string;
  itemCategory: string;
  estimatedQuantity: number;
  unit: string;
  riskLevel: PrepRiskLevel;
  note: string;
}

export interface RiskAssessment {
  overallScore: number;         // 0–100
  overallLevel: RiskSeverity;
  risks: RiskItem[];
}

export interface RiskItem {
  riskType: string;
  severity: RiskSeverity;
  title: string;
  description: string;
  recommendedAction: string;
}

export interface GMActionRecommendation {
  category: RecommendationCategory;
  priority: ForecastPriority;
  title: string;
  description: string;
  operationalReason: string;
  expectedImpact: string;
}

// ── Composite output — what the API returns ────────────────────────────────

export interface GMBriefing {
  forecastDate: string;
  generatedAt: string;
  headline: string;

  // KPIs
  salesForecast: number;
  coversForecast: number;
  avgSpendForecast: number;
  labourForecastPct: number | null;
  peakWindow: string;
  riskLevel: RiskSeverity;
  confidenceScore: number;
  confidence: ForecastConfidence;
  signalCount: number;

  // Event
  eventName: string | null;

  // Targets
  salesTarget: number | null;
  salesGap: number | null;

  // Detail panels
  hourlyBreakdown: HourlySlot[];
  recommendations: GMActionRecommendation[];
  prepGuidance: PrepGuidanceItem[];
  riskAssessment: RiskAssessment;
  labourGuidance: LabourGuidance;
  promoInsights: PromoInsight[];

  // Forecast vs actual (populated during the day)
  pacing: PacingSnapshot | null;
}

export interface PromoInsight {
  promoName: string;
  expectedSalesUpliftPct: number;
  expectedCoverUpliftPct: number;
  expectedMarginImpactPct: number;
  recommendation: string;
}

export interface PacingSnapshot {
  currentHour: number;
  actualSalesToDate: number;
  forecastSalesToDate: number;
  actualCoversToDate: number;
  forecastCoversToDate: number;
  salesVariancePct: number;
  coversVariancePct: number;
  pacingStatus: "above_plan" | "on_track" | "below_plan";
  pacingMessage: string;
}
