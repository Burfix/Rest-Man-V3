/**
 * Head Office — Weekly Performance Reports
 *
 * Generates and displays the weekly performance report for the group.
 * Supports email delivery and JSON export.
 */

import WeeklyReportClient from "@/components/dashboard/head-office/WeeklyReportClient";

export const dynamic = "force-dynamic";

export default function WeeklyReportsPage() {
  return (
    <div className="space-y-4">
      <WeeklyReportClient />
    </div>
  );
}
