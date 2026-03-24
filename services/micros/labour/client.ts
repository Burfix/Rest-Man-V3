/**
 * services/micros/labour/client.ts
 *
 * Oracle MICROS BI API client functions for labour endpoints.
 * Uses the existing authenticated MicrosApiClient (Bearer id_token).
 */

import { MicrosApiClient } from "@/lib/micros/client";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import type {
  OracleTimeCardResponse,
  OracleJobCodeResponse,
} from "@/types/labour";

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
}

export interface GetJobCodeDimensionsParams {
  /** Location reference (defaults to env MICROS_LOCATION_REF) */
  locRef?: string;
}

// ── API functions ─────────────────────────────────────────────────────────

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

  if (params.busDt) body.busDt = params.busDt;
  if (params.postedDt) body.postedDt = params.postedDt;
  if (params.changedSinceUTC) body.changedSinceUTC = params.changedSinceUTC;

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

  return MicrosApiClient.post<OracleJobCodeResponse>(
    "getJobCodeDimensions",
    { locRef },
  );
}
