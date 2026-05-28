# MICROS Integration Runbook

## Overview

ForgeStack manages Oracle MICROS Simphony BI API integrations for multiple restaurant sites. Each site is registered in the `micros_location_configs` database table. Credentials live **exclusively in environment variables** — never in the database.

---

## Supported Sites

| Location Key           | Display Name              | Auth Flow | Org ID | Location Ref |
|------------------------|---------------------------|-----------|--------|--------------|
| `si-cantina`           | Si Cantina Sociale        | `pkce`    | SCS    | env var      |
| `sea-castle-camps-bay` | Sea Castle Hotel Camps Bay| `pkce`    | SCS    | `2001002`    |
| `primi-camps-bay`      | Primi Camps Bay           | `pkce`    | PRI    | `101003`     |

All three sites use **PKCE flow**. Primi uses separate per-location credentials (different Oracle org and API account) from Si Cantina and Sea Castle.

---

## Primi Camps Bay — Required Vercel Environment Variables

Primi uses **PKCE flow** with a dedicated Oracle API account (`PRI_THAMSANQA_BIAPI`). All variables use the prefix `MICROS_PRIMI_CAMPS_BAY_`.

| Variable                               | Description                                          |
|----------------------------------------|------------------------------------------------------|
| `MICROS_PRIMI_CAMPS_BAY_AUTH_URL`      | Oracle IDM auth server base URL (no trailing /)      |
| `MICROS_PRIMI_CAMPS_BAY_BI_SERVER`     | Oracle Simphony BI app server base URL               |
| `MICROS_PRIMI_CAMPS_BAY_CLIENT_ID`     | Oracle OAuth client ID — use raw value from Oracle letter |
| `MICROS_PRIMI_CAMPS_BAY_ORG_IDENTIFIER`| Oracle org identifier: `PRI`                         |
| `MICROS_PRIMI_CAMPS_BAY_USERNAME`      | API account name: `PRI_THAMSANQA_BIAPI`              |
| `MICROS_PRIMI_CAMPS_BAY_PASSWORD`      | **[SECRET]** API account password                    |

> **Note:** `MICROS_PRIMI_CAMPS_BAY_LOCATION_REF` is stored in the database (`location_ref = '101003'`) since migration 102. You do not need this env var unless you want an override.

> **Migration history note:** Migrations 102 and 103 incorrectly set `auth_flow='client_credentials'` for Primi based on a misread of the Oracle provisioning letter. Migration 104 corrects this back to `pkce`. The Oracle API Account Details letter for org PRI shows a PKCE API account (account name + client ID), not an OAuth2 service account.

### Example values (redacted)
```
MICROS_PRIMI_CAMPS_BAY_AUTH_URL        = https://ors-idm.msaf.oraclerestaurants.com
MICROS_PRIMI_CAMPS_BAY_BI_SERVER       = https://simphony-home.msaf.oraclerestaurants.com
MICROS_PRIMI_CAMPS_BAY_CLIENT_ID       = UFJJLmQ1Zjg3YjNlLWM4MmItNDM0ZC05OTZlLWM5NzVlZjVjN2VhYQ
MICROS_PRIMI_CAMPS_BAY_ORG_IDENTIFIER  = PRI
MICROS_PRIMI_CAMPS_BAY_USERNAME        = PRI_THAMSANQA_BIAPI
MICROS_PRIMI_CAMPS_BAY_PASSWORD        = [SET IN VERCEL — never commit to code]
```

> **If you previously set `MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET`:** That value is the API account password stored under the wrong name. Copy it to `MICROS_PRIMI_CAMPS_BAY_PASSWORD` and add `MICROS_PRIMI_CAMPS_BAY_USERNAME = PRI_THAMSANQA_BIAPI`. The `CLIENT_SECRET` var can be left as a dead var or deleted.

---

## Si Cantina Sociale + Sea Castle — Required Env Variables

Both sites share the `MICROS_` prefix and PKCE credentials.

| Variable                    | Description                                 |
|-----------------------------|---------------------------------------------|
| `MICROS_AUTH_SERVER`        | Oracle IDM auth server base URL             |
| `MICROS_BI_SERVER`          | Oracle Simphony BI app server               |
| `MICROS_CLIENT_ID`          | OAuth client ID                             |
| `MICROS_ORG_SHORT_NAME`     | Oracle org identifier: `SCS`                |
| `MICROS_USERNAME`           | API account username                        |
| `MICROS_PASSWORD`           | **[SECRET]** API account password           |
| `MICROS_LOCATION_REF`       | Si Cantina location ref (e.g. `200100`)     |

Sea Castle uses `location_ref = '2001002'` stored in the database — it reads auth credentials from the same `MICROS_` env vars as Si Cantina.

---

## Token Isolation Architecture

```
Oracle org PRI (Primi)            → per-location PKCE token via MICROS_PRIMI_CAMPS_BAY_*
Oracle org SCS (Si Cantina / Sea Castle) → per-location PKCE token via MICROS_*

NO cross-org token sharing. Global token fallback is hard-blocked for PRI/PRIMI.
```

Every registered location in `micros_location_configs` uses `tokenIsolation=per-location`. The `getMicrosIdToken()` global function is SCS-only and may never be used for PRI.

---

## Diagnosing Auth Issues

### Step 1: Run the doctor script

```bash
npm run micros:doctor
```

This prints per-location configuration status, missing env var names (no values), location_ref uniqueness check, and an overall health summary.

### Step 2: Check the admin health API

```
GET /api/admin/integrations/micros/health
```

Returns JSON including `missingEnv[]`, `authFlow`, `configured`, and `tokenIsolation` for each registered location. Requires head-office / super_admin role.

### Step 3: Check per-location status

```
GET /api/integrations/micros/status?locationKey=primi-camps-bay
```

Returns connection status, last sync times, and whether sales/labour data exists today.

---

## Common Errors and Fixes

### `Auth failed — Simphony auth failed: Primi requires configured per-location credentials`

**Cause:** One of:
1. `micros_location_configs` row for `primi-camps-bay` has `auth_flow='client_credentials'` instead of `pkce` — fixed by migration 104.
2. `MICROS_PRIMI_CAMPS_BAY_USERNAME` or `MICROS_PRIMI_CAMPS_BAY_PASSWORD` is not set in Vercel.

**Fix:**
1. Apply migration 104 if not already applied.
2. Add `MICROS_PRIMI_CAMPS_BAY_USERNAME = PRI_THAMSANQA_BIAPI` in Vercel.
3. Add `MICROS_PRIMI_CAMPS_BAY_PASSWORD = <password>` in Vercel. If `MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET` already exists, its value IS the password — copy it.
4. Redeploy. Run `npm run micros:doctor` to verify.

### `UNSUPPORTED_CLIENT` (HTTP 400 from Oracle IDM)

**Cause:** `auth_flow='client_credentials'` is set in the DB (migrations 102/103), causing a client_credentials token request to Oracle. Oracle rejects it because the PRI client app is a PKCE account, not a confidential service account.

**Fix:** Apply migration 104 to revert `auth_flow='pkce'`. Add `USERNAME` + `PASSWORD` env vars (see above). Redeploy.

### `MICROS_LOCATION_CONFIG_MISSING`

**Cause:** The `micros_connections` DB row has empty `app_server_url` and `org_identifier`, and no matching `LocationConfig` was found in the registry.

**Fix:** Ensure the `micros_location_configs` row exists for the org and the env vars are set.

### Oracle error 33102 `Organization identifier does not match`

**Cause:** A SCS PKCE token was used against the PRI endpoint (token org mismatch).

**Fix:** Ensure Primi's `auth_flow='pkce'` in `micros_location_configs` (migration 104) and `USERNAME`/`PASSWORD` are set. The hard-block in `SimphonyClient` and `LabourClient` prevents this from happening silently.

### Sea Castle labour cost shows R0 in Profit Intelligence

**Symptom:** `labour_daily_summary` rows for `loc_ref=2001002` (Sea Castle) show `total_pay=0.00` and `total_hours=0.00` even though `active_staff_count > 0` (staff are clocking in). Dashboard shows a `labour_pay_unconfigured` data quality warning.

**Root cause:** Oracle MICROS returns valid attendance timecards (clock-in/clock-out timestamps, employee numbers) but all pay and hours fields are zero. The `job_code_ref` field on every Sea Castle timecard is empty, indicating job codes 4 and 8 at this location have no pay rates configured in Oracle MICROS. Sea Castle is a hotel F&B outlet — the hotel likely runs payroll through a separate system and uses MICROS only for attendance recording.

**This is NOT a ForgeStack bug.** The sync code, normalizer, and summary builder are all working correctly.

**To fix:** Log into the Oracle MICROS Simphony admin for Sea Castle (org SCS) and configure pay rates for job codes 4 and 8. Once pay rates are set, the next labour sync will populate `reg_hrs`, `reg_pay`, `total_hours`, and `total_pay` correctly.

**If pay rates will never be configured** (hotel payroll is always external): The `labour_pay_unconfigured` warning in the dashboard is the intended behaviour. No fix required in ForgeStack.

---

### `configured=false` with empty `missingEnv` array

**Cause:** The `auth_flow` in the DB does not match the credentials that are set. For example, `auth_flow='client_credentials'` but only `USERNAME/PASSWORD` are present (not `CLIENT_SECRET`).

**Fix:** Check the `auth_flow` column in `micros_location_configs`. For Primi it must be `pkce` (migration 104).

---

## Migrations

| Migration | Description |
|-----------|-------------|
| `101_micros_location_registry.sql` | Creates `micros_location_configs` table and seeds the 3 initial locations |
| `102_fix_primi_auth_flow.sql`      | Fixes `location_ref='101003'` for Primi (auth_flow change in this migration was incorrect) |
| `103_fix_primi_auth_flow.sql`      | Re-applies upsert for Primi connection row (auth_flow change also incorrect) |
| `104_fix_primi_to_pkce.sql`        | **Correct fix**: reverts Primi `auth_flow` back to `pkce` per Oracle provisioning letter |

---

## Password Rotation Procedure (Every 60 Days)

Oracle PKCE API account passwords expire after **60 days**. This affects all three sites. When a password expires, syncs fail with:

```
[LocationAuth:<location>:signin] API account password has expired. Reset it in Oracle IDM.
```

### Rotation schedule

| Site | Account | Prefix | Rotate every |
|------|---------|--------|-------------|
| Primi Camps Bay | `PRI_THAMSANQA_BIAPI` | `MICROS_PRIMI_CAMPS_BAY_` | 60 days |
| Si Cantina + Sea Castle | SCS API account | `MICROS_` | 60 days |

### Step-by-step: Rotating the Primi password

1. Log into the Oracle MSAF admin portal: `https://ors-idm.msaf.oraclerestaurants.com`
2. Navigate to **Users → API Accounts** for org `PRI`
3. Find `PRI_THAMSANQA_BIAPI` and reset the password
4. In Vercel → **forgestack project → Settings → Environment Variables → Production**:
   - Find `MICROS_PRIMI_CAMPS_BAY_PASSWORD`
   - Update its value to the new password
5. Redeploy (required — env vars are frozen at deploy time)
6. Run `npm run micros:doctor` to verify `configured=YES`
7. Click **Sync sales** and **Sync labour** in the admin UI to confirm

> **Never commit the password to code.** It lives exclusively in Vercel environment variables.

> **Stale CLIENT_SECRET:** If `MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET` still exists in Vercel from the migration 102/103 era, it is harmless but unused. It can be deleted after confirming `PASSWORD` is set and working.

### Proactive reminders

A scheduled reminder fires every 55 days (5 days before Oracle's 60-day limit) to prompt rotation. Check Cowork scheduled tasks or `npm run micros:doctor` output for reminders.

---

## Adding a New MICROS Location

1. Insert a row into `micros_location_configs`:

```sql
INSERT INTO micros_location_configs
  (location_key, display_name, auth_flow, env_prefix, location_ref, enabled)
VALUES
  ('new-location-key', 'Display Name', 'pkce',
   'MICROS_NEW_LOCATION_', '123456', true);
```

2. Add the required env vars to Vercel using the chosen prefix.

3. Run `npm run micros:doctor` to verify configuration.

4. The new location is immediately available — no code change, no redeploy required.

---

## Script Reference

| Script | Description |
|--------|-------------|
| `npm run micros:doctor` | Multi-location health check (no secrets printed) |
| `npm run micros:check:primi` | Primi-specific legacy check |
| `npm run micros:validate` | Validates location_ref uniqueness |
| `npm run micros:sync:primi` | Manual Primi sales sync |
| `npm run micros:sync:sea-castle` | Manual Sea Castle sales sync |
