/**
 * GET  /api/compliance/engine/certificates?tenant_id=<uuid>
 *      List certificates for a tenant.
 *
 * POST /api/compliance/engine/certificates
 *      Upsert a certificate (tenant + type combo).
 *      Body: { tenantId, certificateTypeId, fileUrl?, status?, expiryDate? }
 *
 * PATCH /api/compliance/engine/certificates
 *      Update status (officer review outcome).
 *      Body: { id, status }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getCertificatesByTenant,
  updateCertificateStatus,
  upsertCertificate,
  writeComplianceAuditLog,
  type CertificateStatus,
} from "@/lib/compliance/queries";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(null, "GET /api/compliance/engine/certificates");
  if (guard.error) return guard.error;
  const tenantId = req.nextUrl.searchParams.get("tenant_id");
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
  }

  try {
    const certs = await getCertificatesByTenant(tenantId);
    return NextResponse.json({ data: certs, count: certs.length });
  } catch (err) {
    logger.error("compliance engine: getCertificatesByTenant failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to load certificates" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(null, "POST /api/compliance/engine/certificates");
  if (guard.error) return guard.error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { tenantId, certificateTypeId, fileUrl, status, expiryDate } = body as {
    tenantId:           string;
    certificateTypeId:  string;
    fileUrl?:           string;
    status?:            CertificateStatus;
    expiryDate?:        string;
  };

  if (!tenantId || !certificateTypeId) {
    return NextResponse.json(
      { error: "tenantId and certificateTypeId are required" },
      { status: 400 },
    );
  }

  try {
    const cert = await upsertCertificate({ tenantId, certificateTypeId, fileUrl, status, expiryDate });
    await writeComplianceAuditLog({
      action:    "certificate_upserted",
      tenantId,
      metadata:  { certificateId: cert.id, status: cert.status },
    });
    return NextResponse.json({ data: cert }, { status: 200 });
  } catch (err) {
    logger.error("compliance engine: upsertCertificate failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to upsert certificate" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await apiGuard(null, "PATCH /api/compliance/engine/certificates");
  if (guard.error) return guard.error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, status } = body as { id: string; status: CertificateStatus };

  if (!id || !status) {
    return NextResponse.json({ error: "id and status are required" }, { status: 400 });
  }

  const validStatuses: CertificateStatus[] = [
    "APPROVED", "AWAITING_REVIEW", "REJECTED", "EXPIRED", "MISSING",
  ];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
  }

  try {
    await updateCertificateStatus(id, status);
    await writeComplianceAuditLog({
      action:   "certificate_status_updated",
      metadata: { certificateId: id, newStatus: status },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("compliance engine: updateCertificateStatus failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to update certificate status" }, { status: 500 });
  }
}
