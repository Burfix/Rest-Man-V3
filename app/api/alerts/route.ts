import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getActiveAlerts } from "@/services/alerts/engine";
import type { AlertsApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/alerts");
  if (guard.error) return guard.error;

  try {
    const alerts = await getActiveAlerts();
    const response: AlertsApiResponse = {
      active_alerts: alerts,
      critical_count: alerts.filter((a) => a.severity === "critical").length,
      high_count: alerts.filter((a) => a.severity === "high").length,
      medium_count: alerts.filter((a) => a.severity === "medium").length,
      low_count: alerts.filter((a) => a.severity === "low").length,
    };
    return NextResponse.json(response);
  } catch (err) {
    logger.error("Failed to fetch alerts", { route: "GET /api/alerts", err });
    return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
  }
}
