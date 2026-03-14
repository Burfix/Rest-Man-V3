/**
 * GET /api/alerts
 *
 * Returns all active (unresolved) operational alerts with summary counts.
 *
 * Response:
 *   {
 *     active_alerts:  OperationalAlert[],
 *     critical_count: number,
 *     high_count:     number,
 *     medium_count:   number,
 *     low_count:      number,
 *   }
 */

import { NextResponse } from "next/server";
import { getActiveAlerts } from "@/services/alerts/engine";
import type { AlertsApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const alerts = await getActiveAlerts();

    const response: AlertsApiResponse = {
      active_alerts:  alerts,
      critical_count: alerts.filter((a) => a.severity === "critical").length,
      high_count:     alerts.filter((a) => a.severity === "high").length,
      medium_count:   alerts.filter((a) => a.severity === "medium").length,
      low_count:      alerts.filter((a) => a.severity === "low").length,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[GET /api/alerts]", err);
    return NextResponse.json(
      { error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}
