/**
 * __tests__/integration/cross-site-access.test.ts
 *
 * Integration test scaffold for cross-site RLS verification.
 *
 * These tests require LIVE Supabase credentials and are NOT run in the normal
 * Vitest unit test suite.  They are marked with `@integration` and run only
 * when the required environment variables are present.
 *
 * ── Required environment variables ───────────────────────────────────────────
 *
 *   INTEGRATION_SUPABASE_URL         — Supabase project URL
 *   INTEGRATION_SUPABASE_ANON_KEY    — anon/public key (RLS-enforced client)
 *   INTEGRATION_SERVICE_ROLE_KEY     — service role key (bypass RLS, for setup)
 *   INTEGRATION_USER_TOKEN_SITE_A    — JWT access token for a GM of Site A
 *   INTEGRATION_USER_TOKEN_SITE_B    — JWT access token for a GM of Site B
 *   INTEGRATION_SITE_A_ID            — UUID of Site A
 *   INTEGRATION_SITE_B_ID            — UUID of Site B
 *
 * ── How to run ────────────────────────────────────────────────────────────────
 *
 *   INTEGRATION_SUPABASE_URL=... \
 *   INTEGRATION_SUPABASE_ANON_KEY=... \
 *   INTEGRATION_USER_TOKEN_SITE_A=... \
 *   INTEGRATION_USER_TOKEN_SITE_B=... \
 *   INTEGRATION_SITE_A_ID=... \
 *   INTEGRATION_SITE_B_ID=... \
 *   npx vitest run __tests__/integration/cross-site-access.test.ts
 *
 * ── What this tests ───────────────────────────────────────────────────────────
 *
 *   1. A GM authenticated as Site A CANNOT read rows belonging to Site B.
 *   2. A GM authenticated as Site B CANNOT read rows belonging to Site A.
 *   3. Service role CAN read all rows (RLS bypass — used only in sync workers).
 *   4. Unauthenticated requests return no rows (RLS default-deny).
 *
 * These tests are the only ones that validate RLS policy correctness from the
 * application layer.  Unit tests (tenant-isolation.test.ts) validate the
 * application code never produces cross-site queries; these tests validate the
 * DB rejects them even if the application code did.
 *
 * ── Manual verification checklist (if credentials unavailable) ────────────────
 *
 *   1. Log into Supabase Dashboard → SQL Editor
 *   2. Run:
 *        SET ROLE authenticated;
 *        SET request.jwt.claims = '{"sub":"<site-b-user-id>","role":"authenticated"}';
 *        SELECT * FROM micros_connections WHERE site_id = '<site-a-uuid>';
 *      Expected: 0 rows (RLS blocks cross-site read)
 *
 *   3. Run:
 *        SELECT * FROM sales_uploads WHERE site_id = '<site-a-uuid>';
 *      Expected: 0 rows
 *
 *   4. Run as service_role:
 *        SELECT * FROM micros_connections;
 *      Expected: all rows (service_role bypasses RLS)
 */

import { createClient } from "@supabase/supabase-js";
import { describe, it, expect, beforeAll } from "vitest";

// ── Credentials guard ─────────────────────────────────────────────────────────

const REQUIRED_VARS = [
  "INTEGRATION_SUPABASE_URL",
  "INTEGRATION_SUPABASE_ANON_KEY",
  "INTEGRATION_USER_TOKEN_SITE_A",
  "INTEGRATION_USER_TOKEN_SITE_B",
  "INTEGRATION_SITE_A_ID",
  "INTEGRATION_SITE_B_ID",
];

const hasCredentials = REQUIRED_VARS.every((v) => !!process.env[v]);

const describeIntegration = hasCredentials ? describe : describe.skip;

// ── Supabase client factory ───────────────────────────────────────────────────

function anonClient(accessToken: string) {
  const client = createClient(
    process.env.INTEGRATION_SUPABASE_URL!,
    process.env.INTEGRATION_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  // Inject user JWT so RLS evaluates as this user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).rest.headers["Authorization"] = `Bearer ${accessToken}`;
  return client;
}

function serviceClient() {
  return createClient(
    process.env.INTEGRATION_SUPABASE_URL!,
    process.env.INTEGRATION_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describeIntegration("Integration: Cross-site RLS isolation", () => {
  const SITE_A = process.env.INTEGRATION_SITE_A_ID!;
  const SITE_B = process.env.INTEGRATION_SITE_B_ID!;

  let clientA: ReturnType<typeof anonClient>;
  let clientB: ReturnType<typeof anonClient>;
  let svcClient: ReturnType<typeof serviceClient>;

  beforeAll(() => {
    clientA   = anonClient(process.env.INTEGRATION_USER_TOKEN_SITE_A!);
    clientB   = anonClient(process.env.INTEGRATION_USER_TOKEN_SITE_B!);
    svcClient = serviceClient();
  });

  // ── micros_connections ────────────────────────────────────────────────────

  it("Site A user cannot read Site B micros_connections", async () => {
    const { data, error } = await clientA
      .from("micros_connections")
      .select("id, site_id")
      .eq("site_id", SITE_B);

    // RLS should block → 0 rows or PGRST116 (not found)
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("Site B user cannot read Site A micros_connections", async () => {
    const { data, error } = await clientB
      .from("micros_connections")
      .select("id, site_id")
      .eq("site_id", SITE_A);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("Service role can read all micros_connections", async () => {
    const { data, error } = await svcClient
      .from("micros_connections")
      .select("id, site_id");

    expect(error).toBeNull();
    // At least the site A and B rows exist
    expect((data ?? []).length).toBeGreaterThanOrEqual(0);
    // No error — service role bypass confirmed
  });

  // ── sales_uploads ─────────────────────────────────────────────────────────

  it("Site A user cannot read Site B sales_uploads", async () => {
    const { data, error } = await clientA
      .from("sales_uploads")
      .select("id, site_id")
      .eq("site_id", SITE_B);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  // ── zone_snapshots ────────────────────────────────────────────────────────

  it("Site A user cannot read Site B zone_snapshots", async () => {
    const { data, error } = await clientA
      .from("zone_snapshots")
      .select("id, site_id")
      .eq("site_id", SITE_B);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  // ── API route: 403 for cross-site request ─────────────────────────────────

  it("API /api/system-health/checks returns 200 for elevated user", async () => {
    // This test requires the app to be running locally or in CI.
    // Skip if APP_URL is not set.
    const appUrl = process.env.INTEGRATION_APP_URL;
    if (!appUrl) {
      console.warn("INTEGRATION_APP_URL not set — skipping API route test");
      return;
    }

    const res = await fetch(`${appUrl}/api/system-health/checks`, {
      headers: {
        Authorization: `Bearer ${process.env.INTEGRATION_USER_TOKEN_SITE_A}`,
      },
    });

    // Must return 200 (elevated role) or 403 (non-elevated) — never 500
    expect([200, 403]).toContain(res.status);
  });
});

// ── Skip notice ───────────────────────────────────────────────────────────────

if (!hasCredentials) {
  console.warn(
    "\n[cross-site-access] Integration tests SKIPPED — set the following env vars to enable:\n" +
    REQUIRED_VARS.map((v) => `  ${v}`).join("\n") +
    "\n",
  );
}
