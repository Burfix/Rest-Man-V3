/**
 * Toast POS Daily Operations CSV Parser
 *
 * Handles the section-based layout exported by Toast. Sections are delimited
 * by lines beginning with "Run … Report" or "Run … Topic Report". The first
 * 6 lines are top-level scalar metrics. Revenue-center rows are identified by
 * their specific column header; labor rows follow "Run Labor Topic Report".
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedTopMetrics {
  salesNetVat: number | null;
  marginPercent: number | null;
  cogsPercent: number | null;
  laborCostPercent: number | null;
  guestCount: number | null;
  checkCount: number | null;
}

export interface ParsedFinancialControl {
  grossSalesBeforeDiscounts: number | null;
  totalDiscounts: number | null;
  grossSalesAfterDiscounts: number | null;
  taxCollected: number | null;
  serviceCharges: number | null;
  nonRevenueTotal: number | null;
  costOfGoodsSold: number | null;
  laborCost: number | null;
  operatingMargin: number | null;
  cashIn: number | null;
  paidIn: number | null;
  paidOut: number | null;
  cashDue: number | null;
  deposits: number | null;
  overShort: number | null;
}

export interface ParsedChecksTopic {
  returnsCount: number | null;
  returnsAmount: number | null;
  voidsCount: number | null;
  voidsAmount: number | null;
  managerVoidsCount: number | null;
  managerVoidsAmount: number | null;
  errorCorrectsCount: number | null;
  errorCorrectsAmount: number | null;
  cancelsCount: number | null;
  cancelsAmount: number | null;
}

export interface ParsedServicePerformance {
  guestsAverageSpend: number | null;
  checksAverageSpend: number | null;
  tableturnsCount: number | null;
  tableturnsAverageSpend: number | null;
  averageDiningTimeHours: number | null;
}

export interface ParsedTips {
  directChargedTips: number | null;
  directCashTips: number | null;
  indirectTips: number | null;
  totalTips: number | null;
  tipsPaid: number | null;
}

export interface ParsedLaborRow {
  jobCodeName: string;
  regularHours: number | null;
  overtimeHours: number | null;
  totalHours: number | null;
  regularPay: number | null;
  overtimePay: number | null;
  totalPay: number | null;
  laborCostPercent: number | null;
}

export interface ParsedRevenueCenterRow {
  revenueCenterName: string;
  salesNetVat: number | null;
  percentOfTotalSales: number | null;
  guests: number | null;
  percentOfTotalGuests: number | null;
  averageSpendPerGuest: number | null;
  checks: number | null;
  percentOfTotalChecks: number | null;
  averageSpendPerCheck: number | null;
  tableTurns: number | null;
  percentOfTotalTableTurns: number | null;
  averageSpendPerTableTurn: number | null;
  averageTurnTime: number | null;
}

export interface ParsedDailyOps {
  topMetrics: ParsedTopMetrics;
  financialControl: ParsedFinancialControl;
  checksTopic: ParsedChecksTopic;
  servicePerformance: ParsedServicePerformance;
  tips: ParsedTips;
  laborRows: ParsedLaborRow[];
  revenueCenterRows: ParsedRevenueCenterRow[];
  parseWarnings: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a CSV row respecting quoted fields. Returns an array of raw string values. */
function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let inQuote = false;
  let current = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        // escaped double-quote inside quoted field
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/** Strip whitespace and normalise to lowercase for reliable key matching. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Parse a numeric string; returns null (not NaN) on failure. */
function safeNum(val: string | undefined | null): number | null {
  if (val == null) return null;
  const s = val.trim().replace(/,/g, "");
  if (s === "" || s === "-" || s === "N/A") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Check whether a cell value looks like a section-marker header. */
function isSectionMarker(cell: string): boolean {
  const lc = norm(cell);
  return (
    lc.startsWith("run ") &&
    (lc.endsWith(" report") || lc.includes(" report"))
  );
}

// Label strings emitted by Toast for each section
const SECTION = {
  FINANCIAL: "run financial control report",
  CHECKS: "run checks topic report",
  SERVICE: "run service performance report",
  TIPS: "run tips topic report",
  LABOR: "run labor topic report",
} as const;

// Revenue-center section is identified by its column header, not a "Run" line
const REV_CENTER_HEADER_COL = "revenue center name";

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseDailyOperationsCsv(rawCsv: string): ParsedDailyOps {
  const warnings: string[] = [];

  // Normalise line endings and split
  const lines = rawCsv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Parse every line into cells immediately
  const rows: string[][] = lines.map(parseCsvRow);

  // ── State machine ────────────────────────────────────────────────────────────
  type Section =
    | "TOP_METRICS"
    | "FINANCIAL"
    | "CHECKS"
    | "SERVICE"
    | "TIPS"
    | "REVENUE_CENTER"
    | "LABOR"
    | "OTHER";

  let section: Section = "TOP_METRICS";

  // Accumulators — financial control keyed by normalised label
  const financialMap = new Map<string, number | null>();
  const checksMap = new Map<string, number | null>();
  const serviceMap = new Map<string, number | null>();
  const tipsMap = new Map<string, number | null>();

  let topMetricsLinesSeen = 0;
  const topMetricsMap = new Map<string, number | null>();

  const laborRows: ParsedLaborRow[] = [];
  const revenueCenterRows: ParsedRevenueCenterRow[] = [];

  let revCenterHeaderSeen = false;
  let laborHeaderSeen = false;

  for (const row of rows) {
    // Skip completely blank rows
    if (row.every((c) => c.trim() === "")) continue;

    const col0 = row[0]?.trim() ?? "";

    // — Detect section transitions ——————————————————————————————————————————
    if (isSectionMarker(col0)) {
      const lc = norm(col0);
      if (lc === SECTION.FINANCIAL) { section = "FINANCIAL"; continue; }
      if (lc === SECTION.CHECKS)    { section = "CHECKS";    continue; }
      if (lc === SECTION.SERVICE)   { section = "SERVICE";   continue; }
      if (lc === SECTION.TIPS)      { section = "TIPS";      continue; }
      if (lc === SECTION.LABOR)     { section = "LABOR";     continue; }
      section = "OTHER";
      continue;
    }

    // — Detect Revenue-center header row ——————————————————————————————————
    if (norm(col0) === REV_CENTER_HEADER_COL) {
      section = "REVENUE_CENTER";
      revCenterHeaderSeen = true;
      continue; // skip the header row itself
    }

    // — Skip repeated "Name","Amount" / "Name","Count","Amount" header rows ——
    if (norm(col0) === "name" && section !== "LABOR") continue;

    // — Skip "Job Codes" line in labor section ——————————————————————————————
    if (norm(col0) === "job codes") continue;

    // — Detect labor column header ——————————————————————————————————————————
    if (section === "LABOR" && !laborHeaderSeen && norm(col0) === "name") {
      laborHeaderSeen = true;
      continue;
    }

    // ── Process by section ────────────────────────────────────────────────────
    switch (section) {
      case "TOP_METRICS": {
        // Lines 1-6 are "Key",value pairs
        if (topMetricsLinesSeen < 6) {
          topMetricsMap.set(norm(col0), safeNum(row[1]));
          topMetricsLinesSeen++;
        }
        break;
      }

      case "FINANCIAL": {
        // "Name","Amount" rows — store all; pull specifics later
        const label = norm(col0);
        if (label) financialMap.set(label, safeNum(row[1]));
        break;
      }

      case "CHECKS": {
        const label = norm(col0);
        if (label) {
          // Rows may have Count + Amount (cols 1 + 2)
          const count = safeNum(row[1]);
          const amount = safeNum(row[2]);
          // Store "<label>_count" and "<label>_amount" when both present
          if (row.length >= 3 && row[2]?.trim()) {
            checksMap.set(`${label}_count`, count);
            checksMap.set(`${label}_amount`, amount);
          } else {
            checksMap.set(label, count);
          }
        }
        break;
      }

      case "SERVICE": {
        const label = norm(col0);
        if (label) serviceMap.set(label, safeNum(row[1]));
        break;
      }

      case "TIPS": {
        const label = norm(col0);
        if (label) tipsMap.set(label, safeNum(row[1]));
        break;
      }

      case "REVENUE_CENTER": {
        if (!revCenterHeaderSeen) break;
        const name = col0.trim();
        if (!name || norm(name) === "total") break; // skip totals row
        revenueCenterRows.push({
          revenueCenterName: name,
          salesNetVat: safeNum(row[1]),
          percentOfTotalSales: safeNum(row[2]),
          guests: safeNum(row[3]),
          percentOfTotalGuests: safeNum(row[4]),
          averageSpendPerGuest: safeNum(row[5]),
          checks: safeNum(row[6]),
          percentOfTotalChecks: safeNum(row[7]),
          averageSpendPerCheck: safeNum(row[8]),
          tableTurns: safeNum(row[9]),
          percentOfTotalTableTurns: safeNum(row[10]),
          averageSpendPerTableTurn: safeNum(row[11]),
          averageTurnTime: safeNum(row[12]),
        });
        break;
      }

      case "LABOR": {
        const name = col0.trim();
        if (!name || norm(name) === "total") break;
        laborRows.push({
          jobCodeName: name,
          regularHours: safeNum(row[1]),
          overtimeHours: safeNum(row[2]),
          totalHours: safeNum(row[3]),
          regularPay: safeNum(row[4]),
          overtimePay: safeNum(row[5]),
          totalPay: safeNum(row[6]),
          laborCostPercent: safeNum(row[7]),
        });
        break;
      }

      default:
        break;
    }
  }

  // ── Assemble top metrics ──────────────────────────────────────────────────
  const topMetrics: ParsedTopMetrics = {
    salesNetVat:       topMetricsMap.get("sales net vat") ?? null,
    marginPercent:     topMetricsMap.get("margin percent") ?? null,
    cogsPercent:       topMetricsMap.get("cost of goods sold %") ?? null,
    laborCostPercent:  topMetricsMap.get("labor cost %") ?? null,
    guestCount:        topMetricsMap.get("guest count") ?? null,
    checkCount:        topMetricsMap.get("check count") ?? null,
  };

  if (topMetrics.salesNetVat == null) {
    warnings.push("Could not parse top-level Sales Net VAT — check CSV format.");
  }

  // ── Assemble financial control ────────────────────────────────────────────
  const financialControl: ParsedFinancialControl = {
    grossSalesBeforeDiscounts: financialMap.get("gross sales before discounts") ?? null,
    totalDiscounts:            financialMap.get("total discounts") ?? null,
    grossSalesAfterDiscounts:  financialMap.get("gross sales after discounts") ?? null,
    taxCollected:              financialMap.get("tax collected") ?? null,
    serviceCharges:            financialMap.get("service charges") ?? null,
    nonRevenueTotal:           financialMap.get("non-revenue total") ?? financialMap.get("non revenue total") ?? null,
    costOfGoodsSold:           financialMap.get("cost of goods sold") ?? null,
    laborCost:                 financialMap.get("labor cost") ?? null,
    operatingMargin:           financialMap.get("operating margin") ?? null,
    cashIn:                    financialMap.get("cash in") ?? null,
    paidIn:                    financialMap.get("paid in") ?? null,
    paidOut:                   financialMap.get("paid out") ?? null,
    cashDue:                   financialMap.get("cash due") ?? null,
    deposits:                  financialMap.get("deposits") ?? null,
    overShort:                 financialMap.get("over/short") ?? financialMap.get("over short") ?? null,
  };

  // ── Assemble checks topic ─────────────────────────────────────────────────
  const checksTopic: ParsedChecksTopic = {
    returnsCount:        checksMap.get("returns_count") ?? checksMap.get("returns") ?? null,
    returnsAmount:       checksMap.get("returns_amount") ?? null,
    voidsCount:          checksMap.get("voids_count") ?? checksMap.get("voids") ?? null,
    voidsAmount:         checksMap.get("voids_amount") ?? null,
    managerVoidsCount:   checksMap.get("manager voids_count") ?? checksMap.get("manager voids") ?? null,
    managerVoidsAmount:  checksMap.get("manager voids_amount") ?? null,
    errorCorrectsCount:  checksMap.get("error corrects_count") ?? checksMap.get("error corrects") ?? null,
    errorCorrectsAmount: checksMap.get("error corrects_amount") ?? null,
    cancelsCount:        checksMap.get("cancels_count") ?? checksMap.get("cancels") ?? null,
    cancelsAmount:       checksMap.get("cancels_amount") ?? null,
  };

  // ── Assemble service performance ──────────────────────────────────────────
  const servicePerformance: ParsedServicePerformance = {
    guestsAverageSpend:      serviceMap.get("guests average spend") ?? serviceMap.get("average spend per guest") ?? null,
    checksAverageSpend:      serviceMap.get("checks average spend") ?? serviceMap.get("average spend per check") ?? null,
    tableturnsCount:         serviceMap.get("table turns") ?? serviceMap.get("table turns count") ?? null,
    tableturnsAverageSpend:  serviceMap.get("table turns average spend") ?? serviceMap.get("average spend per table turn") ?? null,
    averageDiningTimeHours:  serviceMap.get("average dining time") ?? serviceMap.get("average dining time (hours)") ?? null,
  };

  // ── Assemble tips ─────────────────────────────────────────────────────────
  const tips: ParsedTips = {
    directChargedTips: tipsMap.get("direct charged tips") ?? tipsMap.get("charged tips") ?? null,
    directCashTips:    tipsMap.get("direct cash tips") ?? tipsMap.get("cash tips") ?? null,
    indirectTips:      tipsMap.get("indirect tips") ?? null,
    totalTips:         tipsMap.get("total tips") ?? null,
    tipsPaid:          tipsMap.get("tips paid") ?? null,
  };

  return {
    topMetrics,
    financialControl,
    checksTopic,
    servicePerformance,
    tips,
    laborRows,
    revenueCenterRows,
    parseWarnings: warnings,
  };
}
