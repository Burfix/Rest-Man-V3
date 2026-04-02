import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createComplianceItemSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { invalidateBrainCacheForSite } from "@/lib/brain/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_COMPLIANCE, "GET /api/compliance/items");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const { data, error } = await (supabase as any)
      .from("compliance_items")
      .select("*, compliance_documents(*)")
      .order("next_due_date", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    logger.error("Failed to fetch compliance items", { route: "GET /api/compliance/items", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.EDIT_COMPLIANCE_ITEM, "POST /api/compliance/items");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(createComplianceItemSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const { data, error } = await (supabase as any)
      .from("compliance_items")
      .insert({
        display_name: d.display_name.trim(),
        category: d.category ?? null,
        description: d.description?.trim() || null,
        last_inspection_date: d.last_inspection_date ?? null,
        next_due_date: d.next_due_date ?? null,
        responsible_party: d.responsible_party?.trim() || null,
        notes: d.notes?.trim() || null,
      })
      .select()
      .single();

    if (error) throw error;
    invalidateBrainCacheForSite(ctx.siteId);
    logger.info("Compliance item created", { route: "POST /api/compliance/items", siteId: ctx.siteId });
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err) {
    logger.error("Failed to create compliance item", { route: "POST /api/compliance/items", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
