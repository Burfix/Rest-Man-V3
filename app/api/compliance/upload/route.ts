/**
 * POST /api/compliance/upload
 *
 * Accepts a multipart/form-data request containing:
 *   - file:    the certificate/document file (PDF, image, etc.)
 *   - item_id: the UUID of the compliance item to attach to
 *
 * Uploads the file to Supabase Storage (bucket: compliance-docs),
 * inserts a compliance_documents record, and returns the document metadata.
 *
 * DELETE /api/compliance/upload?doc_id=<uuid>
 *
 * Removes a document from storage and the database.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 10 MB upload limit
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const BUCKET = "compliance-docs";

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const file = formData.get("file") as File | null;
    const itemId = formData.get("item_id") as string | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
    }

    // Validate mime type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Allowed: PDF, images, Word documents." },
        { status: 415 }
      );
    }

    const supabase = createServerClient();

    // Verify item exists
    const { data: item, error: itemErr } = await (supabase as any)
      .from("compliance_items")
      .select("id")
      .eq("id", itemId)
      .maybeSingle();

    if (itemErr || !item) {
      return NextResponse.json({ error: "Compliance item not found" }, { status: 404 });
    }

    // Build a safe storage path:  {item_id}/{timestamp}-{sanitised-filename}
    const timestamp = Date.now();
    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .toLowerCase()
      .slice(0, 100);
    const storagePath = `${itemId}/${timestamp}-${safeName}`;

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadErr } = await (supabase as any).storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) {
      console.error("[compliance/upload] Storage upload failed:", uploadErr);
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadErr.message}` },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = (supabase as any).storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    const fileUrl: string = urlData?.publicUrl ?? storagePath;

    // Insert document record
    const { data: doc, error: dbErr } = await (supabase as any)
      .from("compliance_documents")
      .insert({
        item_id:   itemId,
        file_name: file.name,
        file_url:  fileUrl,
        file_size: file.size,
      })
      .select()
      .single();

    if (dbErr) {
      console.error("[compliance/upload] DB insert failed:", dbErr);
      // Best-effort: remove the uploaded file to avoid orphans
      await (supabase as any).storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }

    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/compliance/upload]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get("doc_id");

    if (!docId) {
      return NextResponse.json({ error: "doc_id query param is required" }, { status: 400 });
    }

    const supabase = createServerClient();

    // Fetch the document to get storage path
    const { data: doc, error: fetchErr } = await (supabase as any)
      .from("compliance_documents")
      .select("id, file_url")
      .eq("id", docId)
      .maybeSingle();

    if (fetchErr || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Extract storage path from URL (everything after /compliance-docs/)
    const fileUrl: string = doc.file_url;
    const bucketPrefix = `/compliance-docs/`;
    const storagePathStart = fileUrl.indexOf(bucketPrefix);
    if (storagePathStart !== -1) {
      const storagePath = fileUrl.slice(storagePathStart + bucketPrefix.length);
      await (supabase as any).storage.from(BUCKET).remove([storagePath]);
    }

    const { error: deleteErr } = await (supabase as any)
      .from("compliance_documents")
      .delete()
      .eq("id", docId);

    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[DELETE /api/compliance/upload]", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
