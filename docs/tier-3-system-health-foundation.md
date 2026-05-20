# Tier-3: System Health Foundation

> Status: **COMPLETE**
> Builds on: [Tier-2 operational correctness](tier-2-operational-correctness.md)

---

## What Was Added

| File | Type | Description |
|------|------|-------------|
| [lib/types/data-provenance.ts](../lib/types/data-provenance.ts) | New | Shared `DataProvenance` contract and `buildDataProvenance()` helper |
| [components/dashboard/labour/LabourDashboardClient.tsx](../components/dashboard/labour/LabourDashboardClient.tsx) | Updated | Refactored to `provenance: DataProvenance` prop; removed local string union |
| [app/dashboard/labour/page.tsx](../app/dashboard/labour/page.tsx) | Updated | Uses `buildDataProvenance()` to build and pass provenance; detects yesterday fallback |
| [app/api/system-health/checks/route.ts](../app/api/system-health/checks/route.ts) | New | Lightweight `{ ok, generatedAt, checks[] }` endpoint for monitoring consumption |
| [\_\_tests\_\_/integration/cross-site-access.test.ts](../__tests__/integration/cross-site-access.test.ts) | New | Integration test scaffold — validates RLS isolation with live credentials |

---

## Pre-existing System Health (already complete before Tier-3)

The system health layer was more complete than expected at the start of Tier-3:

| Existing file | Description |
|---------------|-------------|
| `app/dashboard/system-health/page.tsx` | Full dashboard UI with cards for MICROS, jobs, errors, checklist, incidents |
| `app/api/system-health/route.ts` | Full `SystemHealthPayload` endpoint (UI-oriented) |
| `app/api/system-health/micros/route.ts` | MICROS health per site |
| `app/api/head-office/system-health/route.ts` | Multi-site system health for Head Office |
| `lib/system-health/getSystemHealth.ts` | Core service with parallel checks, weighted freshness scoring |
| `lib/system-health/types.ts` | `SystemHealthPayload`, `DataSourceHealth`, `MicrosHealth`, `JobHealth` |
| `lib/system-health/getMicrosHealth.ts` | MICROS-specific health checks |

The new `/api/system-health/checks` endpoint complements this with a programmatic,
monitoring-friendly format suitable for external tooling, Slack alerts, or deployment
verification scripts.

---

## Why the DataProvenance Contract Matters

Before Tier-3, the labour dashboard passed these props:

```ts
siteId: string
dataSource: "live_micros" | "mock" | "no_connection"
noConnection?: boolean
useMock: boolean
```

This is a **local string union** — not shared across modules.  If revenue and inventory
dashboards needed the same pattern, they'd define their own incompatible unions.

After Tier-3, `DataProvenance` is the canonical contract:

```ts
export interface DataProvenance {
  source: DataSource;         // "live_micros" | "mock" | "no_connection" | ...
  fetchedAt: string | null;   // ISO-8601 — when was this data last fetched?
  isStale: boolean;           // derived from fetchedAt + staleAfterMinutes SLA
  locRef?: string;            // MICROS location reference, if applicable
  siteId: string;             // which site this data belongs to
  reason?: string;            // why a non-live source was used
}
```

Every dashboard that adopts this contract answers:
- Where did this data come from?
- When was it last synced?
- Is it stale relative to the declared SLA?
- Is it a fallback, estimate, or direct feed?

This is the difference between a dashboard and an operational system.

### Staleness SLA in `buildDataProvenance()`

```ts
const provenance = buildDataProvenance({
  source: "live_micros",
  fetchedAt: summary.lastSyncAt,
  staleAfterMinutes: 60,   // labour SLA: stale after 1 hour
  locRef: connection.loc_ref,
  siteId,
});
// provenance.isStale = (now - fetchedAt) > 60 min
```

SLAs by module (recommended):

| Module | staleAfterMinutes | Rationale |
|--------|-------------------|-----------|
| Labour | 60 | Timecards sync hourly |
| Sales | 15 | Near-real-time POS feed |
| Inventory | 240 | Syncs every 4h |
| Forecasting | 1440 | Daily recompute |
| Compliance | 720 | 12h check cycle |

---

## `/api/system-health/checks` Endpoint

**GET** `/api/system-health/checks`
**Access**: `super_admin | head_office | executive | auditor | area_manager`

```json
{
  "ok": true,
  "generatedAt": "2026-05-19T10:30:00.000Z",
  "checks": [
    {
      "key": "micros_connection_00000001",
      "label": "MICROS · site 00000001",
      "status": "healthy",
      "message": "Connected — loc: 2000002",
      "siteId": "00000000-0000-0000-0000-000000000001",
      "lastSeenAt": "2026-05-19T10:15:00.000Z"
    },
    {
      "key": "last_sync",
      "label": "Last Successful Sync",
      "status": "healthy",
      "message": "Synced 15 min ago",
      "lastSeenAt": "2026-05-19T10:15:00.000Z"
    },
    {
      "key": "rls_hardening",
      "label": "RLS Hardening (Migration 088)",
      "status": "unknown",
      "message": "Cannot verify automatically — requires pg_policies access. ..."
    },
    {
      "key": "labour_freshness_00000001",
      "label": "Labour Freshness · site 00000001",
      "status": "healthy",
      "message": "Today's data present — 45 min old",
      "siteId": "00000000-0000-0000-0000-000000000001"
    }
  ]
}
```

`ok: false` means at least one check is `"critical"`. `"warning"` and `"unknown"` do
not set `ok: false`.

---

## Integration Test Scaffold

`__tests__/integration/cross-site-access.test.ts` is skipped by default unless
the required environment variables are set.  It validates what unit tests cannot:
**the database rejects cross-site reads even if application code attempted them**.

```bash
INTEGRATION_SUPABASE_URL=https://bdzcydhrdjprdzywjbeu.supabase.co \
INTEGRATION_SUPABASE_ANON_KEY=<anon-key> \
INTEGRATION_USER_TOKEN_SITE_A=<jwt-for-site-a-gm> \
INTEGRATION_USER_TOKEN_SITE_B=<jwt-for-site-b-gm> \
INTEGRATION_SITE_A_ID=00000000-0000-0000-0000-000000000002 \
INTEGRATION_SITE_B_ID=00000000-0000-0000-0000-000000000003 \
npx vitest run __tests__/integration/cross-site-access.test.ts
```

Tables tested: `micros_connections`, `sales_uploads`, `zone_snapshots`.

---

## Manual Verification Checklist

- [x] TypeScript: zero errors on all 5 changed/created files
- [x] `dataSource` local string union — removed from `LabourDashboardClient`
- [x] `getMicrosConnection()` (deprecated global) — zero callers in dashboard pages or API routes
- [x] `buildDataProvenance()` — deterministic, unit-testable, handles Date/string/null normalisation
- [x] Stale banner renders correct dot colour (amber when `provenanceStale`, green when fresh)
- [ ] **Manual**: log in as each site GM, verify labour page shows correct site badge + locRef
- [ ] **Manual**: verify `GET /api/system-health/checks` returns 200 for head_office role
- [ ] **Manual**: verify `GET /api/system-health/checks` returns 403 for GM role
- [ ] **Integration**: run `cross-site-access.test.ts` with real credentials when available

---

## Remaining Instrumentation Gaps

| Gap | Priority | Notes |
|-----|----------|-------|
| `getMicrosConnection()` still in `services/micros/status.ts` | Low | Deprecated, zero callers — remove in Tier-4 |
| RLS check in `/checks` endpoint returns "unknown" | Medium | Needs a Supabase RPC `verify_rls_policies()` to automate — Tier-4 |
| Revenue dashboard has no `DataProvenance` | Medium | Next dashboard to adopt the contract |
| Inventory dashboard has no `DataProvenance` | Medium | After revenue |
| Stale banner shows `syncTimeDisplay?.stale` (HH:MM format) | Low | Could show relative time ("4 min ago") |
| Integration tests require manual credential setup | Medium | Add to CI with a dedicated test Supabase project |

---

## Trigger Point for `resolveOperationalContext()`

**Do not build this abstraction yet.**

The correct trigger is when **both of the following are true**:
1. Revenue dashboard implements `DataProvenance` using `getMicrosConnectionBySiteId`
2. Inventory dashboard implements `DataProvenance` using `getMicrosConnectionBySiteId`

At that point, all three modules (labour, revenue, inventory) will share the same
resolution pattern:
```ts
const ctx      = await getUserContext();
const conn     = await getMicrosConnectionBySiteId(ctx.siteId);
const prov     = buildDataProvenance({ source: "live_micros", ... siteId: ctx.siteId });
```

That repetition is the correct signal to extract `resolveOperationalContext()`.
Extracting before it's duplicated three times produces speculative abstraction.

---

## Deployment

No database migration required.  Changes are application-layer only.

```bash
git add lib/types/data-provenance.ts \
        components/dashboard/labour/LabourDashboardClient.tsx \
        app/dashboard/labour/page.tsx \
        app/api/system-health/checks/route.ts \
        __tests__/integration/cross-site-access.test.ts \
        docs/tier-3-system-health-foundation.md
git commit -m "tier-3: DataProvenance contract, labour refactor, system health checks endpoint, integration test scaffold"
git push
```
