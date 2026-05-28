/**
 * lib/sync/simphony-client.ts
 *
 * Thin Oracle Simphony client for the new sync handler layer.
 * Wraps lib/micros/client.ts and auth.ts with typed interfaces
 * specific to the endpoints used by our four sync types.
 */

import { getMicrosIdToken } from "@/lib/micros/auth";
import {
  acquireLocationToken,
  clearLocationTokenCache,
} from "@/lib/micros/location-auth";
import {
  getLocationConfigForConnection,
  getMissingEnvNames,
  type LocationConfig,
} from "@/lib/micros/micros-location-registry";
import { logger } from "@/lib/logger";
import { scrubTokens } from "./observability";

// ── Simphony error class ──────────────────────────────────────────────────────

export class SimphonyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "SimphonyError";
  }
}

export class SimphonyTimeoutError extends SimphonyError {
  constructor(endpoint: string, timeoutMs: number) {
    super(
      `Simphony request timed out after ${timeoutMs}ms: ${endpoint}`,
      "SIMPHONY_TIMEOUT",
      true, // timeouts are always retryable
    );
    this.name = "SimphonyTimeoutError";
  }
}

export class SimphonyAuthError extends SimphonyError {
  constructor(detail: string) {
    super(`Simphony auth failed: ${detail}`, "SIMPHONY_AUTH", false);
    this.name = "SimphonyAuthError";
  }
}

// ── Client class ──────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = [408, 429, 500, 502, 503, 504] as const;

interface SimphonyClientOptions {
  appServerUrl: string;
  orgIdentifier: string;
  /** Pre-fetched id_token; if absent, will be fetched via PKCE */
  idToken?: string;
  /**
   * Per-location config resolved from the registry.
   * When present, acquireLocationToken() is used so each Oracle org gets
   * its own isolated token (prevents error 33102 org identity mismatch).
   * When absent, falls back to the global getMicrosIdToken() for backward
   * compatibility with single-org deployments.
   */
  locationConfig?: LocationConfig;
}

export class SimphonyClient {
  private readonly baseUrl: string;
  private readonly orgIdentifier: string;
  private idToken: string | null;
  private readonly locationConfig: LocationConfig | null;

  constructor(opts: SimphonyClientOptions) {
    this.baseUrl = opts.appServerUrl.replace(/\/$/, "");
    this.orgIdentifier = opts.orgIdentifier;
    this.idToken = opts.idToken ?? null;
    this.locationConfig = opts.locationConfig ?? null;
  }

  private async getToken(): Promise<string> {
    // When a per-org LocationConfig is available, use the per-location token
    // cache (location-auth.ts). This prevents Oracle error 33102 caused by a
    // global cached token belonging to a different Oracle org.
    if (this.locationConfig) {
      if (this.locationConfig.configured) {
        logger.info("[SimphonyClient] Acquiring per-org token", {
          orgIdentifier: this.orgIdentifier,
          locationKey:   this.locationConfig.key,
          authFlow:      this.locationConfig.authFlow,
        });
        return acquireLocationToken(this.locationConfig);
      }

      // LocationConfig found but not fully configured — determine exactly which
      // env vars are missing so the operator gets an actionable error message.
      const missing = getMissingEnvNames(this.locationConfig);
      logger.warn("[SimphonyClient] LocationConfig not fully configured", {
        orgIdentifier: this.orgIdentifier,
        locationKey:   this.locationConfig.key,
        missingEnv:    missing,
      });

      // Hard-block: PRI/PRIMI must never fall through to the global SCS token.
      const NON_GLOBAL_ORGS = ["PRI", "PRIMI"];
      if (NON_GLOBAL_ORGS.includes(this.orgIdentifier.toUpperCase())) {
        throw new SimphonyAuthError(
          `Simphony auth failed: org=${this.orgIdentifier} requires per-location credentials ` +
          `(tokenIsolation=per-location). Global token fallback is refused. ` +
          `Missing env vars: ${missing.length > 0 ? missing.join(", ") : "(none detected — check DB auth_flow)"}. ` +
          `Set these in Vercel and ensure micros_location_configs.auth_flow='client_credentials' for location_key='primi-camps-bay'.`,
        );
      }
    } else {
      // No LocationConfig found for this org — log a warning and fall back.
      // This is expected for orgs not yet in the registry but is a known
      // token isolation risk when multiple Oracle orgs are in use.
      logger.warn("[SimphonyClient] No LocationConfig for org — using global token (TOKEN_ORG_MISMATCH_RISK)", {
        orgIdentifier: this.orgIdentifier,
        hint: "Register the org in micros_location_configs to enable per-org token isolation.",
      });

      // Hard-block: known non-SCS orgs must never use the global token even
      // when no LocationConfig row exists. The global token is a SCS PKCE token.
      const NON_GLOBAL_ORGS = ["PRI", "PRIMI"];
      if (NON_GLOBAL_ORGS.includes(this.orgIdentifier.toUpperCase())) {
        throw new SimphonyAuthError(
          `Simphony auth failed: org=${this.orgIdentifier} has no location registry entry ` +
          `and global token fallback is refused. ` +
          `Add a row to micros_location_configs with location_key='primi-camps-bay', ` +
          `auth_flow='client_credentials', and set MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET.`,
        );
      }
    }

    // Global fallback path (single-org SCS deployments only)
    if (!this.idToken) {
      this.idToken = await getMicrosIdToken();
    }
    return this.idToken;
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}/bi/v1/${this.orgIdentifier}/${path.replace(/^\//, "")}`;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    attempt = 1,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const token = await this.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
      });

      clearTimeout(timer);

      if (res.status === 401) {
        // Token rejected — clear the right cache and retry once
        if (this.locationConfig) {
          clearLocationTokenCache(this.locationConfig.key);
        } else {
          this.idToken = null;
        }
        if (attempt <= 1) {
          return this.request<T>(method, path, body, attempt + 1);
        }
        throw new SimphonyAuthError("Token rejected after refresh attempt");
      }

      if (!res.ok) {
        const isRetryable = (RETRYABLE_STATUS as readonly number[]).includes(res.status);
        if (isRetryable && attempt <= MAX_RETRIES) {
          await sleep(500 * attempt);
          return this.request<T>(method, path, body, attempt + 1);
        }
        const text = await res.text().catch(() => "(unreadable)");
        throw new SimphonyError(
          `HTTP ${res.status} from Simphony: ${text.slice(0, 200)}`,
          `HTTP_${res.status}`,
          isRetryable,
          res.status,
        );
      }

      const data = await res.json() as T;
      return data;
    } catch (err) {
      clearTimeout(timer);

      if (err instanceof SimphonyError) throw err;

      if ((err as { name?: string }).name === "AbortError") {
        if (attempt <= MAX_RETRIES) {
          await sleep(1000 * attempt);
          return this.request<T>(method, path, body, attempt + 1);
        }
        throw new SimphonyTimeoutError(path, REQUEST_TIMEOUT_MS);
      }

      throw new SimphonyError(
        err instanceof Error ? err.message : String(err),
        "SIMPHONY_NETWORK",
        true,
      );
    }
  }

  /** POST /bi/v1/{org}/getGuestChecks — guest checks for a business date */
  async getGuestChecks(locRef: string, busDt: string): Promise<SimphonyGuestChecksResponse> {
    logger.info("simphony.getGuestChecks", scrubTokens({ locRef, busDt }));
    return this.request<SimphonyGuestChecksResponse>("POST", "getGuestChecks", {
      locRef,
      busDt,
    });
  }

  /** POST /bi/v1/{org}/getDailySalesSummary — aggregated daily totals */
  async getDailySalesSummary(locRef: string, busDt: string): Promise<SimphonyDailySalesResponse> {
    logger.info("simphony.getDailySalesSummary", scrubTokens({ locRef, busDt }));
    return this.request<SimphonyDailySalesResponse>("POST", "getDailySalesSummary", {
      locRef,
      busDt,
    });
  }

  /** POST /bi/v1/{org}/getTimecards — labour timecards for a business date */
  async getTimecards(locRef: string, busDt: string): Promise<SimphonyTimecardsResponse> {
    logger.info("simphony.getTimecards", scrubTokens({ locRef, busDt }));
    return this.request<SimphonyTimecardsResponse>("POST", "getTimecards", {
      locRef,
      busDt,
    });
  }

  /** POST /bi/v1/{org}/getSalesIntervals — intraday revenue intervals */
  async getSalesIntervals(
    locRef: string,
    busDt: string,
    intervalMinutes = 60,
  ): Promise<SimphonySalesIntervalsResponse> {
    logger.info("simphony.getSalesIntervals", scrubTokens({ locRef, busDt, intervalMinutes }));
    return this.request<SimphonySalesIntervalsResponse>("POST", "getSalesIntervals", {
      locRef,
      busDt,
      intervalMinutes,
    });
  }
}

// ── Oracle Simphony response shapes ──────────────────────────────────────────
// NOTE: These are typed to what the API actually returns.
// All fields marked optional since Oracle responses can be sparse.

export interface SimphonyGuestCheck {
  guestCheckId?: string;
  checkNum?: string | number;
  busDt?: string;
  opnBusDt?: string;
  clsdBusDt?: string;
  locRef?: string;
  revCtrId?: number;
  tableName?: string;
  guestCnt?: number;
  subTtl?: number;
  tax1?: number;
  tax2?: number;
  tax3?: number;
  totTax?: number;
  chkTtl?: number;
  dscTtl?: number;
  svcChgTtl?: number;
  totDue?: number;
  ttlPmtAmt?: number;
  clsdFlag?: boolean;
  clsdUtc?: string;
  autoSvcChg?: number;
}

export interface SimphonyGuestChecksResponse {
  guestChecks?: SimphonyGuestCheck[];
  guestChecksTotalCount?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface SimphonyDailySalesResponse {
  locRef?: string;
  busDt?: string;
  netSales?: number;
  grossSales?: number;
  guestCnt?: number;
  transactionCount?: number;
  discounts?: number;
  serviceCharge?: number;
  tax?: number;
  voids?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface SimphonyTimecard {
  tcId?: string;
  empNum?: string;
  jobCodeRef?: string;
  jcNum?: string;
  busDt?: string;
  locRef?: string;
  clkInLcl?: string;
  clkOutLcl?: string;
  regHrs?: number;
  regPay?: number;
  ovt1Hrs?: number;
  ovt1Pay?: number;
  totHrs?: number;
  totPay?: number;
}

export interface SimphonyTimecardsResponse {
  timecards?: SimphonyTimecard[];
  errorCode?: string;
  errorMessage?: string;
}

export interface SimphonySalesInterval {
  locRef?: string;
  busDt?: string;
  intervalStart?: string;
  intervalEnd?: string;
  hour?: number;
  netSales?: number;
  guestCnt?: number;
  transactionCount?: number;
}

export interface SimphonySalesIntervalsResponse {
  intervals?: SimphonySalesInterval[];
  errorCode?: string;
  errorMessage?: string;
}

// ── Factory: build a client from a connection row ─────────────────────────────

export async function buildSimphonyClient(connection: {
  app_server_url: string;
  org_identifier: string;
  location_key?: string | null;
}): Promise<SimphonyClient> {
  // Resolve per-org credentials using location_key when available (exact routing),
  // otherwise falls back to org_identifier disambiguation.
  // This prevents Oracle 33102 "org identity mismatch" and handles the SCS
  // ambiguity (Si Cantina + Sea Castle both have org_identifier=SCS).
  const locationConfig = await getLocationConfigForConnection({
    org_identifier: connection.org_identifier,
    location_key:   connection.location_key,
  });

  // Registry fallback for app_server_url / org_identifier:
  // Sea Castle (and Si Cantina) intentionally store '' in the DB for these
  // fields — migration 082 comment: "shared: read from MICROS_* at runtime".
  // The registry (env vars) is the authoritative source for Oracle endpoints.
  const appServerUrl  = connection.app_server_url?.trim()  || locationConfig?.baseUrl              || "";
  const orgIdentifier = connection.org_identifier?.trim()  || locationConfig?.enterpriseShortName  || "";

  if (!appServerUrl || !orgIdentifier) {
    throw new SimphonyError(
      `MICROS_LOCATION_CONFIG_MISSING: Cannot build Oracle URL — appServerUrl and ` +
        `orgIdentifier are empty for location_key="${connection.location_key ?? "none"}", ` +
        `org_identifier="${connection.org_identifier}". ` +
        `Check the micros_connections DB row and micros-location-registry.ts env vars.`,
      "MICROS_LOCATION_CONFIG_MISSING",
      false,
    );
  }

  if (!locationConfig) {
    logger.warn("[buildSimphonyClient] org_identifier not found in location registry", {
      org_identifier: connection.org_identifier,
      hint: "Add the org to micros-location-registry.ts to enable token isolation.",
    });
  } else if (!locationConfig.configured) {
    logger.warn("[buildSimphonyClient] LocationConfig found but not fully configured", {
      org_identifier: connection.org_identifier,
      locationKey:    locationConfig.key,
      hint: "Check that all required env vars are set for this location.",
    });
  }

  return new SimphonyClient({
    appServerUrl,
    orgIdentifier,
    locationConfig: locationConfig ?? undefined,
  });
}

// ── Helper ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
