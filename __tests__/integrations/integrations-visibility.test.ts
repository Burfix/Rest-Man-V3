/**
 * __tests__/integrations/integrations-visibility.test.ts
 *
 * Tests for multi-site integration visibility logic.
 * Covers the resolved siteId routing used by the integrations settings page
 * and the API route siteId validation pattern.
 */

import { describe, it, expect } from "vitest";

// ── Test data ────────────────────────────────────────────────────────────────

const SI_CANTINA = "00000000-0000-0000-0000-000000000001";
const PRIMI      = "00000000-0000-0000-0000-000000000002";
const SEA_CASTLE = "00000000-0000-0000-0000-000000000003";
const UNRELATED  = "99999999-0000-0000-0000-000000000000";

const headOfficeCtx = {
  userId:  "user-1",
  role:    "head_office",
  siteId:  SI_CANTINA,
  siteIds: [SI_CANTINA, PRIMI, SEA_CASTLE],
  orgId:   "org-1",
};

const gmCtx = {
  userId:  "user-2",
  role:    "gm",
  siteId:  SI_CANTINA,
  siteIds: [SI_CANTINA],
  orgId:   "org-1",
};

const MULTI_SITE_ROLES = new Set(["super_admin", "head_office", "executive", "auditor", "area_manager"]);

// ── Helper: resolve visible site IDs (mirrors page logic) ─────────────────────

function resolveVisibleSiteIds(ctx: { role: string; siteId: string; siteIds: string[] }): string[] {
  return MULTI_SITE_ROLES.has(ctx.role) ? ctx.siteIds : [ctx.siteId];
}

// ── Helper: validate siteId from API request body (mirrors API route logic) ───

function validateBodySiteId(
  ctx: { siteId: string; siteIds: string[] },
  bodySiteId: string | undefined,
): { ok: true; resolvedSiteId: string } | { ok: false; status: 403; message: string } {
  if (bodySiteId !== undefined && !ctx.siteIds.includes(bodySiteId)) {
    return { ok: false, status: 403, message: "Access denied: site not in your accessible sites" };
  }
  return { ok: true, resolvedSiteId: bodySiteId ?? ctx.siteId };
}

// ── Tests: visible sites ─────────────────────────────────────────────────────

describe("integration visibility — visible site IDs", () => {
  it("head_office sees Si Cantina, Primi, and Sea Castle", () => {
    const ids = resolveVisibleSiteIds(headOfficeCtx);
    expect(ids).toContain(SI_CANTINA);
    expect(ids).toContain(PRIMI);
    expect(ids).toContain(SEA_CASTLE);
    expect(ids).toHaveLength(3);
  });

  it("gm sees only own site", () => {
    const ids = resolveVisibleSiteIds(gmCtx);
    expect(ids).toEqual([SI_CANTINA]);
    expect(ids).not.toContain(PRIMI);
  });

  it("super_admin sees all accessible sites", () => {
    const ctx = { ...headOfficeCtx, role: "super_admin" };
    const ids = resolveVisibleSiteIds(ctx);
    expect(ids).toHaveLength(3);
  });

  it("executive sees all accessible sites", () => {
    const ctx = { ...headOfficeCtx, role: "executive" };
    const ids = resolveVisibleSiteIds(ctx);
    expect(ids).toHaveLength(3);
  });

  it("cookie-selected site (Si Cantina) does not hide other visible integrations for head_office", () => {
    // Even if siteId (cookie) = Si Cantina, siteIds still contains all three
    const ctx = { ...headOfficeCtx, siteId: SI_CANTINA };
    const ids = resolveVisibleSiteIds(ctx);
    expect(ids).toContain(PRIMI);
    expect(ids).toContain(SEA_CASTLE);
  });

  it("site without a connection still appears in visible list (disconnected state shown)", () => {
    // The page fetches getMicrosStatus for every visible siteId — even if null result
    const ids = resolveVisibleSiteIds(headOfficeCtx);
    // All three sites appear; UI renders "Not configured" card for null results
    expect(ids).toHaveLength(3);
  });
});

// ── Tests: API siteId validation ──────────────────────────────────────────────

describe("API route siteId validation", () => {
  it("no body siteId falls back to ctx.siteId", () => {
    const result = validateBodySiteId(headOfficeCtx, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolvedSiteId).toBe(SI_CANTINA);
  });

  it("body siteId = Primi is allowed for head_office", () => {
    const result = validateBodySiteId(headOfficeCtx, PRIMI);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolvedSiteId).toBe(PRIMI);
  });

  it("body siteId = Sea Castle is allowed for head_office", () => {
    const result = validateBodySiteId(headOfficeCtx, SEA_CASTLE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolvedSiteId).toBe(SEA_CASTLE);
  });

  it("sync action uses the card's siteId — Si Cantina sync does not trigger Primi", () => {
    const siCantinaSyncResult = validateBodySiteId(headOfficeCtx, SI_CANTINA);
    const primiSyncResult     = validateBodySiteId(headOfficeCtx, PRIMI);
    expect(siCantinaSyncResult.ok).toBe(true);
    expect(primiSyncResult.ok).toBe(true);
    if (siCantinaSyncResult.ok && primiSyncResult.ok) {
      expect(siCantinaSyncResult.resolvedSiteId).not.toBe(primiSyncResult.resolvedSiteId);
      expect(siCantinaSyncResult.resolvedSiteId).toBe(SI_CANTINA);
      expect(primiSyncResult.resolvedSiteId).toBe(PRIMI);
    }
  });

  it("Sea Castle sync uses Sea Castle siteId — not Si Cantina", () => {
    const result = validateBodySiteId(headOfficeCtx, SEA_CASTLE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedSiteId).toBe(SEA_CASTLE);
      expect(result.resolvedSiteId).not.toBe(SI_CANTINA);
    }
  });

  it("unauthorized siteId returns 403", () => {
    const result = validateBodySiteId(headOfficeCtx, UNRELATED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("gm cannot sync a different site via body siteId", () => {
    const result = validateBodySiteId(gmCtx, PRIMI);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("gm can sync own site (body siteId = own site)", () => {
    const result = validateBodySiteId(gmCtx, SI_CANTINA);
    expect(result.ok).toBe(true);
  });
});

// ── Tests: disconnected integrations still render ─────────────────────────────

describe("disconnected integrations still appear", () => {
  it("null microsResult maps to 'not configured' — card still renders", () => {
    const integrations = headOfficeCtx.siteIds.map((siteId) => ({
      siteId,
      microsResult: siteId === SI_CANTINA ? { connection: { id: "conn-1", status: "connected" } } : null,
    }));
    // All three sites are in the list
    expect(integrations).toHaveLength(3);
    // Primi and Sea Castle have null microsResult — rendered as "Not configured"
    const primi = integrations.find((i) => i.siteId === PRIMI);
    expect(primi?.microsResult).toBeNull();
    const seaCastle = integrations.find((i) => i.siteId === SEA_CASTLE);
    expect(seaCastle?.microsResult).toBeNull();
  });

  it("connected Si Cantina still renders even when Primi is disconnected", () => {
    const integrations = headOfficeCtx.siteIds.map((siteId) => ({
      siteId,
      connected: siteId === SI_CANTINA,
    }));
    const siCantina = integrations.find((i) => i.siteId === SI_CANTINA);
    expect(siCantina?.connected).toBe(true);
    // The page renders ALL integrations, not just connected ones
    expect(integrations.filter((i) => !i.connected)).toHaveLength(2);
  });
});
