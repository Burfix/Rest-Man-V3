/**
 * __tests__/auth/site-switching.test.ts
 *
 * Unit tests for resolvePageSite() — the pure logic layer that determines
 * which site a page should render for.
 *
 * These tests mock next/headers so the function can run in a Node context.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock next/headers ────────────────────────────────────────────────────────

const mockCookieStore = {
  get: vi.fn((_name: string) => undefined as { value: string } | undefined),
};

vi.mock("next/headers", () => ({
  cookies: () => mockCookieStore,
}));

// Import after mock
import { resolvePageSite } from "@/lib/auth/resolve-site";

// ── Test data ────────────────────────────────────────────────────────────────

const SI_CANTINA = "00000000-0000-0000-0000-000000000001";
const PRIMI      = "00000000-0000-0000-0000-000000000002";
const CAMPS_BAY  = "00000000-0000-0000-0000-000000000003";
const UNRELATED  = "99999999-0000-0000-0000-000000000000";

const multiCtx = {
  role:    "head_office",
  siteId:  SI_CANTINA,
  siteIds: [SI_CANTINA, PRIMI, CAMPS_BAY],
};

const singleCtx = {
  role:    "gm",
  siteId:  SI_CANTINA,
  siteIds: [SI_CANTINA],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function setCookie(value: string | undefined) {
  mockCookieStore.get.mockImplementation((name: string) =>
    name === "fs-site-id" && value !== undefined ? { value } : undefined,
  );
}

beforeEach(() => {
  mockCookieStore.get.mockReset();
  setCookie(undefined);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resolvePageSite — single-site role", () => {
  it("always returns own site, ignores cookie", () => {
    setCookie(PRIMI);
    const result = resolvePageSite(singleCtx);
    expect(result.siteId).toBe(SI_CANTINA);
    expect(result.isAll).toBe(false);
  });

  it("always returns own site, ignores URL param", () => {
    const result = resolvePageSite(singleCtx, PRIMI);
    expect(result.siteId).toBe(SI_CANTINA);
  });

  it("ignores 'all' URL param for single-site roles", () => {
    const result = resolvePageSite(singleCtx, "all");
    expect(result.siteId).toBe(SI_CANTINA);
    expect(result.isAll).toBe(false);
  });
});

describe("resolvePageSite — multi-site role, no cookie, no URL param", () => {
  it("falls back to primary site", () => {
    const result = resolvePageSite(multiCtx);
    expect(result.siteId).toBe(SI_CANTINA);
    expect(result.isAll).toBe(false);
  });
});

describe("resolvePageSite — multi-site role, cookie only", () => {
  it("multi-site user with Primi cookie returns Primi context", () => {
    setCookie(PRIMI);
    const result = resolvePageSite(multiCtx);
    expect(result.siteId).toBe(PRIMI);
    expect(result.isAll).toBe(false);
  });

  it("cookie 'all' sentinel returns primary siteId with isAll=true", () => {
    setCookie("all");
    const result = resolvePageSite(multiCtx);
    expect(result.siteId).toBe(SI_CANTINA);
    expect(result.isAll).toBe(true);
  });

  it("invalid cookie site is ignored, falls back to primary", () => {
    setCookie(UNRELATED);
    const result = resolvePageSite(multiCtx);
    expect(result.siteId).toBe(SI_CANTINA);
    expect(result.isAll).toBe(false);
  });
});

describe("resolvePageSite — URL param overrides cookie", () => {
  it("URL site_id overrides cookie if allowed", () => {
    setCookie(SI_CANTINA); // cookie = Si Cantina
    const result = resolvePageSite(multiCtx, PRIMI); // URL = Primi
    expect(result.siteId).toBe(PRIMI);
  });

  it("URL 'all' takes priority over cookie", () => {
    setCookie(PRIMI);
    const result = resolvePageSite(multiCtx, "all");
    expect(result.isAll).toBe(true);
    expect(result.siteId).toBe(SI_CANTINA); // primary in "all" mode
  });

  it("unauthorized URL site_id is ignored, falls back to cookie", () => {
    setCookie(PRIMI);
    const result = resolvePageSite(multiCtx, UNRELATED);
    // UNRELATED not in siteIds → candidate invalid → falls back to primary
    expect(result.siteId).toBe(SI_CANTINA);
  });

  it("unauthorized URL site_id with no cookie falls back to primary", () => {
    const result = resolvePageSite(multiCtx, UNRELATED);
    expect(result.siteId).toBe(SI_CANTINA);
  });
});

describe("resolvePageSite — switching from Si Cantina to Primi", () => {
  it("cookie-selected Primi is respected over primary Si Cantina", () => {
    setCookie(PRIMI);
    const result = resolvePageSite(multiCtx);
    expect(result.siteId).toBe(PRIMI);
    expect(result.siteId).not.toBe(SI_CANTINA);
  });

  it("URL param Primi is respected over Si Cantina primary", () => {
    const result = resolvePageSite(multiCtx, PRIMI);
    expect(result.siteId).toBe(PRIMI);
  });

  it("switching back to Si Cantina works", () => {
    setCookie(SI_CANTINA);
    const result = resolvePageSite(multiCtx);
    expect(result.siteId).toBe(SI_CANTINA);
  });
});
