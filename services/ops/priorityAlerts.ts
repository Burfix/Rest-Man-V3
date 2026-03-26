/**
 * Priority alerts — unified command-center signal aggregator.
 * Combines bookings, reviews, maintenance, and sales into one alert list.
 */

import { createServerClient } from "@/lib/supabase/server";
import { PriorityAlert } from "@/types";
import { todayISO, nDaysAgoISO } from "@/lib/utils";
import { SERVICE_CHARGE_THRESHOLD } from "@/lib/constants";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export async function getPriorityAlerts(): Promise<PriorityAlert[]> {
  const supabase = createServerClient();
  const today = todayISO();
  // nDaysAgoISO(6) === today − 6 days; gte gives exactly 7 days of data.
  const sevenDaysAgo = nDaysAgoISO(6);

  // Run all targeted count queries in parallel for speed
  const [
    escalationResult,
    largeBookingResult,
    lowReviewResult,
    urgentMaintResult,
    outOfServiceResult,
    latestUploadResult,
  ] = await Promise.all([
    // Today's escalations
    supabase
      .from("reservations")
      .select("id")
      .eq("booking_date", today)
      .eq("escalation_required", true)
      .neq("status", "cancelled"),

    // Today's large bookings (service charge threshold)
    supabase
      .from("reservations")
      .select("id, guest_count")
      .eq("booking_date", today)
      .gt("guest_count", SERVICE_CHARGE_THRESHOLD)
      .neq("status", "cancelled"),

    // Low-rated reviews in past 7 days
    supabase
      .from("reviews")
      .select("id")
      .gte("review_date", sevenDaysAgo)
      .lte("rating", 3),

    // Urgent/high open maintenance issues
    supabase
      .from("maintenance_logs")
      .select("id, priority")
      .in("repair_status", ["open", "in_progress", "awaiting_parts"])
      .in("priority", ["urgent", "high"]),

    // Out-of-service equipment
    supabase.from("equipment").select("id").eq("status", "out_of_service"),

    // Latest sales upload for staleness check — fetch uploaded_at, not week_start.
    // week_start is the Monday the week COVERED by the report, which is always
    // older than the actual upload date; using it causes false-stale alerts.
    supabase
      .from("sales_uploads")
      .select("id, uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const alerts: PriorityAlert[] = [];

  // — Escalations —
  const escalationCount = (escalationResult.data ?? []).length;
  if (escalationCount > 0) {
    alerts.push({
      type: "escalation",
      severity: "high",
      summary: `${escalationCount} booking${escalationCount !== 1 ? "s" : ""} require${escalationCount === 1 ? "s" : ""} escalation today`,
      href: "/dashboard/bookings",
      count: escalationCount,
    });
  }

  // — Low reviews —
  const lowReviewCount = (lowReviewResult.data ?? []).length;
  if (lowReviewCount > 0) {
    alerts.push({
      type: "low_review",
      severity: lowReviewCount >= 3 ? "high" : "medium",
      summary: `${lowReviewCount} low-rated review${lowReviewCount !== 1 ? "s" : ""} received in the past 7 days`,
      href: "/dashboard/reviews",
      count: lowReviewCount,
    });
  }

  // — Urgent maintenance —
  const maintIssues = (urgentMaintResult.data ?? []) as { priority: string }[];
  const urgentCount = maintIssues.filter((l) => l.priority === "urgent").length;
  const highCount = maintIssues.filter((l) => l.priority === "high").length;

  if (urgentCount > 0) {
    alerts.push({
      type: "urgent_repair",
      severity: "high",
      summary: `${urgentCount} urgent repair${urgentCount !== 1 ? "s" : ""} open — immediate attention required`,
      href: "/dashboard/maintenance",
      count: urgentCount,
    });
  } else if (highCount > 0) {
    alerts.push({
      type: "urgent_repair",
      severity: "medium",
      summary: `${highCount} high-priority repair${highCount !== 1 ? "s" : ""} outstanding`,
      href: "/dashboard/maintenance",
      count: highCount,
    });
  }

  // — Out-of-service equipment —
  const outOfServiceCount = (outOfServiceResult.data ?? []).length;
  if (outOfServiceCount > 0) {
    alerts.push({
      type: "out_of_service",
      severity: "high",
      summary: `${outOfServiceCount} equipment unit${outOfServiceCount !== 1 ? "s" : ""} currently out of service`,
      href: "/dashboard/maintenance",
      count: outOfServiceCount,
    });
  }

  // — Sales data freshness —
  const latestUpload = latestUploadResult.data as
    | { id: string; uploaded_at: string }
    | null
    | undefined;

  if (!latestUpload) {
    alerts.push({
      type: "no_sales_upload",
      severity: "medium",
      summary: "No weekly sales data uploaded — add sales data to track performance",
      href: "/dashboard/sales",
    });
  } else {
    const todayMs = new Date(today + "T00:00:00").getTime();
    const uploadMs = new Date(latestUpload.uploaded_at).getTime();
    const diffDays = Math.floor((todayMs - uploadMs) / 86_400_000);
    if (diffDays > 8) {
      alerts.push({
        type: "no_sales_upload",
        severity: "low",
        summary: "Sales data may be outdated — last upload was over a week ago",
        href: "/dashboard/sales",
      });
    }
  }

  // — Large groups today (low-severity, informational) —
  const largeCount = (largeBookingResult.data ?? []).length;
  if (largeCount > 0) {
    alerts.push({
      type: "large_booking",
      severity: "low",
      summary: `${largeCount} large group${largeCount !== 1 ? "s" : ""} booked today — service charge applies`,
      href: "/dashboard/bookings",
      count: largeCount,
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
