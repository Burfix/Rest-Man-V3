/**
 * services/micros/MicrosLabourService.ts
 *
 * Fetches and normalizes labour / timecard data from Oracle MICROS BI API.
 *
 * Each method:
 *  - Accepts locRef + date (YYYY-MM-DD)
 *  - Calls MicrosApiClient (authenticated, with retry)
 *  - Returns normalized internal types — UI never sees raw Oracle shapes
 *
 * Endpoint path is configurable:
 *   MICROS_PATH_LABOR  (default: /rms/v1/labor/timecardsByJob)
 */

import { MicrosApiClient }        from "./MicrosApiClient";
import { normalizeLaborRecord, type NormalizedLaborRecord } from "./normalize";
import type { _OracleLaborRecord } from "@/types/micros";

// ── Endpoint path ─────────────────────────────────────────────────────────

function laborPath(): string {
  return process.env.MICROS_PATH_LABOR ?? "/rms/v1/labor/timecardsByJob";
}

// ── Derived summary type ──────────────────────────────────────────────────

export interface DailyLabourSummary {
  /** Total labour cost across all job codes */
  totalLaborCost:   number;
  /** Total regular hours */
  regularHours:     number;
  /** Total overtime hours */
  overtimeHours:    number;
  /** Total hours (regular + overtime) */
  totalHours:       number;
  /** Total headcount (sum of employee_count per job) */
  employeeCount:    number;
  /** Labour cost as % of net sales (requires net_sales input) */
  laborPct:         number | null;
  /** Individual job-code records */
  jobs:             NormalizedLaborRecord[];
}

// ── Service class ─────────────────────────────────────────────────────────

export class MicrosLabourService {

  /**
   * Fetches timecard records grouped by job code for a given store + date.
   * Returns one normalized record per job code.
   *
   * Maps to internal schema: micros_labor_daily
   */
  async getLabourByJob(
    locRef: string,
    date:   string,
  ): Promise<NormalizedLaborRecord[]> {
    const res = await MicrosApiClient.get<{ timecards?: _OracleLaborRecord[] }>(
      laborPath(),
      { businessDate: date },
      locRef,
    );

    return (res.timecards ?? []).map(normalizeLaborRecord);
  }

  /**
   * Aggregates job-level timecard data into a daily summary.
   * Pass netSales to compute labour percentage; omit to leave it null.
   *
   * Maps to internal schema: rolled-up view of micros_labor_daily
   */
  async getDailyLabourSummary(
    locRef:     string,
    date:       string,
    netSales?:  number,
  ): Promise<DailyLabourSummary> {
    const jobs = await this.getLabourByJob(locRef, date);

    let totalLaborCost  = 0;
    let regularHours    = 0;
    let overtimeHours   = 0;
    let totalHours      = 0;
    let employeeCount   = 0;

    for (const job of jobs) {
      totalLaborCost += job.labor_cost;
      regularHours   += job.regular_hours;
      overtimeHours  += job.overtime_hours;
      totalHours     += job.total_hours;
      employeeCount  += job.employee_count;
    }

    const laborPct =
      netSales && netSales > 0
        ? +((totalLaborCost / netSales) * 100).toFixed(2)
        : null;

    return {
      totalLaborCost: +totalLaborCost.toFixed(2),
      regularHours:   +regularHours.toFixed(2),
      overtimeHours:  +overtimeHours.toFixed(2),
      totalHours:     +totalHours.toFixed(2),
      employeeCount,
      laborPct,
      jobs,
    };
  }
}
