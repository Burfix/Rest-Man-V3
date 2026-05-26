/**
 * __tests__/auth/api-guard.test.ts
 *
 * Unit tests for lib/auth/api-guard.ts
 *
 * apiGuard combines authentication, RBAC permission checking, and site-level
 * tenant isolation into a single guard function. All test cases:
 *
 *   Unauthenticated user (AuthError 401)         → GuardFail { status: 401 }
 *   No role assigned (AuthError 403)             → GuardFail { status: 403 }
 *   Role lacks required permission               → GuardFail { status: 403 }
 *   User tries to access a site outside siteIds  → GuardFail { status: 403 }
 *   Correct auth + permission + site             → GuardSuccess { ctx, supabase }
 *   No permission required (null)                → GuardSuccess for any authenticated user
 *
 * Mocking strategy:
 *   - getUserContext: mocked — avoids cookies() / Supabase calls
 *   - get-user-context module: fully self-contained factory (NO importOriginal)
 *     because the real get-user-context.ts imports next/headers which is not
 *     available in the Vitest Node environment
 *   - createServerClient: stub (fire-and-forget last_seen_at)
 *   - logger: silenced
 *   - @/lib/modules: mocked to avoid DB calls in module-gate path
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock heavy infrastructure ─────────────────────────────────────────────────
// All vi.mock() calls are hoisted before imports by Vitest.

// AuthError is defined inline so this factory never calls importOriginal —
// which would load the real get-user-context.ts and trigger next/headers.
vi.mock("@/lib/auth/get-user-context", () => {
  class AuthError extends Error {
    readonly statusCode: 401 | 403;
    constructor(message: string, statusCode: 401 | 403 = 403) {
      super(message);
      this.name = "AuthError";
      this.statusCode = statusCode;
    }
  }

  function authErrorResponse(err: unknown): Response {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: (err as AuthError).statusCode,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return {
    getUserContext: vi.fn(),
    AuthError,
    authErrorResponse,
  };
});

// createServerClient — avoids Next.js cookie store at import time
vi.mock("@/lib/supabase/server", () => {
  const stubChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    then: vi.fn(),
  };
  return {
    createServerClient: vi.fn(() => ({
      from: vi.fn(() => stubChain),
    })),
  };
});

// Silence all logger output
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Module gate — default: pass through. Override per-test when needed.
vi.mock("@/lib/modules", () => ({
  requireModule: vi.fn().mockResolvedValue(undefined),
  moduleErrorResponse: vi.fn().mockReturnValue(null),
}));

// ── Imports (after mocks are declared) ───────────────────────────────────────

import { apiGuard } from "@/lib/auth/api-guard";
import { getUserContext, AuthError } from "@/lib/auth/get-user-context";
import { PERMISSIONS } from "@/lib/rbac/roles";
import type { UserContext } from "@/lib/auth/get-user-context";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockGetUserContext = vi.mocked(getUserContext);

/**
 * Build a realistic UserContext for a given role and site configuration.
 */
function buildCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: "user-abc123",
    email: "thami@forgestack.io",
    role: "gm",
    siteId: "site-si-cantina",
    siteIds: ["site-si-cantina"],
    orgId: "org-forgestack",
    hasSelectedSite: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("apiGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Authentication failures ─────────────────────────────────────────────

  it("returns HTTP 401 when the user is not authenticated", async () => {
    mockGetUserContext.mockRejectedValueOnce(
      new AuthError("Not authenticated", 401),
    );

    const result = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/ops");

    expect(result.ctx).toBeNull();
    expect(result.supabase).toBeNull();
    expect(result.error).toBeInstanceOf(Response);
    expect((result.error as Response).status).toBe(401);
  });

  it("returns HTTP 403 when the user has no role assigned", async () => {
    mockGetUserContext.mockRejectedValueOnce(
      new AuthError("No role assigned — contact your administrator", 403),
    );

    const result = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/ops");

    expect(result.ctx).toBeNull();
    expect((result.error as Response).status).toBe(403);
  });

  // ── RBAC permission failures ────────────────────────────────────────────

  it("returns HTTP 403 when gm tries to access MANAGE_INTEGRATIONS (not in their permission set)", async () => {
    // GM role does not include MANAGE_INTEGRATIONS — see lib/rbac/roles.ts
    mockGetUserContext.mockResolvedValueOnce(buildCtx({ role: "gm" }));

    const result = await apiGuard(
      PERMISSIONS.MANAGE_INTEGRATIONS,
      "POST /api/integrations",
    );

    expect(result.error).toBeInstanceOf(Response);
    expect((result.error as Response).status).toBe(403);

    const body = await (result.error as Response).json();
    expect(body.error).toMatch(/gm.*manage_integrations/i);
  });

  it("returns HTTP 403 when supervisor tries to access MANAGE_USERS", async () => {
    mockGetUserContext.mockResolvedValueOnce(buildCtx({ role: "supervisor" }));

    const result = await apiGuard(PERMISSIONS.MANAGE_USERS, "POST /api/users");

    expect((result.error as Response).status).toBe(403);
    expect(result.ctx).toBeNull();
  });

  it("returns HTTP 403 when viewer tries to access CREATE_ACTION", async () => {
    mockGetUserContext.mockResolvedValueOnce(buildCtx({ role: "viewer" }));

    const result = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/actions");

    expect((result.error as Response).status).toBe(403);
  });

  // ── Site tenant isolation ───────────────────────────────────────────────

  it("returns HTTP 403 when user tries to access a site outside their siteIds", async () => {
    mockGetUserContext.mockResolvedValueOnce(
      buildCtx({
        role: "gm",
        siteId: "site-si-cantina",
        siteIds: ["site-si-cantina"],
      }),
    );

    const result = await apiGuard(
      PERMISSIONS.VIEW_OWN_STORE,
      "GET /api/ops",
      { siteId: "site-primi-camps-bay" }, // not in user's siteIds
    );

    expect(result.error).toBeInstanceOf(Response);
    expect((result.error as Response).status).toBe(403);

    const body = await (result.error as Response).json();
    expect(body.error).toMatch(/do not have access to this site/i);
  });

  it("returns HTTP 403 when area_manager requests a site not in their multi-site list", async () => {
    mockGetUserContext.mockResolvedValueOnce(
      buildCtx({
        role: "area_manager",
        siteIds: ["site-si-cantina", "site-sea-castle"],
      }),
    );

    const result = await apiGuard(
      PERMISSIONS.VIEW_REGION_STORES,
      "GET /api/area",
      { siteId: "site-unknown-location" },
    );

    expect((result.error as Response).status).toBe(403);
  });

  // ── Success cases ───────────────────────────────────────────────────────

  it("returns GuardSuccess when gm has required permission and no siteId filter", async () => {
    const ctx = buildCtx({ role: "gm" });
    mockGetUserContext.mockResolvedValueOnce(ctx);

    const result = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/ops");

    expect(result.error).toBeNull();
    expect(result.ctx).not.toBeNull();
    expect(result.ctx!.role).toBe("gm");
    expect(result.ctx!.userId).toBe("user-abc123");
    expect(result.supabase).not.toBeNull();
  });

  it("returns GuardSuccess when no permission is required (read-only route)", async () => {
    mockGetUserContext.mockResolvedValueOnce(buildCtx({ role: "viewer" }));

    const result = await apiGuard(null, "GET /api/public");

    expect(result.error).toBeNull();
    expect(result.ctx!.role).toBe("viewer");
  });

  it("returns GuardSuccess when head_office has MANAGE_INTEGRATIONS and correct site access", async () => {
    // head_office DOES have MANAGE_INTEGRATIONS — see lib/rbac/roles.ts
    mockGetUserContext.mockResolvedValueOnce(
      buildCtx({
        role: "head_office",
        siteId: "site-si-cantina",
        siteIds: ["site-si-cantina", "site-primi-camps-bay"],
      }),
    );

    const result = await apiGuard(
      PERMISSIONS.MANAGE_INTEGRATIONS,
      "POST /api/integrations",
      { siteId: "site-primi-camps-bay" }, // in their siteIds list
    );

    expect(result.error).toBeNull();
    expect(result.ctx!.role).toBe("head_office");
  });

  it("returns GuardSuccess when super_admin calls any permission", async () => {
    mockGetUserContext.mockResolvedValueOnce(
      buildCtx({
        role: "super_admin",
        siteIds: ["site-si-cantina", "site-primi-camps-bay", "site-sea-castle"],
      }),
    );

    const result = await apiGuard(PERMISSIONS.MANAGE_ROLES, "POST /api/admin/roles");

    expect(result.error).toBeNull();
    expect(result.ctx!.role).toBe("super_admin");
  });

  // ── Regression: site isolation applies even when permission is null ──────

  it("returns GuardSuccess when permission is null and siteId option matches user siteIds", async () => {
    mockGetUserContext.mockResolvedValueOnce(
      buildCtx({
        role: "gm",
        siteId: "site-si-cantina",
        siteIds: ["site-si-cantina"],
      }),
    );

    const result = await apiGuard(null, "GET /api/ops", {
      siteId: "site-si-cantina",
    });

    expect(result.error).toBeNull();
    expect(result.ctx!.siteId).toBe("site-si-cantina");
  });

  it("returns HTTP 403 when permission is null but siteId option does NOT match", async () => {
    mockGetUserContext.mockResolvedValueOnce(
      buildCtx({
        role: "gm",
        siteId: "site-si-cantina",
        siteIds: ["site-si-cantina"],
      }),
    );

    // No permission required but site isolation still enforced
    const result = await apiGuard(null, "GET /api/ops", {
      siteId: "site-foreign",
    });

    expect((result.error as Response).status).toBe(403);
  });
});
