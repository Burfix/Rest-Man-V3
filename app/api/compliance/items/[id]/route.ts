/**
 * GET    /api/compliance/items/[id]  — fetch one item
 * PUT    /api/compliance/items/[id]  — update item fields
 * DELETE /api/compliance/items/[id]  — delete item (non-default only)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getComplianceItem, computeStatus } from "@/services/ops/complianceSummary";
import type { ComplianceItem } from "@/types";

export const dynamic = "force-dynamic";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const item = await getComplianceItem(params.id);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (err) {
    console.error(`[GET /api/compliance/items/${params.id}]`, err);
    return NextResponse.json({ error: "Failed to fetch item" }, { status: 500 });
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const body = await req.json() as Partial<ComplianceItem>;

    const allowedFields: (keyof ComplianceItem)[] = [
      "display_name",
      "description",
      "last_inspection_date",
      "next_due_date",
      "responsible_party",
      "notes",
    ];

    const update: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        const val = body[field];
        update[field] = typeof val === "string" ? val.trim() || null : val ?? null;
      }
    }

    // Recompute status from updated due date
    const newDue = ("next_due_date" in update)
      ? (update.next_due_date as string | null)
      : undefined;

    if (newDue !== undefined) {
      update.status = computeStatus(newDue);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data, error } = await (supabase as any)
      .from("compliance_items")
      .update(update)
      .eq("id", params.id)
      .select()
      .single();

    if (error) {
      console.error(`[PUT /api/compliance/items/${params.id}]`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Return updated item with live status
    const item = { ...data, status: computeStatus(data.next_due_date) };
    return NextResponse.json({ item });
  } catch (err) {
    console.error(`[PUT /api/compliance/items/${params.id}]`, err);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const supabase = createServerClient();

    // Prevent deleting seeded default categories
    const { data: existing } = await (supabase as any)
      .from("compliance_items")
      .select("is_default")
      .eq("id", params.id)
      .maybeSingle();

    if (existing?.is_default) {
      return NextResponse.json(
        { error: "Default compliance categories cannot be deleted" },
        { status: 409 }
      );
    }

    const { error } = await (supabase as any)
      .from("compliance_items")
      .delete()
      .eq("id", params.id);

    if (error) {
      console.error(`[DELETE /api/compliance/items/${params.id}]`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(`[DELETE /api/compliance/items/${params.id}]`, err);
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 });
  }
}
