/**
 * GET /api/compliance/status
 *
 * Lightweight endpoint designed for the WordPress plugin to poll.
 * Returns the compliance summary plus a flat list of items with their
 * current status — no document URLs are included to keep the payload small.
 *
 * Auth: Bearer token must match IMPORT_API_KEY env var (same key the
 *       WordPress plugin already uses for booking sync).
 *
 * Response shape:
 * {
 *   compliance_pct: number,
 *   total:          number,
 *   compliant:      number,
 *   due_soon:       number,
 *   expired:        number,
 *   unknown:        number,
 *   items: [
 *     { display_name, status, next_due_date, days_until_due }
 *   ],
 *   has_critical:   boolean,
 *   generated_at:   string   // ISO timestamp
 * }
 */

import { NextResponse } from "next/server";
import { getAllComplianceItems, computeStatus, daysUntilDue } from "@/services/ops/complianceSummary";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  // ── Auth (same key as bookings/import) ───────────────────────────────────
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

    let compliant = 0, due_soon = 0, expired = 0, unknown = 0;
    for (const item of items) {
      if (item.status === "compliant") compliant++;
      else if (item.status === "due_soon") due_soon++;
      else if (item.status === "expired") expired++;
      else unknown++;
    }

    const rated = items.length - unknown;
    const compliance_pct = rated > 0 ? Math.round((compliant / rated) * 100) : 0;

    const itemList = items.map((item) => ({
      display_name:   item.display_name,
      category:       item.category,
      status:         item.status,
      next_due_date:  item.next_due_date,
      days_until_due: daysUntilDue(item.next_due_date),
    }));

    // Sort: expired first, then due_soon, then compliant, then unknown
    const order: Record<string, number> = { expired: 0, due_soon: 1, compliant: 2, unknown: 3 };
    itemList.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    return NextResponse.json({
      compliance_pct,
      total:        items.length,
      compliant,
      due_soon,
      expired,
      unknown,
      has_critical: expired > 0,
      items:        itemList,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[GET /api/compliance/status]", err);
    return NextResponse.json({ error: "Failed to fetch compliance status" }, { status: 500 });
  }
}
