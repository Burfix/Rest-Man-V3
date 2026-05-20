/**
 * __tests__/incidents/incident-workflow.test.ts
 *
 * Unit tests for the Tier-7 Incident Operations Workflow.
 *
 * Covers:
 *   - guardIncidentWrite: authentication, UUID validation, visibility, RBAC
 *   - POST /api/incidents/[id]/acknowledge
 *   - POST /api/incidents/[id]/assign
 *   - POST /api/incidents/[id]/resolve
 *   - PATCH /api/incidents/[id]/notes
 *
 * All Supabase calls and auth are mocked — no network requests or credentials.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse }             from "next/server";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

vi.mock("@/lib/auth/get-user-context", () => ({
  getUserContext:    vi.fn(),
  authErrorResponse: vi.fn((_err: unknown) =>
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  ),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ── Deferred imports (after mocks) ────────────────────────────────────────────

import { getUserContext }                         from "@/lib/auth/get-user-context";
import { createClient }                          from "@supabase/supabase-js";
import { POST as acknowledge }                   from "@/app/api/incidents/[id]/acknowledge/route";
import { POST as assign }                        from "@/app/api/incidents/[id]/assign/route";
import { POST as resolve }                       from "@/app/api/incidents/[id]/resolve/route";
import { PATCH as notes }                        from "@/app/api/incidents/[id]/notes/route";
import { POST as escalate }                      from "@/app/api/incidents/[id]/escalate/route";
import type { UserContext }                      from "@/lib/auth/get-user-context";

const mockGetUserContext = getUserContext as ReturnType<typeof vi.fn>;
const mockCreateClient   = createClient as ReturnType<typeof vi.fn>;

// ── Test fixtures ─────────────────────────────────────────────────────────────

const INCIDENT_ID = "11111111-1111-1111-1111-111111111111";
const SITE_A      = "22222222-2222-2222-2222-222222222222";
const SITE_B      = "33333333-3333-3333-3333-333333333333";
const USER_ID     = "44444444-4444-4444-4444-444444444444";
const TARGET_USER = "55555555-5555-5555-5555-555555555555";

function makeCtx(role: string, siteIds: string[] = [SITE_A]): UserContext {
  return {
    userId: USER_ID,
    email:  "ops@example.com",
    role:   role as UserContext["role"],
    siteId: siteIds[0] ?? "",
    siteIds,
    orgId:  "org-001",
  };
}

function makeIncident(
  siteId: string | null = SITE_A,
  status = "open",
): Record<string, unknown> {
  return { id: INCIDENT_ID, site_id: siteId, status };
}

/**
 * Build a mock Supabase client that correctly handles:
 *  - db.from().select().eq().maybeSingle()  → read (guard lookup)
 *  - db.from().update().eq()                → write (route mutation), awaitable
 */
function buildMockDb(
  incidentRow: Record<string, unknown> | null,
  updateError: unknown = null,
) {
  let isUpdate = false;

  const chain: Record<string, unknown> = {
    select:      vi.fn().mockImplementation(() => { isUpdate = false; return chain; }),
    update:      vi.fn().mockImplementation(() => { isUpdate = true;  return chain; }),
    eq:          vi.fn().mockImplementation(() => {
      if (isUpdate) return Promise.resolve({ error: updateError });
      return chain;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: incidentRow, error: null }),
  };

  return { from: vi.fn().mockReturnValue(chain) };
}

// ── Request factory ───────────────────────────────────────────────────────────

function makeReq(
  path: string,
  method = "POST",
  body?: Record<string, unknown>,
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
      : {}),
  });
}

function routeParams(id = INCIDENT_ID) {
  return { params: { id } };
}

// ── Shared setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL  = "http://supabase.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

// ── Guard: authentication ──────────────────────────────────────────────────────

describe("guardIncidentWrite — authentication", () => {
  it("returns 401 when getUserContext throws (unauthenticated)", async () => {
    mockGetUserContext.mockRejectedValue(new Error("Not authenticated"));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident()));

    const res = await acknowledge(
      makeReq(`/api/incidents/${INCIDENT_ID}/acknowledge`),
      routeParams(),
    );
    expect(res.status).toBe(401);
  });
});

// ── Guard: UUID validation ─────────────────────────────────────────────────────

describe("guardIncidentWrite — UUID validation", () => {
  it("returns 400 for a non-UUID incident id", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm"));
    mockCreateClient.mockReturnValue(buildMockDb(null));

    const res = await acknowledge(
      makeReq("/api/incidents/not-a-uuid/acknowledge"),
      routeParams("not-a-uuid"),
    );
    expect(res.status).toBe(400);
  });
});

// ── Guard: incident visibility ─────────────────────────────────────────────────

describe("guardIncidentWrite — visibility", () => {
  it("returns 404 when incident does not exist in DB", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(null)); // DB returns null

    const res = await acknowledge(
      makeReq(`/api/incidents/${INCIDENT_ID}/acknowledge`),
      routeParams(),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when site-user requests incident at a different site", async () => {
    // GM of SITE_A requests an incident belonging to SITE_B
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_B)));

    const res = await acknowledge(
      makeReq(`/api/incidents/${INCIDENT_ID}/acknowledge`),
      routeParams(),
    );
    // Must be 404, not 403 — do not confirm the incident exists
    expect(res.status).toBe(404);
  });

  it("allows platform-level incident (null site_id) for any authenticated write role", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(null))); // no site_id

    const res = await acknowledge(
      makeReq(`/api/incidents/${INCIDENT_ID}/acknowledge`),
      routeParams(),
    );
    expect(res.status).toBe(200);
  });
});

// ── Guard: RBAC ───────────────────────────────────────────────────────────────

describe("guardIncidentWrite — RBAC", () => {
  it("returns 403 for auditor (read-only role)", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("auditor", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident()));

    const res = await acknowledge(
      makeReq(`/api/incidents/${INCIDENT_ID}/acknowledge`),
      routeParams(),
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for viewer", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("viewer", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident()));

    const res = await resolve(
      makeReq(`/api/incidents/${INCIDENT_ID}/resolve`),
      routeParams(),
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for contractor", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("contractor", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident()));

    const res = await notes(
      makeReq(`/api/incidents/${INCIDENT_ID}/notes`, "PATCH", { notes: "test" }),
      routeParams(),
    );
    expect(res.status).toBe(403);
  });

  it("allows site GM to mutate own-site incident", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await acknowledge(
      makeReq(`/api/incidents/${INCIDENT_ID}/acknowledge`),
      routeParams(),
    );
    expect(res.status).toBe(200);
  });

  it("allows head_office to mutate any visible incident", async () => {
    // head_office can see SITE_B via their siteIds
    mockGetUserContext.mockResolvedValue(makeCtx("head_office", [SITE_A, SITE_B]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_B)));

    const res = await acknowledge(
      makeReq(`/api/incidents/${INCIDENT_ID}/acknowledge`),
      routeParams(),
    );
    expect(res.status).toBe(200);
  });

  it("allows executive to mutate any visible incident", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("executive", [SITE_A, SITE_B]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_B)));

    const res = await resolve(
      makeReq(`/api/incidents/${INCIDENT_ID}/resolve`),
      routeParams(),
    );
    expect(res.status).toBe(200);
  });
});

// ── POST /acknowledge ─────────────────────────────────────────────────────────

describe("POST /api/incidents/[id]/acknowledge", () => {
  it("returns 200 and sets status=acknowledged for an open incident", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    const mockDb = buildMockDb(makeIncident(SITE_A, "open"));
    mockCreateClient.mockReturnValue(mockDb);

    const res = await acknowledge(
      makeReq(`/api/incidents/${INCIDENT_ID}/acknowledge`),
      routeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Update should include status change
    const chain = mockDb.from.mock.results[1]?.value as Record<string, ReturnType<typeof vi.fn>>;
    const updateCall = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(updateCall).toMatchObject({
      acknowledged_by: USER_ID,
      status:          "acknowledged",
    });
  });

  it("does NOT downgrade status when incident is already investigating", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("supervisor", [SITE_A]));
    const mockDb = buildMockDb(makeIncident(SITE_A, "investigating"));
    mockCreateClient.mockReturnValue(mockDb);

    const res = await acknowledge(
      makeReq(`/api/incidents/${INCIDENT_ID}/acknowledge`),
      routeParams(),
    );
    expect(res.status).toBe(200);

    const chain = mockDb.from.mock.results[1]?.value as Record<string, ReturnType<typeof vi.fn>>;
    const updateCall = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // Should NOT include status in update payload
    expect(updateCall).not.toHaveProperty("status");
    expect(updateCall).toHaveProperty("acknowledged_by", USER_ID);
  });
});

// ── POST /assign ──────────────────────────────────────────────────────────────

describe("POST /api/incidents/[id]/assign", () => {
  it("returns 200 and sets assigned_to", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("area_manager", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await assign(
      makeReq(`/api/incidents/${INCIDENT_ID}/assign`, "POST", { userId: TARGET_USER }),
      routeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 400 for non-UUID userId", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await assign(
      makeReq(`/api/incidents/${INCIDENT_ID}/assign`, "POST", { userId: "not-a-uuid" }),
      routeParams(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing userId", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await assign(
      makeReq(`/api/incidents/${INCIDENT_ID}/assign`, "POST", {}),
      routeParams(),
    );
    expect(res.status).toBe(400);
  });
});

// ── POST /resolve ─────────────────────────────────────────────────────────────

describe("POST /api/incidents/[id]/resolve", () => {
  it("returns 200 and resolves the incident", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    const mockDb = buildMockDb(makeIncident(SITE_A, "acknowledged"));
    mockCreateClient.mockReturnValue(mockDb);

    const res = await resolve(
      makeReq(`/api/incidents/${INCIDENT_ID}/resolve`),
      routeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const chain = mockDb.from.mock.results[1]?.value as Record<string, ReturnType<typeof vi.fn>>;
    const updateCall = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(updateCall).toMatchObject({
      status:      "resolved",
      resolved_by: USER_ID,
    });
    expect(updateCall.resolved_at).toBeDefined();
  });

  it("is idempotent — returns 200 immediately for already-resolved incident", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    const mockDb = buildMockDb(makeIncident(SITE_A, "resolved"));
    mockCreateClient.mockReturnValue(mockDb);

    const res = await resolve(
      makeReq(`/api/incidents/${INCIDENT_ID}/resolve`),
      routeParams(),
    );
    expect(res.status).toBe(200);

    // update() should NOT have been called — idempotent short-circuit
    const chain = mockDb.from.mock.results[1]?.value as Record<string, ReturnType<typeof vi.fn>>;
    const updateMock = chain?.update as ReturnType<typeof vi.fn> | undefined;
    expect(updateMock?.mock.calls.length ?? 0).toBe(0);
  });

  it("includes optional notes when provided", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("supervisor", [SITE_A]));
    const mockDb = buildMockDb(makeIncident(SITE_A, "open"));
    mockCreateClient.mockReturnValue(mockDb);

    const res = await resolve(
      makeReq(`/api/incidents/${INCIDENT_ID}/resolve`, "POST", {
        notes: "Checked the fryer — thermostat replaced.",
      }),
      routeParams(),
    );
    expect(res.status).toBe(200);

    const chain = mockDb.from.mock.results[1]?.value as Record<string, ReturnType<typeof vi.fn>>;
    const updateCall = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(updateCall).toHaveProperty("operator_notes", "Checked the fryer — thermostat replaced.");
  });
});

// ── PATCH /notes ──────────────────────────────────────────────────────────────

describe("PATCH /api/incidents/[id]/notes", () => {
  it("returns 200 and saves operator notes", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    const mockDb = buildMockDb(makeIncident(SITE_A));
    mockCreateClient.mockReturnValue(mockDb);

    const res = await notes(
      makeReq(`/api/incidents/${INCIDENT_ID}/notes`, "PATCH", {
        notes: "Escalated to maintenance team.",
      }),
      routeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 400 for empty notes string", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await notes(
      makeReq(`/api/incidents/${INCIDENT_ID}/notes`, "PATCH", { notes: "" }),
      routeParams(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for notes exceeding 2000 characters", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await notes(
      makeReq(`/api/incidents/${INCIDENT_ID}/notes`, "PATCH", {
        notes: "x".repeat(2001),
      }),
      routeParams(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing notes field", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await notes(
      makeReq(`/api/incidents/${INCIDENT_ID}/notes`, "PATCH", {}),
      routeParams(),
    );
    expect(res.status).toBe(400);
  });
});

// ── POST /escalate ─────────────────────────────────────────────────────────────

describe("POST /api/incidents/[id]/escalate", () => {
  it("returns 200 for a valid escalation level (elevated)", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await escalate(
      makeReq(`/api/incidents/${INCIDENT_ID}/escalate`, "POST", { escalationLevel: "elevated" }),
      routeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 200 for escalation level 'urgent'", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("supervisor", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await escalate(
      makeReq(`/api/incidents/${INCIDENT_ID}/escalate`, "POST", { escalationLevel: "urgent" }),
      routeParams(),
    );
    expect(res.status).toBe(200);
  });

  it("returns 200 for de-escalation to 'normal'", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await escalate(
      makeReq(`/api/incidents/${INCIDENT_ID}/escalate`, "POST", { escalationLevel: "normal" }),
      routeParams(),
    );
    expect(res.status).toBe(200);
  });

  it("returns 400 for an invalid escalation level string", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await escalate(
      makeReq(`/api/incidents/${INCIDENT_ID}/escalate`, "POST", { escalationLevel: "critical" }),
      routeParams(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when escalationLevel is missing from body", async () => {
    mockGetUserContext.mockResolvedValue(makeCtx("gm", [SITE_A]));
    mockCreateClient.mockReturnValue(buildMockDb(makeIncident(SITE_A)));

    const res = await escalate(
      makeReq(`/api/incidents/${INCIDENT_ID}/escalate`, "POST", {}),
      routeParams(),
    );
    expect(res.status).toBe(400);
  });
});
