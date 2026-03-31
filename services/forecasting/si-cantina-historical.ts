/**
 * Si Cantina Sociale — Historical Revenue Data
 * Monthly aggregates: Aug 2024 – Mar 2026 (20 months)
 *
 * Source: Actual trading data
 * Currency: ZAR (excl. VAT)
 * 20-month average: ~R734,000/month
 *
 * ANOMALY FLAGS:
 *   Sep 2024: R931K — 44% above Sep 2025 (likely special event / booking spike)
 *   Mar 2026: R453K — 21.6% below Mar 2025 (cause under investigation)
 *   Use confidence: 'low' when forecasting September or March.
 */

export type MonthlyRevenue = {
  /** ISO year-month key: "YYYY-MM" */
  month: string;
  /** Total revenue for the month (ZAR, excl. VAT) */
  total: number;
  /** Calendar days in the month — used to derive a daily average */
  daysInMonth: number;
  /** Set when this month's data contains anomalies that reduce forecast reliability */
  anomaly?: string;
};

export const SI_CANTINA_MONTHLY: MonthlyRevenue[] = [
  // ── Year 1: Aug 2024 – Jul 2025 ──────────────────────────────────────────
  { month: "2024-08", total: 514_951,   daysInMonth: 31 },
  {
    month: "2024-09", total: 931_436, daysInMonth: 30,
    anomaly: "Historical September data contains anomaly — forecast less reliable",
  },
  { month: "2024-10", total: 780_557,   daysInMonth: 31 },
  { month: "2024-11", total: 993_380,   daysInMonth: 30 },
  { month: "2024-12", total: 865_014,   daysInMonth: 31 },
  { month: "2025-01", total: 651_947,   daysInMonth: 31 },
  { month: "2025-02", total: 1_055_827, daysInMonth: 28 },
  { month: "2025-03", total: 578_451,   daysInMonth: 31 },
  { month: "2025-04", total: 574_110,   daysInMonth: 30 },
  { month: "2025-05", total: 552_163,   daysInMonth: 31 },
  { month: "2025-06", total: 578_945,   daysInMonth: 30 },
  { month: "2025-07", total: 626_424,   daysInMonth: 31 },

  // ── Year 2: Aug 2025 – Mar 2026 ──────────────────────────────────────────
  { month: "2025-08", total: 593_497,   daysInMonth: 31 },
  {
    month: "2025-09", total: 647_546, daysInMonth: 30,
    anomaly: "Historical September data contains anomaly — forecast less reliable",
  },
  { month: "2025-10", total: 706_547,   daysInMonth: 31 },
  { month: "2025-11", total: 851_794,   daysInMonth: 30 },
  { month: "2025-12", total: 1_169_866, daysInMonth: 31 },
  { month: "2026-01", total: 602_216,   daysInMonth: 31 },
  { month: "2026-02", total: 1_006_424, daysInMonth: 28 },
  {
    month: "2026-03", total: 453_734, daysInMonth: 31,
    anomaly: "March 2026 underperformed prior year significantly — treat with caution",
  },
];

/** O(1) lookup by "YYYY-MM" */
export const SI_CANTINA_BY_MONTH = new Map<string, MonthlyRevenue>(
  SI_CANTINA_MONTHLY.map((r) => [r.month, r]),
);

/**
 * Seasonality indices relative to the 20-month average of ~R734K.
 * Index > 1.0 = above-average month; index < 1.0 = below-average month.
 *
 * Key = calendar month number (1–12).
 * Do NOT apply a blanket YoY growth multiplier — use these month-specific indices only.
 */
export const SI_CANTINA_SEASONALITY: Record<number, number> = {
  1:  0.85,  // January
  2:  1.44,  // February  ← peak (R1M+ both years)
  3:  0.70,  // March     ← seasonal trough
  4:  0.78,  // April
  5:  0.75,  // May
  6:  0.79,  // June
  7:  0.85,  // July
  8:  0.77,  // August
  9:  0.94,  // September (anomaly in 2024 — use with caution)
  10: 0.95,  // October
  11: 1.17,  // November
  12: 1.12,  // December
};

/** 20-month baseline mean (ZAR/month) — reference for seasonality calculations */
export const SI_CANTINA_ANNUAL_MEAN = 734_000;
