/**
 * GET /api/profit/intelligence
 *
 * Returns Profit Intelligence for the caller's site (or a specific siteId
 * for head office / multi-store users).
 *
 * Query params:
 *   siteId   – optional (head office users can specify any site in their org)
 *   range    – "today" | "yesterday" | "7d" | "mtd"  (default: "today")
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { getProfitIntelligence } from "@/lib/profit/engine";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";

const querySchema = z.object({
  siteId: z.string().uuid().optional(),
  range:  z.enum(["today", "yesterday", "7d", "mtd"]).default("today"),
});

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_FINANCIALS, "GET /api/profit/intelligence");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  try {
    const params = Object.fromEntries(new URL(req.url).searchParams.entries());
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { siteId: requestedSiteId, range } = parsed.data;

    // Determine target site — head office can query any site in their org
    const isOrgUser = ["super_admin", "executive", "head_office", "tenant_owner", "area_manager"].includes(ctx.role ?? "");
    const targetSiteId = requestedSiteId
      ? isOrgUser
        ? requestedSiteId
        : ctx.siteId                    // site-level users always see their own site
      : ctx.siteId;

    if (!targetSiteId) {
      return NextResponse.json({ error: "No site context available" }, { status: 400 });
    }

    // Non-org users must stay in their own site
    if (!isOrgUser && targetSiteId !== ctx.siteId) {
      return NextResponse.json({ error: "Access denied to that site" }, { status: 403 });
    }

    const result = await getProfitIntelligence(targetSiteId, range);

    logger.info("Profit intelligence served", {
      route: "GET /api/profit/intelligence",
      siteId: targetSiteId,
      range,
      confidence: result.confidenceLevel,
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    Sentry.captureException(err);
    logger.error("Profit intelligence failed", { route: "GET /api/profit/intelligence", err });
    return NextResponse.json({ error: "Failed to load profit intelligence" }, { status: 500 });
  }
}
