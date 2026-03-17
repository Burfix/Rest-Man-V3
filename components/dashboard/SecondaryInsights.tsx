/**
 * SecondaryInsights — Zone 5
 *
 * Wraps existing section components under a lighter "Secondary Intelligence"
 * divider. Rendered beneath the 4 primary Command Center zones.
 */

import ReviewsSection    from "@/components/dashboard/ops/ReviewsSection";
import MaintenanceSection from "@/components/dashboard/ops/MaintenanceSection";
import SetupProgressSection from "@/components/dashboard/ops/SetupProgressSection";
import type {
  SevenDayReviewSummary,
  MaintenanceSummary,
} from "@/types";

interface Props {
  reviews:     SevenDayReviewSummary;
  maintenance: MaintenanceSummary;
  hasEquipment: boolean;
  hasReviews:   boolean;
}

export default function SecondaryInsights({
  reviews,
  maintenance,
  hasEquipment,
  hasReviews,
}: Props) {
  const allSetup = hasEquipment && hasReviews;

  return (
    <div>
      {/* Divider */}
      <div className="mb-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600">
          Secondary Intelligence
        </p>
        <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
      </div>

      <div className="space-y-8">
        {/* Reviews + Sales side-by-side on large screens */}
        <div>
          <p className="mb-3 text-[11px] text-stone-400 dark:text-stone-600">
            {hasReviews
              ? "Below: 7-day review snapshot. Flagged reviews require attention."
              : "Reviews not synced — connect a source to monitor guest sentiment."}
          </p>
          <ReviewsSection summary={reviews} />
        </div>

        {/* Maintenance full-width */}
        <MaintenanceSection summary={maintenance} />

        {/* Setup progress — hidden once all areas configured */}
        {!allSetup && (
          <SetupProgressSection
            hasEquipment={hasEquipment}
            hasSales={false}
            hasReviews={hasReviews}
            hasDailyOps={false}
          />
        )}
      </div>
    </div>
  );
}
