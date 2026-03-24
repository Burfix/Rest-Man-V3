/**
 * services/micros/labour/mock.ts
 *
 * Sample mock data for development when Oracle API is unavailable.
 * Returns realistic LabourDashboardSummary for UI development.
 */

import type { LabourDashboardSummary } from "@/types/labour";
import { todayISO } from "@/lib/utils";

export function getMockLabourSummary(
  businessDate?: string,
): LabourDashboardSummary {
  const date = businessDate ?? todayISO();

  return {
    businessDate: date,
    locRef: "2000002",
    totalLabourCost: 12_480.50,
    totalLabourHours: 142.75,
    overtimeCost: 1_860.00,
    overtimeHours: 12.5,
    regularCost: 9_820.50,
    regularHours: 122.25,
    premiumCost: 800.00,
    premiumHours: 8.0,
    activeStaffCount: 18,
    openTimecardCount: 3,
    labourPercentOfSales: 27.4,
    netSales: 45_550.00,
    byRole: [
      { jobCodeRef: "101", roleName: "Server",           hours: 48.0,  pay: 3_840.00,  staffCount: 6 },
      { jobCodeRef: "102", roleName: "Line Cook",        hours: 32.0,  pay: 3_200.00,  staffCount: 4 },
      { jobCodeRef: "103", roleName: "Bartender",        hours: 24.0,  pay: 2_160.00,  staffCount: 3 },
      { jobCodeRef: "104", roleName: "Host",             hours: 16.0,  pay: 1_120.00,  staffCount: 2 },
      { jobCodeRef: "105", roleName: "Sous Chef",        hours: 10.75, pay: 1_290.00,  staffCount: 1 },
      { jobCodeRef: "106", roleName: "Dishwasher",       hours: 12.0,  pay: 870.50,    staffCount: 2 },
    ],
    byCategory: [
      { categoryNum: "1", categoryName: "Front of House", hours: 88.0,  pay: 7_120.00, staffCount: 11 },
      { categoryNum: "2", categoryName: "Back of House",  hours: 54.75, pay: 5_360.50, staffCount: 7 },
    ],
    byRevenueCenter: [
      { rvcNum: "1", hours: 72.0,  pay: 5_760.00, staffCount: 9 },
      { rvcNum: "2", hours: 40.0,  pay: 3_600.00, staffCount: 5 },
      { rvcNum: "3", hours: 30.75, pay: 3_120.50, staffCount: 4 },
    ],
    lastSyncAt: new Date(Date.now() - 15 * 60_000).toISOString(),
    isStale: false,
    alerts: {
      labourAboveTarget: false,
      overtimeAboveThreshold: true,
      unmappedJobCodes: 1,
      openTimecardsOlderThanThreshold: 0,
    },
  };
}
