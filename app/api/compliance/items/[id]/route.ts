import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { updateComplianceItemSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { invalidateBrainCacheForSite } from "@/lib/brain/cache";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await apiGuard(PERMISSIONS.VIEW_COMPLIANCE, "GET /api/compliance/items/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const { data, error } = await (supabase as any)
      .from("compliance_items")
      .select("*, compliance_documents(*)")
      .eq("id", id)
      .single();

    if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (err) {
    logger.error("Failed to fetch compliance item", { route: "GET /api/compliance/items/[id]", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await apiGuard(PERMISSIONS.EDIT_COMPLIANCE_ITEM, "PUT /api/compliance/items/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(updateComplianceItemSchema, body);
    if (!v.success) return v.response;

    const { data, error } = await (supabase as any)
      .from("compliance_items")
      .update(v.data)
      .eq("id", id)
      .select();

    if (error) {
      logger.error("[compliance] update error", { error });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    invalidateBrainCacheForSite(ctx.siteId);
    return NextResponse.json({ item: data[0] });
  } catch (err) {
    logger.error("Failed to update compliance item", { route: "PUT /api/compliance/items/[id]", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await apiGuard(PERMISSIONS.EDIT_COMPLIANCE_ITEM, "DELETE /api/compliance/items/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const { error } = await (supabase as any)
      .from("compliance_items")
      .delete()
      .eq("id", id);

    if (error) throw error;
    invalidateBrainCacheForSite(ctx.siteId);
    logger.info("Compliance item deleted", { route: "DELETE /api/compliance/items/[id]", itemId: id, siteId: ctx.siteId });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Failed to delete compliance item", { route: "DELETE /api/compliance/items/[id]", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
