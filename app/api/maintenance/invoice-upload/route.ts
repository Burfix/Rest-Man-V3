import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_MAINTENANCE, "POST /api/maintenance/invoice-upload");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const equipmentId = formData.get("equipment_id") as string | null;

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!equipmentId) return NextResponse.json({ error: "equipment_id required" }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Only PDF, JPEG, PNG and WebP are allowed" }, { status: 415 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
    }

    const ext = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") ?? "bin";
    const safeName = `${Date.now()}.${ext}`;
    const path = `${equipmentId}/${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage
      .from("repair-invoices")
      .upload(path, buffer, { contentType: file.type, upsert: false });

    if (error) throw error;

    const { data: urlData } = supabase.storage.from("repair-invoices").getPublicUrl(path);
    logger.info("Invoice uploaded", { route: "POST /api/maintenance/invoice-upload", siteId: ctx.siteId });
    return NextResponse.json({ url: urlData.publicUrl }, { status: 201 });
  } catch (err) {
    logger.error("Failed to upload invoice", { route: "POST /api/maintenance/invoice-upload", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
