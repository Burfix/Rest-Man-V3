/**
 * POST /api/maintenance/invoice-upload
 *
 * Uploads a repair invoice PDF/image to Supabase Storage.
 * Returns { url } — the public file URL to store in invoice_file_url.
 *
 * Allowed: PDF, JPEG, PNG, WebP — max 10 MB.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
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

    // Sanitize filename
    const ext = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") ?? "bin";
    const safeName = `${Date.now()}.${ext}`;
    const path = `${equipmentId}/${safeName}`;

    const supabase = createServerClient();
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error } = await supabase.storage
      .from("repair-invoices")
      .upload(path, buffer, { contentType: file.type, upsert: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage
      .from("repair-invoices")
      .getPublicUrl(path);

    return NextResponse.json({ url: urlData.publicUrl }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
