/**
 * Head Office — Daily Operations Report
 *
 * Generates and displays the daily ops report for the group.
 * AI narrative + per-store task breakdown.
 */

import DailyReportClient from "@/components/dashboard/head-office/DailyReportClient";

export const dynamic = "force-dynamic";

export default function DailyReportsPage() {
  return (
    <div className="space-y-4">
      <DailyReportClient />
    </div>
  );
}
