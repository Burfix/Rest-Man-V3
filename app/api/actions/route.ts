/**
 * GET  /api/actions        — list active (non-archived) actions
 * POST /api/actions        — create a new action (once)
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { getLatestRevenueFigure } from "@/lib/revenueSnapshot";
import { ACTION_STATUSES, type ActionStatus } from "@/lib/actions/lifecycle";
import { getExistingActionForDecision, linkDecisionToAction } from "@/lib/copilot/decision-store";
import { createActionSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/actions");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");
    const includeArchived = searchParams.get("include_archived") === "true";

    let query = supabase
      .from("actions")
      .select("*")
      .eq("site_id", ctx.siteId)
      .order("created_at", { ascending: false });

    if (!includeArchived) {
      query = query.is("archived_at", null);
    }
    if (statusFilter && ACTION_STATUSES.includes(statusFilter as ActionStatus)) {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      logger.error("Failed to fetch actions", { route: "GET /api/actions", err: error, siteId: ctx.siteId });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ actions: data ?? [] });
  } catch (err) {
    logger.error("Unexpected error", { route: "GET /api/actions", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/actions");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(createActionSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    // Decision dedup
    if (d.decision_id) {
      const existingActionId = await getExistingActionForDecision(d.decision_id);
      if (existingActionId) {
        return NextResponse.json({ action: { id: existingActionId }, deduplicated: true });
      }
    }

    const resolvedStatus: ActionStatus =
      d.status && ACTION_STATUSES.includes(d.status as ActionStatus)
        ? (d.status as ActionStatus)
        : "pending";
    const resolvedSeverity = d.severity ?? d.impact_weight ?? "medium";
    const now = new Date().toISOString();
    const rev = await getLatestRevenueFigure(supabase);

    const insert: Record<string, unknown> = {
      title: d.title.trim(),
      direct_instruction: d.direct_instruction?.trim() || d.description?.trim() || null,
      description: d.description?.trim() || null,
      category: d.category ?? "general",
      severity: resolvedSeverity,
      status: resolvedStatus,
      actor: ctx.email,
      owner: d.owner?.trim() || d.assigned_to?.trim() || null,
      assigned_to: d.assigned_to?.trim() || d.owner?.trim() || null,
      assignee_role: d.assignee_role ?? null,
      source_type: d.source_type ?? d.source_module ?? null,
      source_module: d.source_module ?? d.source_type ?? null,
      source_id: d.source_id ?? null,
      zone_id: d.zone_id ?? null,
      due_at: d.due_at ?? null,
      expected_impact_value: d.expected_impact_value ?? null,
      expected_impact: d.expected_impact_text ?? d.expected_impact ?? null,
      why_it_matters: d.why_it_matters ?? null,
      site_id: ctx.siteId,
      revenue_before: rev.sales,
      revenue_date_before: rev.date,
    };

    if (resolvedStatus === "in_progress") insert.started_at = now;
    else if (resolvedStatus === "escalated") insert.escalated_at = now;

    const { data, error } = await supabase
      .from("actions")
      .insert(insert as any)
      .select()
      .single();

    if (error) {
      logger.error("Failed to create action", { route: "POST /api/actions", err: error, siteId: ctx.siteId });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const actionId = (data as any).id;

    // Link decision
    if (d.decision_id) {
      linkDecisionToAction(d.decision_id, actionId).catch(() => {});
    }

    logger.info("Action created", { route: "POST /api/actions", actionId, siteId: ctx.siteId, userId: ctx.userId });
    return NextResponse.json({ action: data }, { status: 201 });
  } catch (err) {
    logger.error("Unexpected error", { route: "POST /api/actions", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
