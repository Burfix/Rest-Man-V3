/**
 * /api/revenue/targets
 *
 * GET  ?from=YYYY-MM-DD&days=N  — returns targets for the given window (default: today + 30 days)
 * POST                          — upsert a single target (body: { target_date, target_sales?, target_covers?, notes? })
 * DELETE ?id=UUID               — remove a target by id
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/constants";
import { SalesTarget } from "@/types";

function todaySAST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
}

// ── GET: upcoming targets ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from   = isoDate(searchParams.get("from")) ?? todaySAST();
  const days   = Math.min(365, Math.max(1, parseInt(searchParams.get("days") ?? "30", 10)));
  const d      = new Date(from + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  const to   = d.toISOString().slice(0, 10);

  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("sales_targets") as any)
    .select("*")
    .eq("organization_id", DEFAULT_ORG_ID)
    .gte("target_date", from)
    .lte("target_date", to)
    .order("target_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ targets: (data ?? []) as SalesTarget[] });
}

// ── POST: upsert target ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const targetDate = isoDate(body.target_date);
  if (!targetDate) {
    return NextResponse.json(
      { error: "target_date is required and must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const targetSales  = body.target_sales  != null ? parseFloat(String(body.target_sales))  : null;
  const targetCovers = body.target_covers != null ? parseFloat(String(body.target_covers)) : null;
  const notes        = typeof body.notes === "string" ? body.notes.trim() || null : null;

  if (targetSales !== null && (isNaN(targetSales) || targetSales < 0)) {
    return NextResponse.json({ error: "target_sales must be a non-negative number" }, { status: 400 });
  }
  if (targetCovers !== null && (isNaN(targetCovers) || targetCovers < 0)) {
    return NextResponse.json({ error: "target_covers must be a non-negative number" }, { status: 400 });
  }

  const supabase = createServerClient();
  const now      = new Date().toISOString();

  const payload = {
    organization_id: DEFAULT_ORG_ID,
    target_date:     targetDate,
    target_sales:    targetSales,
    target_covers:   targetCovers,
    notes,
    updated_at:      now,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("sales_targets") as any)
    .upsert(payload, { onConflict: "organization_id,target_date" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ target: data as SalesTarget }, { status: 201 });
}

// ── DELETE: remove target ─────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query parameter is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("sales_targets") as any)
    .delete()
    .eq("id", id)
    .eq("organization_id", DEFAULT_ORG_ID); // guard: only delete own org's targets

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
