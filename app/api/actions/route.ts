/**
 * GET  /api/actions        — list active (non-archived) actions
 * POST /api/actions        — create a new action (once)
 *
 * GET query params:
 *   status  — filter by status (pending | in_progress | completed | escalated | cancelled)
 *   include_archived — "true" to include archived actions
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getLatestRevenueFigure } from "@/lib/revenueSnapshot";
import { ACTION_STATUSES, type ActionStatus } from "@/lib/actions/lifecycle";

const VALID_IMPACT_LEVELS = ["critical", "high", "medium", "low"] as const;
const VALID_CATEGORIES    = ["revenue", "labour", "food_cost", "stock", "maintenance", "compliance", "daily_ops", "service", "general"] as const;
const DEFAULT_SITE_ID     = "00000000-0000-0000-0000-000000000001";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const statusFilter      = searchParams.get("status");
    const includeArchived   = searchParams.get("include_archived") === "true";

    const supabase = createServerClient();
    let query = supabase
      .from("actions")
      .select("*")
      .order("created_at", { ascending: false });

    if (!includeArchived) {
      query = query.is("archived_at", null);
    }

    if (statusFilter && ACTION_STATUSES.includes(statusFilter as ActionStatus)) {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[GET /api/actions]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ actions: data ?? [] });
  } catch (err) {
    console.error("[GET /api/actions] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      title, direct_instruction, description,
      category, severity, status, owner,
      source_type, expected_impact_value, expected_impact_text,
      // Legacy field mapping
      impact_weight, assigned_to, assignee_role, source_module,
      source_id, zone_id, due_at, why_it_matters, expected_impact,
    } = body as Record<string, string | number | undefined>;

    if (!title || !String(title).trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    // Resolve status — respect request, default to pending
    const resolvedStatus: ActionStatus =
      status && ACTION_STATUSES.includes(status as ActionStatus)
        ? (status as ActionStatus)
        : "pending";

    // Resolve severity (canonical) or fall back to impact_weight (legacy)
    const resolvedSeverity = severity ?? impact_weight ?? "medium";
    if (!VALID_IMPACT_LEVELS.includes(resolvedSeverity as never)) {
      return NextResponse.json(
        { error: `severity must be one of: ${VALID_IMPACT_LEVELS.join(", ")}` },
        { status: 400 },
      );
    }

    const resolvedCategory = category && VALID_CATEGORIES.includes(category as never)
      ? category : null;

    const supabase = createServerClient();
    const rev = await getLatestRevenueFigure(supabase);

    const now = new Date().toISOString();
    const insert: Record<string, unknown> = {
      title:                String(title).trim(),
      direct_instruction:   direct_instruction ? String(direct_instruction).trim() : (description ? String(description).trim() : null),
      description:          description ? String(description).trim() : null,
      category:             resolvedCategory,
      severity:             resolvedSeverity,
      impact_weight:        resolvedSeverity,
      status:               resolvedStatus,
      owner:                owner ? String(owner).trim() : (assigned_to ? String(assigned_to).trim() : null),
      assigned_to:          assigned_to ? String(assigned_to).trim() : (owner ? String(owner).trim() : null),
      assignee_role:        assignee_role ? String(assignee_role) : null,
      source_type:          source_type ?? source_module ?? null,
      source_module:        source_module ?? source_type ?? null,
      source_id:            source_id ?? null,
      zone_id:              zone_id ?? null,
      due_at:               due_at ?? null,
      expected_impact_value: expected_impact_value ?? null,
      expected_impact:       expected_impact_text ?? expected_impact ?? null,
      why_it_matters:        why_it_matters ?? null,
      site_id:              DEFAULT_SITE_ID,
      revenue_before:       rev.sales,
      revenue_date_before:  rev.date,
    };

    // Set lifecycle timestamps based on initial status
    if (resolvedStatus === "in_progress") {
      insert.started_at = now;
    } else if (resolvedStatus === "escalated") {
      insert.escalated_at = now;
    }

    const { data, error } = await supabase
      .from("actions")
      .insert(insert as any)
      .select()
      .single();

    if (error) {
      console.error("[POST /api/actions]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Write creation event
    await (supabase.from("action_events" as any) as any).insert({
      action_id:  (data as { id: string }).id,
      event_type: resolvedStatus === "in_progress" ? "started" : "created",
      actor:      "system",
      metadata:   { initial_status: resolvedStatus },
    });

    return NextResponse.json({ action: data }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/actions] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
