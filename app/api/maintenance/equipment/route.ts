/**
 * POST /api/maintenance/equipment
 *
 * Body (JSON): { unit_name, category, location?, status?, notes? }
 * Returns: { equipment: Equipment }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { unit_name, category, location, status, notes, serial_number, supplier, purchase_date, warranty_expiry } = body as {
      unit_name?: string;
      category?: string;
      location?: string;
      status?: string;
      notes?: string;
      serial_number?: string;
      supplier?: string;
      purchase_date?: string;
      warranty_expiry?: string;
    };

    if (!unit_name?.trim()) {
      return NextResponse.json({ error: "unit_name is required." }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: "category is required." }, { status: 400 });
    }

    const validCategories = ["kitchen", "bar", "facilities", "other"];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: `category must be one of: ${validCategories.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { data: equipment, error } = await supabase
      .from("equipment")
      .insert({
        unit_name: unit_name.trim(),
        category,
        location: location?.trim() || null,
        status: status || "operational",
        notes: notes?.trim() || null,
        serial_number: serial_number?.trim() || null,
        supplier: supplier?.trim() || null,
        purchase_date: purchase_date || null,
        warranty_expiry: warranty_expiry || null,
      })
      .select()
      .single();

    if (error || !equipment) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to add equipment." },
        { status: 500 }
      );
    }

    return NextResponse.json({ equipment }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/maintenance/equipment
 *
 * Body (JSON): { id, ...fields }
 * Updates any subset of: unit_name, category, location, status, notes,
 *   purchase_date, warranty_expiry, supplier, serial_number
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...fields } = body as Record<string, unknown>;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const allowed = [
      "unit_name", "category", "location", "status", "notes",
      "purchase_date", "warranty_expiry", "supplier", "serial_number",
    ];
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in fields) update[key] = fields[key] ?? null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("equipment")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
    }

    return NextResponse.json({ equipment: data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
