/**
 * services/micros/labour/normalize.ts
 *
 * Transforms raw Oracle BIAPI timecard and job code responses
 * into the normalized shapes stored in Supabase.
 */

import type {
  OracleTimeCard,
  OracleJobCode,
  NormalizedTimecard,
  NormalizedJobCode,
} from "@/types/labour";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Safe number coercion — treat null/undefined as 0 */
function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Normalize any ID value to a stable string */
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ── Timecard normalization ────────────────────────────────────────────────

export function normalizeTimecard(
  raw: OracleTimeCard,
  locRef: string,
): NormalizedTimecard {
  const regHrs   = round4(n(raw.regHrs));
  const ovt1Hrs  = round4(n(raw.ovt1Hrs));
  const ovt2Hrs  = round4(n(raw.ovt2Hrs));
  const ovt3Hrs  = round4(n(raw.ovt3Hrs));
  const ovt4Hrs  = round4(n(raw.ovt4Hrs));
  const premHrs  = round4(n(raw.premHrs));

  const regPay   = round2(n(raw.regPay));
  const ovt1Pay  = round2(n(raw.ovt1Pay));
  const ovt2Pay  = round2(n(raw.ovt2Pay));
  const ovt3Pay  = round2(n(raw.ovt3Pay));
  const ovt4Pay  = round2(n(raw.ovt4Pay));
  const premPay  = round2(n(raw.premPay));

  const totalHours = round4(regHrs + ovt1Hrs + ovt2Hrs + ovt3Hrs + ovt4Hrs + premHrs);
  const totalPay   = round2(regPay + ovt1Pay + ovt2Pay + ovt3Pay + ovt4Pay + premPay);

  const hasAdj = Array.isArray(raw.adjustments) && raw.adjustments.length > 0;

  return {
    tcId:            str(raw.tcId),
    businessDate:    raw.busDt ?? "",
    locRef,
    empNum:          str(raw.empNum),
    payrollID:       str(raw.payrollID),
    extPayrollID:    str(raw.extPayrollID),
    jobCodeRef:      str(raw.jobCodeRef),
    jcNum:           str(raw.jcNum),
    rvcNum:          str(raw.rvcNum),
    shftNum:         str(raw.shftNum),
    clkInLcl:        raw.clkInLcl ?? null,
    clkOutLcl:       raw.clkOutLcl ?? null,
    clkInUTC:        raw.clkInUTC ?? null,
    clkOutUTC:       raw.clkOutUTC ?? null,
    regHrs,  regPay,
    ovt1Hrs, ovt1Pay,
    ovt2Hrs, ovt2Pay,
    ovt3Hrs, ovt3Pay,
    ovt4Hrs, ovt4Pay,
    premHrs, premPay,
    totalHours,
    totalPay,
    grossRcpts:      round2(n(raw.grossRcpts)),
    chrgRcpts:       round2(n(raw.chrgRcpts)),
    chrgTips:        round2(n(raw.chrgTips)),
    drctTips:        round2(n(raw.drctTips)),
    indirTips:       round2(n(raw.indirTips)),
    svcTips:         round2(n(raw.svcTips)),
    tipsPd:          round2(n(raw.tipsPd)),
    lastUpdatedUTC:  raw.lastUpdatedUTC ?? null,
    addedUTC:        raw.addedUTC ?? null,
    hasAdjustments:  hasAdj,
    adjustmentsJson: hasAdj ? raw.adjustments : null,
  };
}

export function normalizeTimecards(
  rawCards: OracleTimeCard[] | null,
  locRef: string,
): NormalizedTimecard[] {
  if (!rawCards || rawCards.length === 0) return [];
  return rawCards.map((tc) => normalizeTimecard(tc, locRef));
}

// ── Job code normalization ────────────────────────────────────────────────

export function normalizeJobCode(
  raw: OracleJobCode,
  locRef: string,
): NormalizedJobCode {
  return {
    locRef,
    num:            str(raw.num),
    name:           raw.name ?? "",
    mstrNum:        str(raw.mstrNum),
    mstrName:       raw.mstrName ?? "",
    lbrCatNum:      str(raw.lbrCatNum ?? raw.lbrCat?.num),
    lbrCatName:     raw.lbrCatName ?? raw.lbrCat?.name ?? "",
    lbrCatMstrNum:  str(raw.lbrCatMstrNum ?? raw.lbrCat?.mstrNum),
    lbrCatMstrName: raw.lbrCatMstrName ?? raw.lbrCat?.mstrName ?? "",
  };
}

export function normalizeJobCodes(
  rawCodes: OracleJobCode[] | null,
  locRef: string,
): NormalizedJobCode[] {
  if (!rawCodes || rawCodes.length === 0) return [];
  return rawCodes.map((jc) => normalizeJobCode(jc, locRef));
}
