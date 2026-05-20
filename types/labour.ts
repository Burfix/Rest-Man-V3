/**
 * types/labour.ts — Labour cost module type definitions.
 *
 * Covers Oracle MICROS BI API raw response shapes, normalized internal
 * models, sync state, and dashboard summary types.
 */

// ── Oracle BI API raw response shapes ─────────────────────────────────────

export interface OracleTimeCardAdjustment {
  adjType?: string;
  adjAmt?: number;
  adjHrs?: number;
  [key: string]: unknown;
}

export interface OracleTimeCard {
  tcId: number;
  busDt: string;
  empNum: number;
  payrollID?: string;
  extPayrollID?: string;
  jobCodeRef?: number;
  jcNum?: number;
  rvcNum?: number;
  shftNum?: number;
  clkInLcl?: string;
  clkOutLcl?: string;
  clkInUTC?: string;
  clkOutUTC?: string;
  regHrs?: number;
  regPay?: number;
  ovt1Hrs?: number;
  ovt1Pay?: number;
  ovt2Hrs?: number;
  ovt2Pay?: number;
  ovt3Hrs?: number;
  ovt3Pay?: number;
  ovt4Hrs?: number;
  ovt4Pay?: number;
  premHrs?: number;
  premPay?: number;
  grossRcpts?: number;
  chrgRcpts?: number;
  chrgTips?: number;
  drctTips?: number;
  indirTips?: number;
  svcTips?: number;
  tipsPd?: number;
  lastUpdatedUTC?: string;
  addedUTC?: string;
  adjustments?: OracleTimeCardAdjustment[];
}

/** One business-date bucket inside the getTimeCardDetails response. */
export interface OracleBusinessDateBucket {
  busDt: string;
  timeCardDetails: OracleTimeCard[] | null;
}

/**
 * Actual response shape from POST getTimeCardDetails.
 * Oracle nests timecards inside businessDates[].timeCardDetails[].
 */
export interface OracleTimeCardResponse {
  curUTC: string;
  locRef: string;
  businessDates: OracleBusinessDateBucket[] | null;
}

export interface OracleJobCode {
  jobCodeRef?: number;
  num: number;
  name?: string;
  mstrNum?: number;
  mstrName?: string;
  /** Flat fields returned by Oracle (not nested despite what docs imply) */
  lbrCatNum?: number;
  lbrCatName?: string;
  lbrCatMstrNum?: number;
  lbrCatMstrName?: string;
  /** Some Oracle versions nest these under lbrCat — handle both */
  lbrCat?: {
    num?: number;
    name?: string;
    mstrNum?: number;
    mstrName?: string;
  };
}

export interface OracleJobCodeResponse {
  locRef: string;
  jobCodes: OracleJobCode[] | null;
}

// ── Normalized internal models ────────────────────────────────────────────

export interface NormalizedTimecard {
  tcId: string;
  businessDate: string;
  locRef: string;
  empNum: string;
  payrollID: string;
  extPayrollID: string;
  jobCodeRef: string;
  jcNum: string;
  rvcNum: string;
  shftNum: string;
  clkInLcl: string | null;
  clkOutLcl: string | null;
  clkInUTC: string | null;
  clkOutUTC: string | null;
  regHrs: number;
  regPay: number;
  ovt1Hrs: number;
  ovt1Pay: number;
  ovt2Hrs: number;
  ovt2Pay: number;
  ovt3Hrs: number;
  ovt3Pay: number;
  ovt4Hrs: number;
  ovt4Pay: number;
  premHrs: number;
  premPay: number;
  totalHours: number;
  totalPay: number;
  grossRcpts: number;
  chrgRcpts: number;
  chrgTips: number;
  drctTips: number;
  indirTips: number;
  svcTips: number;
  tipsPd: number;
  lastUpdatedUTC: string | null;
  addedUTC: string | null;
  hasAdjustments: boolean;
  adjustmentsJson: unknown | null;
}

export interface NormalizedJobCode {
  locRef: string;
  num: string;
  name: string;
  mstrNum: string;
  mstrName: string;
  lbrCatNum: string;
  lbrCatName: string;
  lbrCatMstrNum: string;
  lbrCatMstrName: string;
}

// ── Sync state ────────────────────────────────────────────────────────────

export interface LabourSyncState {
  locRef: string;
  lastCurUTC: string | null;
  lastBusDt: string | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
}

export type LabourSyncMode = "full" | "delta";

export interface LabourSyncResult {
  success: boolean;
  mode: LabourSyncMode;
  message: string;
  businessDate?: string;
  timecardsUpserted?: number;
  jobCodesSynced?: number;
  errors?: string[];
}

// ── Dashboard summary types ───────────────────────────────────────────────

export interface LabourRoleSummary {
  jobCodeRef: string;
  roleName: string;
  hours: number;
  pay: number;
  staffCount: number;
}

export interface LabourCategorySummary {
  categoryNum: string;
  categoryName: string;
  hours: number;
  pay: number;
  staffCount: number;
}

export interface LabourRvcSummary {
  rvcNum: string;
  hours: number;
  pay: number;
  staffCount: number;
}

export interface LabourDashboardSummary {
  businessDate: string;
  locRef: string;
  totalLabourCost: number;
  totalLabourHours: number;
  overtimeCost: number;
  overtimeHours: number;
  regularCost: number;
  regularHours: number;
  premiumCost: number;
  premiumHours: number;
  activeStaffCount: number;
  openTimecardCount: number;
  labourPercentOfSales: number | null;
  netSales: number | null;
  byRole: LabourRoleSummary[];
  byCategory: LabourCategorySummary[];
  byRevenueCenter: LabourRvcSummary[];
  lastSyncAt: string | null;
  isStale: boolean;
  /** Alert flags */
  alerts: {
    labourAboveTarget: boolean;
    overtimeAboveThreshold: boolean;
    unmappedJobCodes: number;
    openTimecardsOlderThanThreshold: number;
  };
}
