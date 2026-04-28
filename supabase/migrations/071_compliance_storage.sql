-- ============================================================
-- Migration 071: Compliance Certificate Storage
--
-- Creates the `compliance-certificates` storage bucket and
-- attaches RLS policies so:
--   - TENANT can upload/read only within their tenant_id folder
--   - OFFICER / SUPER_ADMIN can read any file (for review)
--   - Signed URLs are generated app-side; raw paths never exposed
--
-- File path convention:
--   {tenant_id}/{certificate_id}/{filename}
-- ============================================================

-- ── Bucket ────────────────────────────────────────────────────────────────────
--
-- `public = false` — no anonymous access.
-- File size limit: 10 MB per upload.
-- Allowed MIME types: PDF, JPEG, PNG, WEBP (common cert formats).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'compliance-certificates',
  'compliance-certificates',
  false,
  10485760,   -- 10 MB
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public            = false,
  file_size_limit   = 10485760,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp'
  ];

-- ── Storage RLS policies ──────────────────────────────────────────────────────
--
-- storage.foldername(name)[1] extracts the first path segment,
-- which is the tenant_id per our convention.

-- service_role: unrestricted
CREATE POLICY "srole_cert_storage_all"
  ON storage.objects FOR ALL TO service_role
  USING  (bucket_id = 'compliance-certificates')
  WITH CHECK (bucket_id = 'compliance-certificates');

-- TENANT: upload to own folder only
CREATE POLICY "tenant_cert_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'compliance-certificates'
    AND compliance_current_tenant_id()::text = (storage.foldername(name))[1]
  );

-- TENANT: read own folder only
CREATE POLICY "tenant_cert_storage_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'compliance-certificates'
    AND (
      -- Tenant sees own folder
      (
        compliance_current_role() = 'TENANT'
        AND compliance_current_tenant_id()::text = (storage.foldername(name))[1]
      )
      OR
      -- OFFICER / SUPER_ADMIN / EXECUTIVE see everything
      compliance_current_role() IN ('SUPER_ADMIN', 'EXECUTIVE', 'OFFICER')
    )
  );

-- TENANT: update own uploads (re-upload)
CREATE POLICY "tenant_cert_storage_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'compliance-certificates'
    AND compliance_current_role() = 'TENANT'
    AND compliance_current_tenant_id()::text = (storage.foldername(name))[1]
  );

-- OFFICER / SUPER_ADMIN: delete (e.g. rejected file cleanup)
CREATE POLICY "officer_cert_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'compliance-certificates'
    AND compliance_current_role() IN ('SUPER_ADMIN', 'OFFICER')
  );
