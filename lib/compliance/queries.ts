/**
 * lib/compliance/queries.ts
 *
 * Data access layer for the Compliance Engine module.
 * All queries run with the service_role key (bypasses RLS).
 * Called directly by server components and API route handlers.
 *
 * Tables: tenants, compliance_users, certificate_types,
 *         certificates, certificate_reviews, compliance_audit_log
 * Views:  v_compliance_risk, v_compliance_expiring_soon,
 *         v_compliance_summary_by_tenant
 */

import { createClient } from "@supabase/supabase-js";

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type CertificateStatus =
  | "APPROVED"
  | "AWAITING_REVIEW"
  | "REJECTED"
  | "EXPIRED"
  | "MISSING";

export type ComplianceRole = "SUPER_ADMIN" | "EXECUTIVE" | "OFFICER" | "TENANT";

export type Tenant = {
  id:         string;
  name:       string;
  precinct:   string | null;
  created_at: string;
};

export type ComplianceUser = {
  id:         string;
  username:   string;
  email:      string | null;
  role:       ComplianceRole;
  tenant_id:  string | null;
  created_at: string;
  updated_at: string;
};

export type CertificateType = {
  id:       string;
  name:     string;
  required: boolean;
};

export type Certificate = {
  id:                  string;
  tenant_id:           string;
  certificate_type_id: string | null;
  file_url:            string | null;
  status:              CertificateStatus;
  expiry_date:         string | null;
  uploaded_at:         string | null;
  created_at:          string;
  updated_at:          string;
  // Joined
  tenant?:             Pick<Tenant, "id" | "name" | "precinct">;
  certificate_type?:   Pick<CertificateType, "id" | "name">;
};

export type CertificateReview = {
  id:             string;
  certificate_id: string;
  reviewer_id:    string | null;
  action:         string | null;
  comment:        string | null;
  created_at:     string;
};

export type RiskRow = {
  tenant_id:           string;
  tenant:              string;
  precinct:            string | null;
  certificate_type:    string | null;
  certificate_id:      string;
  status:              CertificateStatus;
  expiry_date:         string | null;
  risk_level:          "CRITICAL" | "WARNING" | "INFO";
  // Action engine (migration 072)
  recommended_action:  string | null;
  action_owner:        "TENANT" | "OFFICER" | null;
  action_deadline:     string | null;
};

export type ExpiringRow = {
  certificate_id:      string;
  tenant_id:           string;
  tenant:              string;
  precinct:            string | null;
  certificate_type_id: string;
  certificate_type:    string;
  status:              CertificateStatus;
  expiry_date:         string;
  expiry_window:       "EXPIRED" | "30_DAYS" | "60_DAYS" | "90_DAYS" | "OK";
  days_until_expiry:   number;
};

export type TenantSummary = {
  tenant_id:        string;
  tenant:           string;
  precinct:         string | null;
  total_certificates: number;
  approved:         number;
  awaiting_review:  number;
  rejected:         number;
  expired:          number;
  missing:          number;
  expiring_30_days: number;
  compliance_pct:   number | null;
};

// ── Tenants ───────────────────────────────────────────────────────────────────

export async function getTenants(): Promise<Tenant[]> {
  const { data, error } = await serviceDb()
    .from("tenants")
    .select("id, name, precinct, created_at")
    .order("name");
  if (error) throw new Error(`getTenants: ${error.message}`);
  return (data ?? []) as Tenant[];
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const { data, error } = await serviceDb()
    .from("tenants")
    .select("id, name, precinct, created_at")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as Tenant;
}

export async function createTenant(
  name: string,
  precinct?: string,
): Promise<Tenant> {
  const { data, error } = await serviceDb()
    .from("tenants")
    .insert({ name, precinct: precinct ?? null })
    .select()
    .single();
  if (error) throw new Error(`createTenant: ${error.message}`);
  return data as Tenant;
}

// ── Certificates ──────────────────────────────────────────────────────────────

export async function getCertificatesByTenant(tenantId: string): Promise<Certificate[]> {
  const { data, error } = await serviceDb()
    .from("certificates")
    .select(`
      id, tenant_id, certificate_type_id, file_url, status,
      expiry_date, uploaded_at, created_at, updated_at,
      certificate_types ( id, name )
    `)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getCertificatesByTenant: ${error.message}`);
  return (data ?? []) as unknown as Certificate[];
}

export async function getCertificateById(id: string): Promise<Certificate | null> {
  const { data, error } = await serviceDb()
    .from("certificates")
    .select(`
      id, tenant_id, certificate_type_id, file_url, status,
      expiry_date, uploaded_at, created_at, updated_at,
      tenants ( id, name, precinct ),
      certificate_types ( id, name )
    `)
    .eq("id", id)
    .single();
  if (error) return null;
  return data as unknown as Certificate;
}

export async function updateCertificateStatus(
  id: string,
  status: CertificateStatus,
  fileUrl?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (fileUrl !== undefined) patch.file_url = fileUrl;
  if (status === "AWAITING_REVIEW") patch.uploaded_at = new Date().toISOString();

  const { error } = await serviceDb()
    .from("certificates")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(`updateCertificateStatus: ${error.message}`);
}

export async function upsertCertificate(input: {
  tenantId:           string;
  certificateTypeId:  string;
  fileUrl?:           string;
  status?:            CertificateStatus;
  expiryDate?:        string;
}): Promise<Certificate> {
  const { data, error } = await serviceDb()
    .from("certificates")
    .upsert(
      {
        tenant_id:           input.tenantId,
        certificate_type_id: input.certificateTypeId,
        file_url:            input.fileUrl ?? null,
        status:              input.status ?? "MISSING",
        expiry_date:         input.expiryDate ?? null,
        uploaded_at:         input.fileUrl ? new Date().toISOString() : null,
      },
      { onConflict: "tenant_id,certificate_type_id" },
    )
    .select()
    .single();
  if (error) throw new Error(`upsertCertificate: ${error.message}`);
  return data as Certificate;
}

// ── Certificate Reviews ───────────────────────────────────────────────────────

export async function getReviewsByCertificate(
  certificateId: string,
): Promise<CertificateReview[]> {
  const { data, error } = await serviceDb()
    .from("certificate_reviews")
    .select("id, certificate_id, reviewer_id, action, comment, created_at")
    .eq("certificate_id", certificateId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getReviewsByCertificate: ${error.message}`);
  return (data ?? []) as CertificateReview[];
}

export async function createReview(input: {
  certificateId: string;
  reviewerId?:   string;
  action:        string;
  comment?:      string;
  newStatus:     CertificateStatus;
}): Promise<void> {
  const db = serviceDb();

  const { error: reviewError } = await db
    .from("certificate_reviews")
    .insert({
      certificate_id: input.certificateId,
      reviewer_id:    input.reviewerId ?? null,
      action:         input.action,
      comment:        input.comment ?? null,
    });
  if (reviewError) throw new Error(`createReview (insert): ${reviewError.message}`);

  const { error: statusError } = await db
    .from("certificates")
    .update({ status: input.newStatus })
    .eq("id", input.certificateId);
  if (statusError) throw new Error(`createReview (status update): ${statusError.message}`);
}

// ── Risk view ─────────────────────────────────────────────────────────────────

export async function getRiskFlags(
  filter?: { riskLevel?: "CRITICAL" | "WARNING" | "INFO" },
): Promise<RiskRow[]> {
  let q = serviceDb()
    .from("v_compliance_risk")
    .select("tenant_id, tenant, precinct, certificate_type, certificate_id, status, expiry_date, risk_level, recommended_action, action_owner, action_deadline")
    .order("risk_level");

  if (filter?.riskLevel) {
    q = q.eq("risk_level", filter.riskLevel);
  }

  const { data, error } = await q;
  if (error) throw new Error(`getRiskFlags: ${error.message}`);
  return (data ?? []) as RiskRow[];
}

/**
 * Open action items only (CRITICAL + WARNING with a recommended_action).
 * Sorted by urgency (CRITICAL first, then by deadline).
 * Comes from v_compliance_actions view (migration 072).
 */
export async function getOpenActions(limit = 50): Promise<RiskRow[]> {
  const { data, error } = await serviceDb()
    .from("v_compliance_actions")
    .select("tenant_id, tenant, precinct, certificate_type, certificate_id, status, expiry_date, risk_level, recommended_action, action_owner, action_deadline")
    .limit(limit);
  if (error) throw new Error(`getOpenActions: ${error.message}`);
  return (data ?? []) as RiskRow[];
}

// ── Expiring soon view ────────────────────────────────────────────────────────

export async function getExpiringSoon(
  window?: "30_DAYS" | "60_DAYS" | "90_DAYS",
): Promise<ExpiringRow[]> {
  let q = serviceDb()
    .from("v_compliance_expiring_soon")
    .select("*")
    .order("expiry_date");

  if (window) {
    // Return only certs in this window or worse
    const cutoffDays: Record<string, number> = {
      "30_DAYS": 30,
      "60_DAYS": 60,
      "90_DAYS": 90,
    };
    const days = cutoffDays[window];
    q = q.lte(
      "expiry_date",
      new Date(Date.now() + days * 86400 * 1000).toISOString().split("T")[0],
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(`getExpiringSoon: ${error.message}`);
  return (data ?? []) as ExpiringRow[];
}

// ── Tenant summary view ───────────────────────────────────────────────────────

export async function getTenantSummaries(): Promise<TenantSummary[]> {
  const { data, error } = await serviceDb()
    .from("v_compliance_summary_by_tenant")
    .select("*")
    .order("compliance_pct", { ascending: true }); // worst first
  if (error) throw new Error(`getTenantSummaries: ${error.message}`);
  return (data ?? []) as TenantSummary[];
}

export async function getTenantSummary(tenantId: string): Promise<TenantSummary | null> {
  const { data, error } = await serviceDb()
    .from("v_compliance_summary_by_tenant")
    .select("*")
    .eq("tenant_id", tenantId)
    .single();
  if (error) return null;
  return data as TenantSummary;
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export async function writeComplianceAuditLog(input: {
  action:    string;
  userId?:   string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await serviceDb()
    .from("compliance_audit_log")
    .insert({
      action:    input.action,
      user_id:   input.userId   ?? null,
      tenant_id: input.tenantId ?? null,
      metadata:  input.metadata ?? null,
    });
  if (error) throw new Error(`writeComplianceAuditLog: ${error.message}`);
}

// ── Certificate types ─────────────────────────────────────────────────────────

export async function getCertificateTypes(): Promise<CertificateType[]> {
  const { data, error } = await serviceDb()
    .from("certificate_types")
    .select("id, name, required")
    .order("name");
  if (error) throw new Error(`getCertificateTypes: ${error.message}`);
  return (data ?? []) as CertificateType[];
}

// ── Signed upload URL (for file upload without exposing storage path) ─────────

export async function createSignedUploadUrl(
  tenantId:      string,
  certificateId: string,
  filename:      string,
): Promise<{ signedUrl: string; path: string }> {
  const path = `${tenantId}/${certificateId}/${filename}`;
  const { data, error } = await serviceDb()
    .storage
    .from("compliance-certificates")
    .createSignedUploadUrl(path);
  if (error || !data) throw new Error(`createSignedUploadUrl: ${error?.message}`);
  return { signedUrl: data.signedUrl, path };
}

// ── Signed read URL (for officers/execs viewing a cert file) ─────────────────

export async function createSignedReadUrl(
  storagePath: string,
  expiresIn = 300, // 5 minutes
): Promise<string> {
  const { data, error } = await serviceDb()
    .storage
    .from("compliance-certificates")
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) throw new Error(`createSignedReadUrl: ${error?.message}`);
  return data.signedUrl;
}
