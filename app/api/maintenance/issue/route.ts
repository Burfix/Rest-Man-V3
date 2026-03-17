/**
 * POST  /api/maintenance/issue  — log a new maintenance issue
 * PATCH /api/maintenance/issue  — update status or fully resolve an issue
 *
 * POST body (JSON):
 *   { equipment_id?, unit_name, category?, issue_title, issue_description?,
 *     priority, impact_level?, reported_by?, repair_status?, date_reported? }
 *
 * PATCH body (JSON):
 *   { id, repair_status,
 *     // resolve fields (all optional):
 *     fixed_by?, fixed_by_type?, contractor_name?, contractor_contact?,
 *     date_fixed?, actual_cost?, downtime_minutes?,
 *     resolution_notes?, root_cause?,
 *     follow_up_required?, follow_up_notes?,
 *     // legacy backward compat:
 *     resolved_by?, date_resolved? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

const VALID_PRIORITIES    = ["urgent", "high", "medium", "low"] as const;
const VALID_STATUSES      = ["open", "in_progress", "awaiting_parts", "resolved", "closed"] as const;
const VALID_IMPACT_LEVELS = ["none", "minor", "service_disruption", "revenue_loss", "compliance_risk", "food_safety_risk"] as const;
const VALID_FIXED_BY_TYPE = ["contractor", "internal_staff", "supplier", "unknown"] as const;

function todayJHB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      equipment_id, unit_name, category,
      issue_title, issue_description,
      priority, impact_level, reported_by,
      repair_status, date_reported,
    } = body as Record<string, string | undefined>;

    if (!unit_name?.trim())   return NextResponse.json({ error: "unit_name is required."   }, { status: 400 });
    if (!issue_title?.trim()) return NextResponse.json({ error: "issue_title is required." }, { status: 400 });
    if (!priority)            return NextResponse.json({ error: "priority is required."    }, { status: 400 });

    if (!VALID_PRIORITIES.includes(priority as never)) {
      return NextResponse.json({ error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` }, { status: 400 });
    }
    if (impact_level && !VALID_IMPACT_LEVELS.includes(impact_level as never)) {
      return NextResponse.json({ error: `impact_level must be one of: ${VALID_IMPACT_LEVELS.join(", ")}` }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: log, error } = await supabase
      .from("maintenance_logs")
      .insert({
        equipment_id:      equipment_id  || null,
        unit_name:         unit_name.trim(),
        category:          category       || "other",
        issue_title:       issue_title.trim(),
        issue_description: issue_description?.trim() || null,
        priority,
        impact_level:      impact_level  || "none",
        reported_by:       reported_by?.trim() || null,
        repair_status:     repair_status  || "open",
        date_reported:     date_reported  || todayJHB(),
      })
      .select()
      .single();

    if (error || !log)
      return NextResponse.json({ error: error?.message ?? "Failed to log issue." }, { status: 500 });
    return NextResponse.json({ log }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      id, repair_status,
      fixed_by, fixed_by_type, contractor_name, contractor_contact,
      date_fixed, actual_cost, downtime_minutes,
      resolution_notes, root_cause,
      follow_up_required, follow_up_notes,
      resolved_by, date_resolved,
    } = body as Record<string, string | number | boolean | undefined>;

    if (!id)            return NextResponse.json({ error: "id is required."            }, { status: 400 });
    if (!repair_status) return NextResponse.json({ error: "repair_status is required." }, { status: 400 });

    if (!VALID_STATUSES.includes(repair_status as never))
      return NextResponse.json({ error: `repair_status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
    if (fixed_by_type && !VALID_FIXED_BY_TYPE.includes(fixed_by_type as never))
      return NextResponse.json({ error: `fixed_by_type must be one of: ${VALID_FIXED_BY_TYPE.join(", ")}` }, { status: 400 });

    const isResolved  = repair_status === "resolved" || repair_status === "closed";
    const resolveDate = (date_fixed as string) || (date_resolved as string) || (isResolved ? todayJHB() : undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = { repair_status };

    if (isResolved || date_fixed) {
      update.date_fixed    = resolveDate;
      update.date_resolved = resolveDate; // keep legacy field in sync
    }
    if (fixed_by)           update.fixed_by           = (fixed_by as string).trim() || null;
    if (resolved_by)        update.resolved_by         = (resolved_by as string).trim() || null;
    if (fixed_by_type)      update.fixed_by_type       = fixed_by_type;
    if (contractor_name)    update.contractor_name     = (contractor_name as string).trim() || null;
    if (contractor_contact) update.contractor_contact  = (contractor_contact as string).trim() || null;
    if (actual_cost     != null) update.actual_cost      = Number(actual_cost);
    if (downtime_minutes != null) update.downtime_minutes = Number(downtime_minutes);
    if (resolution_notes)   update.resolution_notes    = (resolution_notes as string).trim() || null;
    if (root_cause)         update.root_cause           = (root_cause as string).trim() || null;
    if (follow_up_required != null) update.follow_up_required = Boolean(follow_up_required);
    if (follow_up_notes)    update.follow_up_notes      = (follow_up_notes as string).trim() || null;

    const supabase = createServerClient();
    const { data: log, error } = await supabase
      .from("maintenance_logs")
      .update(update)
      .eq("id", id as string)
      .select()
      .single();

    if (error || !log) {
      return NextResponse.json({ error: error?.message ?? "Failed to update issue." }, { status: 500 });
    }
    return NextResponse.json({ log });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
