/**
 * app/api/action-events/route.ts
 *
 * POST /api/action-events
 *
 * Records a GM intervention against an operational risk signal.
 * Called when a GM clicks "mark as actioned" on the Command Center.
 *
 * Body:
 *   { risk_id, outcome_note? }
 *
 * Response:
 *   { data: ActionEvent, error: null, meta: { ... } }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext, AuthError }  from "@/lib/auth/get-user-context";
import { createServerClient }         from "@/lib/supabase/server";
import { z }                          from "zod";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

const BodySchema = z.object({
  risk_id:      z.string().min(1).max(64),
  outcome_note: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const requestedAt = new Date().toISOString();

  // ── Auth ─────────────────────────────────────────────────────────────────────
  let ctx;
  try {
    ctx = await getUserContext();
  } catch (err) {
    if (err instanceof AuthError && err.statusCode === 401) {
      return NextResponse.json(
        { data: null, error: "Unauthorised", meta: { requestedAt } },
        { status: 401 },
      );
    }
    throw err;
  }

  if (!ctx?.siteId) {
    return NextResponse.json(
      { data: null, error: "No site assigned", meta: { requestedAt } },
      { status: 403 },
    );
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { data: null, error: "Invalid JSON body", meta: { requestedAt } },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.message, meta: { requestedAt } },
      { status: 400 },
    );
  }

  const { risk_id, outcome_note } = parsed.data;

  // ── Insert ───────────────────────────────────────────────────────────────────
  try {
    const supabase = createServerClient() as any;

    const { data, error } = await supabase
      .from("action_events")
      .insert({
        site_id:         ctx.siteId,
        risk_id,
        actioned_by:     ctx.userId,
        acknowledged_at: requestedAt,
        outcome_note:    outcome_note ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error("[action-events] insert failed:", error.message, { siteId: ctx.siteId, risk_id });
      return NextResponse.json(
        { data: null, error: "Failed to record action event", meta: { requestedAt } },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { data, error: null, meta: { requestedAt, siteId: ctx.siteId } },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[action-events] unexpected error:", message);
    return NextResponse.json(
      { data: null, error: "Unexpected error", meta: { requestedAt } },
      { status: 500 },
    );
  }
}
