/**
 * lib/sync/simphony-client.ts
 *
 * Thin Oracle Simphony client for the new sync handler layer.
 * Wraps lib/micros/client.ts and auth.ts with typed interfaces
 * specific to the endpoints used by our four sync types.
 */

import { getMicrosIdToken } from "@/lib/micros/auth";
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
}

export class SimphonyClient {
  private readonly baseUrl: string;
  private readonly orgIdentifier: string;
  private idToken: string | null;

  constructor(opts: SimphonyClientOptions) {
    this.baseUrl = opts.appServerUrl.replace(/\/$/, "");
    this.orgIdentifier = opts.orgIdentifier;
    this.idToken = opts.idToken ?? null;
  }

  private async getToken(): Promise<string> {
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
        // Token expired — invalidate and retry once
        this.idToken = null;
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

export function buildSimphonyClient(connection: {
  app_server_url: string;
  org_identifier: string;
}): SimphonyClient {
  return new SimphonyClient({
    appServerUrl: connection.app_server_url,
    orgIdentifier: connection.org_identifier,
  });
}

// ── Helper ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
