/**
 * services/micros/labour/client.ts
 *
 * Oracle MICROS BI API client functions for labour endpoints.
 * Uses the existing authenticated MicrosApiClient (Bearer id_token).
 */

import { MicrosApiClient } from "@/lib/micros/client";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { getMicrosIdToken } from "@/lib/micros/auth";
import type {
  OracleTimeCardResponse,
  OracleJobCodeResponse,
} from "@/types/labour";

// ── Per-connection override ───────────────────────────────────────────────

/**
 * When provided, Oracle requests use this connection's app_server_url and
 * org_identifier instead of the global MICROS_* env vars.
 *
 * Prevents Oracle error 33109 ("Invalid location reference field") when
 * multiple Oracle orgs are in use — e.g. Si Cantina (SCN) and Primi (PRI)
 * both appear in micros_connections but share one set of global env vars.
 */
export interface ConnectionContext {
  appServerUrl: string;
  orgIdentifier: string;
}

// ── Request parameter types ───────────────────────────────────────────────

export interface GetTimeCardDetailsParams {
  /** Business date in YYYY-MM-DD format */
  busDt?: string;
  /** Posted date filter */
  postedDt?: string;
  /** ISO UTC timestamp for delta sync — returns records changed since this time */
  changedSinceUTC?: string;
  /** Location reference (defaults to env MICROS_LOCATION_REF) */
  locRef?: string;
  /**
   * Per-connection override. When set, overrides global env vars for the
   * Oracle API URL. Prevents 33109 when syncing a non-primary Oracle org.
   */
  connectionContext?: ConnectionContext;
}

export interface GetJobCodeDimensionsParams {
  /** Location reference (defaults to env MICROS_LOCATION_REF) */
  locRef?: string;
  /** Per-connection override — see ConnectionContext. */
  connectionContext?: ConnectionContext;
}

/**
 * POST /bi/v1/{orgIdentifier}/getTimeCardDetails
 *
 * Retrieves timecard / pay detail records from Oracle.
 * Supports full pull (by busDt) and delta pull (by changedSinceUTC).
 */
export async function getTimeCardDetails(
  params: GetTimeCardDetailsParams = {},
): Promise<OracleTimeCardResponse> {
  const cfg = getMicrosEnvConfig();
  const locRef = params.locRef ?? cfg.locRef;

  const body: Record<string, string> = { locRef };

  // Oracle requires at least busDt or postedDt — always include busDt as
  // fallback so delta syncs using changedSinceUTC don't fail with HTTP 400.
  if (params.busDt) body.busDt = params.busDt;
  else if (!params.postedDt) body.busDt = new Date().toISOString().split("T")[0];
  if (params.postedDt) body.postedDt = params.postedDt;
  if (params.changedSinceUTC) body.changedSinceUTC = params.changedSinceUTC;

  // Use per-connection URL when provided — prevents Oracle 33109 org mismatch
  if (params.connectionContext) {
    return perConnectionPost<OracleTimeCardResponse>(
      params.connectionContext, "getTimeCardDetails", body,
    );
  }

  return MicrosApiClient.post<OracleTimeCardResponse>(
    "getTimeCardDetails",
    body,
  );
}

/**
 * POST /bi/v1/{orgIdentifier}/getJobCodeDimensions
 *
 * Retrieves the job code dimension table for a location.
 * Job codes map timecards to roles and labour categories.
 */
export async function getJobCodeDimensions(
  params: GetJobCodeDimensionsParams = {},
): Promise<OracleJobCodeResponse> {
  const cfg = getMicrosEnvConfig();
  const locRef = params.locRef ?? cfg.locRef;

  if (params.connectionContext) {
    return perConnectionPost<OracleJobCodeResponse>(
      params.connectionContext, "getJobCodeDimensions", { locRef },
    );
  }

  return MicrosApiClient.post<OracleJobCodeResponse>(
    "getJobCodeDimensions",
    { locRef },
  );
}

// ── Internal helper ───────────────────────────────────────────────────────

/**
 * Makes a direct POST to the Oracle BI API using per-connection URL/org
 * instead of the global env vars. Uses the same global id_token (since
 * Oracle 33109 confirms token is accepted; the mismatch is in the URL org).
 */
async function perConnectionPost<T>(
  cx: ConnectionContext,
  endpoint: string,
  body: Record<string, string>,
): Promise<T> {
  const idToken = await getMicrosIdToken();
  const base = cx.appServerUrl.replace(/\/$/, "");
  const url = `${base}/bi/v1/${cx.orgIdentifier}/${endpoint}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => "(unreadable)");
    if (!res.ok) {
      throw new Error(
        `[LabourClient] Oracle ${endpoint} HTTP ${res.status} ` +
        `org=${cx.orgIdentifier}: ${text.slice(0, 400)}`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `[LabourClient] Oracle ${endpoint} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}
