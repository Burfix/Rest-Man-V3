/**
 * __tests__/lib/queries/compliance-scoping.test.ts
 *
 * Verifies that the optional tenantId scoping added in M1 actually applies
 * the correct `.eq("tenant_id", ...)` filter when tenantId is provided, and
 * makes NO filter call when tenantId is omitted (officer/executive view).
 *
 * We mock the Supabase service client so no network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase service client mock ──────────────────────────────────────────────

// We capture each call to `eq()` so we can assert on the chain
const eqMock    = vi.fn().mockReturnThis();
const lteMock   = vi.fn().mockReturnThis();
const inMock    = vi.fn().mockReturnThis();
const limitMock = vi.fn().mockReturnThis();
const orderMock = vi.fn().mockReturnThis();

function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.select  = vi.fn(() => chain);
  chain.order   = orderMock;
  chain.eq      = eqMock;
  chain.lte     = lteMock;
  chain.in      = inMock;
  chain.limit   = limitMock;
  // Awaitable — resolves with empty success
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

const fromMock = vi.fn(() => makeChain());

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: fromMock }),
}));

vi.mock("@/lib/supabase/service-role-client", () => ({
  getServiceRoleClient: () => ({ from: fromMock }),
}));

// ── Import under test (after mock is registered) ──────────────────────────────

import {
  getRiskFlags,
  getOpenActions,
  getExpiringSoon,
  getTenantSummaries,
} from "@/lib/compliance/queries";

// ── Helpers ────────────────────────────────────────────────────────────────────

function eqCallsFor(column: string): unknown[][] {
  return eqMock.mock.calls.filter(
    ([col]: [string]) => col === column,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getRiskFlags ──────────────────────────────────────────────────────────────

describe("getRiskFlags", () => {
  it("applies tenant_id eq filter when tenantId is provided", async () => {
    await getRiskFlags({ tenantId: "tenant-abc" });
    const calls = eqCallsFor("tenant_id");
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toBe("tenant-abc");
  });

  it("does NOT apply tenant_id filter when tenantId is omitted", async () => {
    await getRiskFlags();
    expect(eqCallsFor("tenant_id").length).toBe(0);
  });

  it("applies riskLevel filter independently of tenantId", async () => {
    await getRiskFlags({ riskLevel: "CRITICAL" });
    const riskCalls = eqCallsFor("risk_level");
    expect(riskCalls.length).toBe(1);
    expect(riskCalls[0][1]).toBe("CRITICAL");
    expect(eqCallsFor("tenant_id").length).toBe(0);
  });

  it("applies both tenantId and riskLevel when both are provided", async () => {
    await getRiskFlags({ tenantId: "t-1", riskLevel: "WARNING" });
    expect(eqCallsFor("tenant_id").length).toBe(1);
    expect(eqCallsFor("risk_level").length).toBe(1);
  });
});

// ── getOpenActions ────────────────────────────────────────────────────────────

describe("getOpenActions", () => {
  it("applies tenant_id eq filter when tenantId is provided", async () => {
    await getOpenActions(50, "tenant-xyz");
    expect(eqCallsFor("tenant_id").length).toBe(1);
    expect(eqCallsFor("tenant_id")[0][1]).toBe("tenant-xyz");
  });

  it("does NOT apply tenant_id filter when tenantId is omitted", async () => {
    await getOpenActions(50);
    expect(eqCallsFor("tenant_id").length).toBe(0);
  });
});

// ── getExpiringSoon ───────────────────────────────────────────────────────────

describe("getExpiringSoon", () => {
  it("applies tenant_id eq filter when tenantId is provided", async () => {
    await getExpiringSoon(undefined, "tenant-expiry");
    expect(eqCallsFor("tenant_id").length).toBe(1);
    expect(eqCallsFor("tenant_id")[0][1]).toBe("tenant-expiry");
  });

  it("does NOT apply tenant_id filter when tenantId is omitted", async () => {
    await getExpiringSoon("30_DAYS");
    expect(eqCallsFor("tenant_id").length).toBe(0);
  });
});

// ── getTenantSummaries ────────────────────────────────────────────────────────

describe("getTenantSummaries", () => {
  it("applies .in(tenant_id, [...]) when tenantIds array is provided", async () => {
    await getTenantSummaries(["t-1", "t-2"]);
    const inCalls = inMock.mock.calls.filter(([col]: [string]) => col === "tenant_id");
    expect(inCalls.length).toBe(1);
    expect(inCalls[0][1]).toEqual(["t-1", "t-2"]);
  });

  it("does NOT apply an in filter when tenantIds is omitted", async () => {
    await getTenantSummaries();
    const inCalls = inMock.mock.calls.filter(([col]: [string]) => col === "tenant_id");
    expect(inCalls.length).toBe(0);
  });

  it("does NOT apply an in filter when tenantIds is an empty array", async () => {
    await getTenantSummaries([]);
    const inCalls = inMock.mock.calls.filter(([col]: [string]) => col === "tenant_id");
    expect(inCalls.length).toBe(0);
  });
});
