/**
 * POST  /api/maintenance/issue — log a new maintenance issue
 * PATCH /api/maintenance/issue — update repair_status on an existing log
 *
 * POST body (JSON):
 *   { equipment_id?, unit_name, category?, issue_title, issue_description?,
 *     priority, repair_status?, date_reported? }
 *
 * PATCH body (JSON):
 *   { id, repair_status, resolved_by?, date_resolved? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      equipment_id,
      unit_name,
      category,
      issue_title,
      issue_description,
      priority,
      repair_status,
      date_reported,
    } = body as {
      equipment_id?: string;
      unit_name?: string;
      category?: string;
      issue_title?: string;
      issue_description?: string;
      priority?: string;
      repair_status?: string;
      date_reported?: string;
    };

    if (!unit_name?.trim()) {
      return NextResponse.json({ error: "unit_name is required." }, { status: 400 });
    }
    if (!issue_title?.trim()) {
      return NextResponse.json({ error: "issue_title is required." }, { status: 400 });
    }
    if (!priority) {
      return NextResponse.json({ error: "priority is required." }, { status: 400 });
    }

    const validPriorities = ["urgent", "high", "medium", "low"];
    if (!validPriorities.includes(priority)) {
      return NextResponse.json(
        { error: `priority must be one of: ${validPriorities.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { data: log, error } = await supabase
      .from("maintenance_logs")
      .insert({
        equipment_id: equipment_id || null,
        unit_name: unit_name.trim(),
        category: category || "other",
        issue_title: issue_title.trim(),
        issue_description: issue_description?.trim() || null,
        priority,
        repair_status: repair_status || "open",
        date_reported:
          date_reported ||
          new Date()
            .toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" })
            .slice(0, 10),
      })
      .select()
      .single();

    if (error || !log) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to log issue." },
        { status: 500 }
      );
    }

    return NextResponse.json({ log }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, repair_status, resolved_by, date_resolved } = body as {
      id?: string;
      repair_status?: string;
      resolved_by?: string;
      date_resolved?: string;
    };

    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    if (!repair_status) {
      return NextResponse.json({ error: "repair_status is required." }, { status: 400 });
    }

    const validStatuses = ["open", "in_progress", "awaiting_parts", "resolved", "closed"];
    if (!validStatuses.includes(repair_status)) {
      return NextResponse.json(
        { error: `repair_status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const updatePayload: Record<string, string | null> = { repair_status };

    const isResolved = repair_status === "resolved" || repair_status === "closed";
    if (isResolved) {
      updatePayload.date_resolved =
        date_resolved ||
        new Date()
          .toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" })
          .slice(0, 10);
      updatePayload.resolved_by = resolved_by?.trim() || null;
    }

    const { data: log, error } = await supabase
      .from("maintenance_logs")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error || !log) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to update issue." },
        { status: 500 }
      );
    }

    return NextResponse.json({ log });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
