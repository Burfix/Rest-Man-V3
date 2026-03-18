/**
 * PATCH /api/actions/[id]
 *
 * Update an action's status, assignment, or details.
 *
 * Body (JSON):
 *   { op: "assign" | "start" | "complete" | "update", ...fields }
 *
 *   op=assign:   { assigned_to: string }
 *   op=start:    (no extra fields — sets status→in_progress, started_at=now)
 *   op=complete: (no extra fields — sets status→completed, completed_at=now)
 *   op=update:   { title?, description?, impact_weight?, assigned_to? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

const VALID_IMPACT_LEVELS = ["critical", "high", "medium", "low"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const body = await req.json();
    const { op, title, description, impact_weight, assigned_to } =
      body as Record<string, string | undefined>;

    const supabase = createServerClient();

    // Verify action exists
    const { data: existing, error: fetchErr } = await supabase
      .from("actions")
      .select("id, status")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    let update: Record<string, string | null> = {};

    switch (op) {
      case "assign": {
        if (!assigned_to?.trim()) {
          return NextResponse.json({ error: "assigned_to is required for assign op" }, { status: 400 });
        }
        update = { assigned_to: assigned_to.trim() };
        break;
      }

      case "start": {
        if (existing.status === "completed") {
          return NextResponse.json({ error: "Cannot restart a completed action" }, { status: 409 });
        }
        update = {
          status:     "in_progress",
          started_at: new Date().toISOString(),
        };
        break;
      }

      case "complete": {
        update = {
          status:       "completed",
          completed_at: new Date().toISOString(),
        };
        if (!existing.status || existing.status === "pending") {
          update.started_at = new Date().toISOString();
        }
        break;
      }

      case "update": {
        if (impact_weight && !VALID_IMPACT_LEVELS.includes(impact_weight as never)) {
          return NextResponse.json(
            { error: `impact_weight must be one of: ${VALID_IMPACT_LEVELS.join(", ")}` },
            { status: 400 }
          );
        }
        if (title !== undefined) update.title = title.trim();
        if (description !== undefined) update.description = description?.trim() || null;
        if (impact_weight !== undefined) update.impact_weight = impact_weight;
        if (assigned_to !== undefined) update.assigned_to = assigned_to?.trim() || null;
        break;
      }

      default:
        return NextResponse.json(
          { error: "op must be one of: assign | start | complete | update" },
          { status: 400 }
        );
    }

    const { data, error } = await supabase
      .from("actions")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error(`[PATCH /api/actions/${id}]`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ action: data });
  } catch (err) {
    console.error(`[PATCH /api/actions/${id}] unexpected:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("actions")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(`[DELETE /api/actions/${id}]`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`[DELETE /api/actions/${id}] unexpected:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
