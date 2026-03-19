/**
 * GET  /api/actions        — list active (non-archived) actions
 * POST /api/actions        — create a new action
 *
 * GET query params:
 *   status  — filter by status (pending | in_progress | completed)
 *   include_archived — "true" to include archived actions
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getLatestRevenueFigure } from "@/lib/revenueSnapshot";

const VALID_STATUSES      = ["pending", "in_progress", "completed"] as const;
const VALID_IMPACT_LEVELS = ["critical", "high", "medium", "low"] as const;
const VALID_EXEC_TYPES    = ["call", "message", "staffing", "compliance"] as const;
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

    if (statusFilter && VALID_STATUSES.includes(statusFilter as never)) {
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
    const { title, description, impact_weight, assigned_to, source_type, source_id, zone_id, execution_type } =
      body as Record<string, string | undefined>;

    if (!title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    if (impact_weight && !VALID_IMPACT_LEVELS.includes(impact_weight as never)) {
      return NextResponse.json(
        { error: `impact_weight must be one of: ${VALID_IMPACT_LEVELS.join(", ")}` },
        { status: 400 }
      );
    }

    if (execution_type && !VALID_EXEC_TYPES.includes(execution_type as never)) {
      return NextResponse.json(
        { error: `execution_type must be one of: ${VALID_EXEC_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Capture revenue snapshot at the time of creation
    const rev = await getLatestRevenueFigure(supabase);

    const { data, error } = await supabase
      .from("actions")
      .insert({
        title:               title.trim(),
        description:         description?.trim() || null,
        impact_weight:       impact_weight || "medium",
        assigned_to:         assigned_to?.trim() || null,
        source_type:         source_type || null,
        source_id:           source_id   || null,
        zone_id:             zone_id     || null,
        site_id:             DEFAULT_SITE_ID,
        status:              "pending",
        execution_type:      execution_type || null,
        revenue_before:      rev.sales,
        revenue_date_before: rev.date,
      })
      .select()
      .single();

    if (error) {
      console.error("[POST /api/actions]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ action: data }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/actions] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
