/**
 * __tests__/auth/cron-guard.test.ts
 *
 * Unit tests for lib/auth/cron-guard.ts
 *
 * cronGuard is a pure synchronous function with no DB or cookie access,
 * making it straightforward to test in isolation. All test cases:
 *   - Missing CRON_SECRET env var          → HTTP 500
 *   - Authorization header absent          → HTTP 401
 *   - Authorization header wrong token     → HTTP 401
 *   - Authorization header wrong scheme    → HTTP 401
 *   - Authorization header correct         → null (caller continues)
 *
 * next/server is mocked because NextRequest / NextResponse require a full
 * Next.js runtime context. The stubs replicate the exact surface that
 * cronGuard uses: req.headers.get() and NextResponse.json().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock next/server ──────────────────────────────────────────────────────────
// Must be declared before any import that transitively loads next/server.
// Provides minimal NextRequest + NextResponse stubs sufficient for cronGuard.

vi.mock("next/server", () => {
  class FakeNextRequest {
    headers: Headers;
    constructor(_url: string, init?: { headers?: Headers }) {
      this.headers = init?.headers ?? new Headers();
    }
  }

  const FakeNextResponse = {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...((init?.headers as Record<string, string>) ?? {}),
        },
      }),
  };

  return {
    NextRequest: FakeNextRequest,
    NextResponse: FakeNextResponse,
  };
});

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { cronGuard } from "@/lib/auth/cron-guard";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROUTE = "GET /api/cron/test";
const TEST_SECRET = "cron-test-secret-abc123";

/**
 * Build a minimal NextRequest with an optional Authorization header.
 */
function makeRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set("authorization", authHeader);
  }
  return new NextRequest("https://example.com/api/cron/test", { headers });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("cronGuard", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    // Restore env — CRON_SECRET mutations must not leak between tests
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  // ── 500: Missing CRON_SECRET ─────────────────────────────────────────────

  it("returns HTTP 500 when CRON_SECRET is not configured", async () => {
    const req = makeRequest(`Bearer ${TEST_SECRET}`);
    const result = cronGuard(req, ROUTE);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);

    const body = await result!.json();
    expect(body.error).toMatch(/CRON_SECRET/);
  });

  // ── 401: Bad Authorization header ────────────────────────────────────────

  it("returns HTTP 401 when Authorization header is absent", async () => {
    process.env.CRON_SECRET = TEST_SECRET;
    const req = makeRequest(); // no header at all
    const result = cronGuard(req, ROUTE);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);

    const body = await result!.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it("returns HTTP 401 when Authorization header has the wrong token", () => {
    process.env.CRON_SECRET = TEST_SECRET;
    const req = makeRequest("Bearer wrong-token");
    const result = cronGuard(req, ROUTE);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns HTTP 401 when Authorization uses wrong scheme (Basic instead of Bearer)", () => {
    process.env.CRON_SECRET = TEST_SECRET;
    const req = makeRequest(`Basic ${TEST_SECRET}`);
    const result = cronGuard(req, ROUTE);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns HTTP 401 when Authorization header is the raw secret without Bearer prefix", () => {
    process.env.CRON_SECRET = TEST_SECRET;
    const req = makeRequest(TEST_SECRET); // missing "Bearer " prefix
    const result = cronGuard(req, ROUTE);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  // ── null: Authorised ─────────────────────────────────────────────────────

  it("returns null (caller continues) when Authorization matches CRON_SECRET", () => {
    process.env.CRON_SECRET = TEST_SECRET;
    const req = makeRequest(`Bearer ${TEST_SECRET}`);
    const result = cronGuard(req, ROUTE);

    expect(result).toBeNull();
  });

  it("is case-sensitive: 'bearer' (lowercase) is rejected because Next.js header normalisation does not apply here", () => {
    // cronGuard does an exact string equality check against `Bearer ${secret}`.
    // Document this behaviour explicitly so regressions are caught.
    process.env.CRON_SECRET = TEST_SECRET;
    const req = makeRequest(`bearer ${TEST_SECRET}`);
    const result = cronGuard(req, ROUTE);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });
});
