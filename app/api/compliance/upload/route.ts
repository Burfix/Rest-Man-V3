import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const BUCKET = "compliance-docs";

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.UPLOAD_COMPLIANCE, "POST /api/compliance/upload");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const itemId = formData.get("item_id") as string | null;

    if (!file || !(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
    if (!itemId) return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
    }

    // Verify item exists
    const { data: item } = await (supabase as any)
      .from("compliance_items")
      .select("id")
      .eq("id", itemId)
      .maybeSingle();
    if (!item) return NextResponse.json({ error: "Compliance item not found" }, { status: 404 });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase().slice(0, 100);
    const storagePath = `${itemId}/${Date.now()}-${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadErr } = await (supabase as any).storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, { contentType: file.type, upsert: false });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = (supabase as any).storage.from(BUCKET).getPublicUrl(storagePath);
    const fileUrl: string = urlData?.publicUrl ?? storagePath;

    const { data: doc, error: dbErr } = await (supabase as any)
      .from("compliance_documents")
      .insert({ item_id: itemId, file_name: file.name, file_url: fileUrl, file_size: file.size })
      .select()
      .single();

    if (dbErr) {
      await (supabase as any).storage.from(BUCKET).remove([storagePath]);
      throw dbErr;
    }

    logger.info("Compliance document uploaded", { route: "POST /api/compliance/upload", siteId: ctx.siteId });
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    logger.error("Failed to upload compliance document", { route: "POST /api/compliance/upload", err });
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.UPLOAD_COMPLIANCE, "DELETE /api/compliance/upload");
  if (guard.error) return guard.error;
  const { supabase } = guard;

  const docId = new URL(req.url).searchParams.get("doc_id");
  if (!docId) return NextResponse.json({ error: "doc_id query param is required" }, { status: 400 });

  try {
    const { data: doc } = await (supabase as any)
      .from("compliance_documents")
      .select("id, file_url")
      .eq("id", docId)
      .maybeSingle();

    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const fileUrl: string = doc.file_url;
    const bucketPrefix = `/compliance-docs/`;
    const idx = fileUrl.indexOf(bucketPrefix);
    if (idx !== -1) {
      const storagePath = fileUrl.slice(idx + bucketPrefix.length);
      await (supabase as any).storage.from(BUCKET).remove([storagePath]);
    }

    const { error: deleteErr } = await (supabase as any)
      .from("compliance_documents")
      .delete()
      .eq("id", docId);
    if (deleteErr) throw deleteErr;

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    logger.error("Failed to delete compliance document", { route: "DELETE /api/compliance/upload", err });
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
