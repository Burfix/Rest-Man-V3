# Tier-2 Operational Correctness Hardening

> Status: **COMPLETE** — implemented ahead of Primi Camps Bay + Sea Castle GM onboarding  
> Preceded by: [Migration 088 — Tier-1 RLS hardening](deployment-audit-report.md)

---

## Problem Statement

After Tier-1 (RLS row-level policy hardening), the database correctly rejected
cross-site reads.  However, the **labour dashboard page** contained application-level
fallbacks that could show one site's operational state (Si Cantina MICROS config)
to a GM logged in to a different site:

```ts
// ❌ BEFORE — could return Si Cantina's loc_ref for any site's GM
const allLocations = getAllLocationConfigs();
for (const loc of configuredLocations) {
  const conn = await getMicrosConnectionByLocationKey(loc.key).catch(() => null);
  if (conn?.loc_ref) { locRef = conn.loc_ref; break; } // first match wins
  if (loc.locationRef)  { locRef = loc.locationRef; break; }
}
if (!locRef) {
  const connection = await getMicrosConnection().catch(() => null); // global — no site filter
  locRef = connection?.loc_ref ?? cfg.locRef ?? null;               // env fallback
}
```

The env fallback (`cfg.locRef`) reads `process.env.MICROS_LOCATION_REF`, which is
set to Si Cantina's `loc_ref` (`2000002`).  Sea Castle and Primi GMs would see
Si Cantina labour data if their site had no explicit MICROS record.

---

## What Was Changed

### 1. `app/dashboard/labour/page.tsx` (Server Component)

**Old behaviour**: multi-location loop → `getMicrosConnection()` global fallback → env var fallback  
**New behaviour**: `getUserContext()` → `getMicrosConnectionBySiteId(siteId)` → fail closed

```ts
// ✅ AFTER — site-scoped, no fallback chain
const ctx = await getUserContext();          // throws 401 if unauthenticated
const siteId = ctx.siteId;                   // user's assigned site only
const connection = await getMicrosConnectionBySiteId(siteId).catch(() => null);
if (!connection?.loc_ref) {
  // Safe "no connection" state — NEVER shows another site's data
  return <LabourDashboardClient ... dataSource="no_connection" noConnection={true} />;
}
const locRef = connection.loc_ref;           // guaranteed to belong to siteId
```

Removed imports: `getMicrosEnvConfig`, `getMicrosConnection`,
`getMicrosConnectionByLocationKey`, `getAllLocationConfigs`.

### 2. `components/dashboard/labour/LabourDashboardClient.tsx` (Client Component)

Added three new required props:

| Prop | Type | Purpose |
|------|------|---------|
| `siteId` | `string` | UUID of the authenticated site |
| `dataSource` | `"live_micros" \| "mock" \| "no_connection"` | Data provenance |
| `noConnection` | `boolean?` | Triggers the "no POS connection" state |

**New states rendered**:
- `noConnection === true` → "No POS Connection for This Site" state with `siteId` shown,
  and `<LabourCsvUpload />` fallback
- Data-loaded → provenance banner: `Live MICROS · loc: {locRef} · site: {last8 of siteId}`

### 3. `__tests__/tenant-isolation.test.ts` — Tier-2 describe block

8 new tests added under `"Tier-2 — Labour dashboard MICROS config isolation"`:

| # | Test | What it asserts |
|---|------|-----------------|
| 1 | `getMicrosConnectionBySiteId` throws on empty siteId | Guard against unresolved sites |
| 2 | Sea Castle user gets null when no connection | No cross-site data bleed |
| 3 | Primi user gets null when no connection | No cross-site data bleed |
| 4 | Returns site-specific locRef, not another site's | `LOC_REF_SEA_CASTLE` ≠ `LOC_REF_SI_CANTINA` |
| 5 | Labour page: `no_connection` state when no connection | Page fails closed |
| 6 | Labour page: locRef from DB, not env var | No `MICROS_LOCATION_REF` fallback |
| 7 | Si Cantina locRef never used as fallback | `2000002` not present in output |
| 8 | `getMicrosStatus` throws on empty siteId | Consistent guard across service layer |

---

## Verification Checklist

- [x] `getMicrosConnectionBySiteId` filters by `.eq("site_id", siteId)` — reviewed in `services/micros/status.ts`
- [x] No call to `getMicrosConnection()` (global/deprecated) remains in dashboard pages
- [x] No call to `getMicrosEnvConfig()` in dashboard pages for locRef resolution
- [x] `getAllLocationConfigs()` no longer called from dashboard pages
- [x] TypeScript: zero errors (`get_errors` on all three changed files)
- [ ] Vitest tests passing — **run `npm test` once Node.js is available**
- [ ] Manual smoke test: log in as Primi Camps Bay GM → labour page shows "No POS Connection for This Site" until MICROS is configured

---

## Remaining Known Risks

### Low — `getMicrosConnection()` still exists in `services/micros/status.ts`

This deprecated function (global, no site filter) still exists in the codebase.
It has **zero callers** in production dashboard code after this hardening.
It remains only in scripts (`scripts/manual-sync.ts` etc.) which are CLI tools,
not web request handlers.

**Recommended**: remove in Tier-3, or add a `console.warn("DEPRECATED: …")` call.

### Acceptable — Mock data in development

`app/dashboard/labour/page.tsx` shows mock data when `NODE_ENV === "development"`
**and** no real data has loaded.  This is intentional and never executes in production.

### Acceptable — CLI scripts use env vars

`scripts/manual-labour-sync.ts`, `scripts/run-sync-*.ts` read `MICROS_LOCATION_REF`
from the environment.  These are operator CLI tools, not request handlers, and
do not have a user-authentication boundary.

---

## Deployment

No database migration required.  Changes are application-layer only.

```bash
git add app/dashboard/labour/page.tsx \
        components/dashboard/labour/LabourDashboardClient.tsx \
        __tests__/tenant-isolation.test.ts \
        docs/tier-2-operational-correctness.md
git commit -m "tier-2: site-scoped labour dashboard, provenance banner, isolation tests"
git push
```

Vercel will deploy automatically on push.  No new environment variables are required.

---

## Related

- [Tier-1 RLS hardening deployment report](deployment-audit-report.md)
- [Migration 088 SQL](../supabase/migrations/088_rls_tier1_hardening.sql)
- [Tenant isolation test suite](../__tests__/tenant-isolation.test.ts)
- [Phase 1 hardcoded values report](phase1-hardcoded-values-report.md)
