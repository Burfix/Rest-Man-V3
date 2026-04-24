import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getAllComplianceItems, daysUntilDue } from "@/services/ops/complianceSummary";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  // External API — auth via IMPORT_API_KEY (WordPress plugin)
  const apiKey = process.env.IMPORT_API_KEY;
  if (apiKey) {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token !== apiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const items = await getAllComplianceItems();

    let compliant = 0, scheduled = 0, dueSoon = 0, expired = 0, unknown = 0;
    for (const item of items) {
      if (item.status === "compliant") compliant++;
      else if (item.status === "scheduled") scheduled++;
      else if (item.status === "due_soon") dueSoon++;
      else if (item.status === "expired") expired++;
      else unknown++;
    }

    const rated = items.length - unknown;
    const compliancePct = rated > 0 ? Math.round(((compliant + scheduled) / rated) * 100) : 0;

    const itemList = items.map((item) => ({
      display_name: item.display_name,
      category: item.category,
      status: item.status,
      next_due_date: item.next_due_date,
      days_until_due: daysUntilDue(item.next_due_date),
    }));

    const order: Record<string, number> = { expired: 0, due_soon: 1, scheduled: 2, compliant: 3, unknown: 4 };
    itemList.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    return NextResponse.json({
      compliance_pct: compliancePct, total: items.length,
      compliant, scheduled, due_soon: dueSoon, expired, unknown,
      has_critical: expired > 0,
      items: itemList,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Failed to fetch compliance status", { route: "GET /api/compliance/status", err });
    return NextResponse.json({ error: "Failed to fetch compliance status" }, { status: 500 });
  }
}
