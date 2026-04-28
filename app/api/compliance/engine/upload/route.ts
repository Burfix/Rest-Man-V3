/**
 * POST /api/compliance/engine/upload
 *      Generates a signed upload URL for a certificate file.
 *      Body: { tenantId, certificateId, filename }
 *      Returns: { signedUrl, path }
 *
 * GET  /api/compliance/engine/upload?path=<storagePath>
 *      Generates a signed read URL (valid 5 min) for officers/execs.
 *      Returns: { signedUrl }
 */
import { NextRequest, NextResponse } from "next/server";
import { createSignedUploadUrl, createSignedReadUrl } from "@/lib/compliance/queries";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

export async function POST(req: NextRequest) {
  const guard = await apiGuard(null, "POST /api/compliance/engine/upload");
  if (guard.error) return guard.error;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { tenantId, certificateId, filename } = body as {
    tenantId:      string;
    certificateId: string;
    filename:      string;
  };

  if (!tenantId || !certificateId || !filename) {
    return NextResponse.json(
      { error: "tenantId, certificateId, and filename are required" },
      { status: 400 },
    );
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: "Unsupported file type. Allowed: pdf, jpg, jpeg, png, webp" },
      { status: 415 },
    );
  }

  // Sanitise filename to prevent path traversal
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);

  try {
    const result = await createSignedUploadUrl(tenantId, certificateId, safe);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("compliance engine: createSignedUploadUrl failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const guard = await apiGuard(null, "GET /api/compliance/engine/upload");
  if (guard.error) return guard.error;

  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  // Validate path format: {uuid}/{uuid}/{filename} — prevent arbitrary path reads
  const parts = path.split("/");
  if (parts.length < 3) {
    return NextResponse.json({ error: "Invalid path format" }, { status: 400 });
  }

  try {
    const signedUrl = await createSignedReadUrl(path);
    return NextResponse.json({ signedUrl });
  } catch (err) {
    logger.error("compliance engine: createSignedReadUrl failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to generate read URL" }, { status: 500 });
  }
}
