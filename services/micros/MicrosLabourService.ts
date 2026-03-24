/**
 * services/micros/MicrosLabourService.ts
 *
 * Public API surface for labour data. Delegates to the labour/ sub-module.
 */

import { buildDailySummary, getStoredDailySummary } from "./labour/summary";
import { runLabourFullSync, runLabourDeltaSync } from "./labour/sync";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { todayISO } from "@/lib/utils";
import type { LabourDashboardSummary, LabourSyncResult } from "@/types/labour";

export interface DailyLabourSummary {
  date:            string;
  totalHours:      number;
  regularHours:    number;
  overtimeHours:   number;
  employeeCount:   number;
}

export class MicrosLabourService {
  async getDailySummary(date?: string): Promise<DailyLabourSummary | null> {
    const cfg = getMicrosEnvConfig();
    if (!cfg.locRef) return null;
    const summary = await getStoredDailySummary(cfg.locRef, date);
    if (!summary) return null;
    return {
      date: summary.businessDate,
      totalHours: summary.totalLabourHours,
      regularHours: summary.regularHours,
      overtimeHours: summary.overtimeHours,
      employeeCount: summary.activeStaffCount,
    };
  }

  async getFullSummary(date?: string): Promise<LabourDashboardSummary | null> {
    const cfg = getMicrosEnvConfig();
    if (!cfg.locRef) return null;
    return getStoredDailySummary(cfg.locRef, date) ?? buildDailySummary(cfg.locRef, date);
  }

  async syncFull(date?: string): Promise<LabourSyncResult> {
    return runLabourFullSync(date ?? todayISO());
  }

  async syncDelta(): Promise<LabourSyncResult> {
    return runLabourDeltaSync();
  }
}
