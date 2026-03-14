/**
 * GET  /api/compliance/items   — list all compliance items with documents
 * POST /api/compliance/items   — create a new (custom) compliance item
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getAllComplianceItems, computeStatus } from "@/services/ops/complianceSummary";
import type { ComplianceItem } from "@/types";

export const dynamic = "force-dynamic";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  try {
    const items = await getAllComplianceItems();
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[GET /api/compliance/items]", err);
    return NextResponse.json({ error: "Failed to fetch compliance items" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Partial<ComplianceItem>;

    const { display_name, category, description, last_inspection_date, next_due_date, responsible_party, notes } = body;

    if (!display_name || typeof display_name !== "string" || display_name.trim().length === 0) {
      return NextResponse.json({ error: "display_name is required" }, { status: 400 });
    }

    const supabase = createServerClient();
    const status = computeStatus(next_due_date ?? null);

    const { data, error } = await (supabase as any)
      .from("compliance_items")
      .insert({
        category:             category?.trim() || "custom",
        display_name:         display_name.trim(),
        description:          description?.trim() ?? null,
        status,
        last_inspection_date: last_inspection_date ?? null,
        next_due_date:        next_due_date ?? null,
        responsible_party:    responsible_party?.trim() ?? null,
        notes:                notes?.trim() ?? null,
        is_default:           false,
      })
      .select()
      .single();

    if (error) {
      console.error("[POST /api/compliance/items]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ item: { ...data, status, documents: [] } }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/compliance/items]", err);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
