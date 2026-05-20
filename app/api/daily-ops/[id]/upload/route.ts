/**
 * POST /api/daily-ops/[id]/upload — upload evidence photo/file
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

const BUCKET = "ops-evidence";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/daily-ops/[id]/upload");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "Invalid file type" }, { status: 400 });

    // Verify task belongs to this site
    const { data: task, error: fetchErr } = await supabase
      .from("daily_ops_tasks")
      .select("id, site_id, task_date, evidence_urls")
      .eq("id", params.id)
      .eq("site_id", ctx.siteId)
      .single();

    if (fetchErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${ctx.siteId}/${(task as any).task_date}/${params.id}/${Date.now()}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: false });

    if (uploadErr) {
      logger.error("Evidence upload failed", { err: uploadErr });
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    // Append to evidence_urls array
    const existing = ((task as any).evidence_urls as string[]) ?? [];
    const { error: updateErr } = await supabase
      .from("daily_ops_tasks")
      .update({ evidence_urls: [...existing, publicUrl], updated_at: new Date().toISOString() })
      .eq("id", params.id);

    if (updateErr) {
      logger.error("Failed to update evidence_urls", { err: updateErr });
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    logger.error("Daily ops upload failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
