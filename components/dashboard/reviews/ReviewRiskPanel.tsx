/**
 * ReviewRiskPanel
 *
 * Shows urgent negative reviews, operational themes, and review-driven alerts.
 * Appears only when riskLevel > none.
 */

import { cn } from "@/lib/utils";

type RiskRow = {
  tag:      string;
  count:    number;
  severity: string;
};

type UrgentReview = {
  id:            string;
  reviewer_name?: string | null;
  rating:        number;
  review_date:   string;
  review_text?:  string | null;
  urgency?:      string | null;
  source?:       string | null;
};

type Props = {
  riskLevel:         "none" | "medium" | "high" | "critical";
  riskDrivers:       string[];
  operationalRisks:  RiskRow[];
  urgentReviews:     UrgentReview[];
};

const severityColor: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  high:     "text-orange-600 dark:text-orange-400",
  medium:   "text-amber-600 dark:text-amber-400",
};

const urgencyBg: Record<string, string> = {
  critical: "border-l-red-500",
  high:     "border-l-orange-400",
  medium:   "border-l-amber-400",
  low:      "border-l-stone-300",
};

const sourceLabel: Record<string, string> = {
  google:      "Google",
  booking_com: "Booking.com",
  tripadvisor: "TripAdvisor",
  airbnb:      "Airbnb",
  manual:      "Imported",
};

export default function ReviewRiskPanel({
  riskLevel,
  riskDrivers,
  operationalRisks,
  urgentReviews,
}: Props) {
  if (riskLevel === "none" && urgentReviews.length === 0) return null;

  const headerColor =
    riskLevel === "critical" ? "text-red-600 dark:text-red-400" :
    riskLevel === "high"     ? "text-orange-600 dark:text-orange-400" :
    riskLevel === "medium"   ? "text-amber-600 dark:text-amber-400" :
    "text-stone-600";

  return (
    <div className="border border-[#e2e2e0] dark:border-stone-800 bg-white dark:bg-[#0f0f0f] p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.2em] font-medium text-stone-600">
          GUEST EXPERIENCE RISKS
        </span>
        {riskLevel !== "none" && (
          <span className={cn("text-[9px] font-mono font-bold uppercase", headerColor)}>
            {riskLevel} RISK
          </span>
        )}
      </div>

      {/* Risk drivers */}
      {riskDrivers.length > 0 && (
        <div className="space-y-1.5">
          {riskDrivers.map((driver, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-0.5 text-red-500 text-[10px]">▲</span>
              <p className="text-[11px] text-stone-600 dark:text-stone-400">{driver}</p>
            </div>
          ))}
        </div>
      )}

      {/* Operational risks by theme */}
      {operationalRisks.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] uppercase tracking-wider text-stone-500">OPERATIONAL THEMES</p>
          {operationalRisks.map((risk) => (
            <div key={risk.tag} className="flex items-center justify-between">
              <span className="text-[11px] capitalize text-stone-700 dark:text-stone-300">
                {risk.tag.replace(/_/g, " ")}
              </span>
              <span className={cn("text-[10px] font-mono font-bold", severityColor[risk.severity] ?? "text-stone-500")}>
                {risk.count}×  {risk.severity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Urgent reviews */}
      {urgentReviews.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] uppercase tracking-wider text-stone-500">URGENT REVIEWS</p>
          {urgentReviews.slice(0, 3).map((r) => (
            <div
              key={r.id}
              className={cn(
                "border-l-2 pl-3 py-1 space-y-0.5",
                urgencyBg[r.urgency ?? "low"],
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold text-stone-700 dark:text-stone-300">
                  {r.rating}★
                </span>
                <span className="text-[9px] text-stone-400">{r.reviewer_name ?? "Anonymous"}</span>
                <span className="text-[9px] text-stone-400 ml-auto">
                  {sourceLabel[r.source ?? "manual"] ?? r.source}
                </span>
              </div>
              {r.review_text && (
                <p className="text-[10px] text-stone-500 line-clamp-2">{r.review_text}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
