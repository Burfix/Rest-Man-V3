/**
 * Head Office — Daily Accountability Report
 *
 * Two-layer Head Office accountability tool:
 *   Layer 1: Executive Overview (KPIs, risk distribution, narrative)
 *   Layer 2: Store Accountability Tracking (daily duties, SLA, scores)
 *
 * Seven tabs:
 *   1. Executive Summary — store status cards + AI narrative
 *   2. Store Comparison — sortable store performance table
 *   3. Daily Duties Tracker — filterable all-store duty table
 *   4. Labour & Turnover — revenue vs target, labour %
 *   5. Maintenance & Compliance — open issues, overdue items
 *   6. Guest Experience — reviews, ratings, negative feedback
 *   7. Risks & Escalations — red/yellow stores, blocked duties
 */

import DailyReportClient from "@/components/dashboard/head-office/DailyReportClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Daily Accountability Report | Head Office",
  description: "Head Office daily performance and accountability dashboard",
};

export default function DailyReportsPage() {
  return <DailyReportClient />;
}
