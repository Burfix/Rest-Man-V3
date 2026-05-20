/**
 * GET /api/profit/group
 *
 * Head office / executive only.
 * Returns aggregated Profit Intelligence across all sites in the caller's org.
 *
 * Query params:
 *   range  – "today" | "yesterday" | "7d" | "mtd"  (default: "today")
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getGroupProfitIntelligence } from "@/lib/profit/engine";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";

const ORG_ROLES = ["super_admin", "executive", "head_office", "tenant_owner", "area_manager"];

const querySchema = z.object({
  range: z.enum(["today", "yesterday", "7d", "mtd"]).default("today"),
});

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_FINANCIALS, "GET /api/profit/group");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  if (!ORG_ROLES.includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "Head office access required" }, { status: 403 });
  }

  if (!ctx.orgId) {
    return NextResponse.json({ error: "No organisation context available" }, { status: 400 });
  }

  try {
    const params = Object.fromEntries(new URL(req.url).searchParams.entries());
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await getGroupProfitIntelligence(ctx.orgId, parsed.data.range);

    logger.info("Group profit intelligence served", {
      route: "GET /api/profit/group",
      orgId: ctx.orgId,
      range: parsed.data.range,
      storeCount: result.stores.length,
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    Sentry.captureException(err);
    logger.error("Group profit intelligence failed", { route: "GET /api/profit/group", err });
    return NextResponse.json({ error: "Failed to load group profit intelligence" }, { status: 500 });
  }
}
