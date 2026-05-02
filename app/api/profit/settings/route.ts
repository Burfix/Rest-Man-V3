/**
 * GET  /api/profit/settings  — read current profit settings for a site
 * POST /api/profit/settings  — update profit settings for a site
 *
 * Query params (GET):
 *   siteId – optional for org-level users
 *
 * Body (POST):
 *   siteId                – uuid (required)
 *   targetFoodCostPct     – number 0–100
 *   targetLabourPct       – number 0–100
 *   dailyOverheadEstimate – number >= 0
 *   targetMarginPct       – number 0–100
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { createServerClient } from "@/lib/supabase/server";
import { clearSiteConfigCache } from "@/lib/config/site";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";

const WRITE_ROLES = ["super_admin", "executive", "head_office", "tenant_owner", "gm"];

// ── GET ───────────────────────────────────────────────────────────────────────

const getSchema = z.object({
  siteId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_FINANCIALS, "GET /api/profit/settings");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  try {
    const params = Object.fromEntries(new URL(req.url).searchParams.entries());
    const parsed = getSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const targetSiteId = parsed.data.siteId ?? ctx.siteId;
    if (!targetSiteId) {
      return NextResponse.json({ error: "No site context" }, { status: 400 });
    }

    const supabase = createServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("profit_settings")
      .select("*")
      .eq("site_id", targetSiteId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ data: data ?? null });
  } catch (err) {
    Sentry.captureException(err);
    logger.error("Failed to load profit settings", { route: "GET /api/profit/settings", err });
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

const postSchema = z.object({
  siteId:                z.string().uuid(),
  targetFoodCostPct:     z.number().min(0).max(100).optional(),
  targetLabourPct:       z.number().min(0).max(100).optional(),
  dailyOverheadEstimate: z.number().min(0).optional(),
  targetMarginPct:       z.number().min(0).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_STORE_SETTINGS, "POST /api/profit/settings");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  if (!WRITE_ROLES.includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "Insufficient permissions to update profit settings" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const d = parsed.data;

    // Non-org users cannot update another site's settings
    const isOrgUser = ["super_admin", "executive", "head_office", "tenant_owner"].includes(ctx.role ?? "");
    if (!isOrgUser && d.siteId !== ctx.siteId) {
      return NextResponse.json({ error: "Access denied to that site" }, { status: 403 });
    }

    const supabase = createServerClient();
    const upsertPayload: Record<string, unknown> = { site_id: d.siteId };
    if (d.targetFoodCostPct     != null) upsertPayload.target_food_cost_pct     = d.targetFoodCostPct;
    if (d.targetLabourPct       != null) upsertPayload.target_labour_pct        = d.targetLabourPct;
    if (d.dailyOverheadEstimate != null) upsertPayload.daily_overhead_estimate  = d.dailyOverheadEstimate;
    if (d.targetMarginPct       != null) upsertPayload.target_margin_pct        = d.targetMarginPct;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("profit_settings")
      .upsert(upsertPayload, { onConflict: "site_id" })
      .select()
      .single();

    if (error) throw error;

    // Clear cached site config so next request picks up new targets
    clearSiteConfigCache();

    logger.info("Profit settings updated", {
      route: "POST /api/profit/settings",
      siteId: d.siteId,
      updatedBy: ctx.userId,
    });

    return NextResponse.json({ data });
  } catch (err) {
    Sentry.captureException(err);
    logger.error("Failed to update profit settings", { route: "POST /api/profit/settings", err });
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
