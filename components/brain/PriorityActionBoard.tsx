/**
 * PriorityActionBoard — Layer 2 of the Command Center.
 *
 * 2-column layout:
 *   LEFT (65%) — Numbered action cards (with inline duty task drilldown)
 *   RIGHT (35%) — Brain recommendation + Score bars + Grade path + Recovery + Forecast + GM
 *
 * Server Component (ActionTakenButton is the only client leaf).
 */

import { cn } from "@/lib/utils";
import type { BrainOutput, BrainThreatSeverity, ScoreDriver } from "@/services/brain/operating-brain";
import ActionTakenButton from "./ActionTakenButton";

// ── Exported types (consumed by dashboard/page.tsx) ────────────────────────────

export type DutyTask = {
  id: string;
  action_name: string;
  status: string;           // not_started | in_progress | completed | escalated | blocked
  assigned_to_name: string | null;
  due_time: string | null;  // e.g. "17:45"
};

export type DutiesData = {
  tasks: DutyTask[];         // ALL tasks today (component filters to incomplete)
  totalCount: number;
  completedCount: number;
};

type Props = {
  brain: BrainOutput;
  siteId: string;
  dutiesData?: DutiesData;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const MODULE_MAX: Record<string, number> = {
  REVENUE:     30,
  LABOUR:      20,
  DUTIES:      20,
  MAINTENANCE: 15,
  COMPLIANCE:  15,
};

const GRADE_THRESHOLDS: Record<string, number> = { D: 50, C: 65, B: 80, A: 90 };

// ── Colour helpers ─────────────────────────────────────────────────────────────

const SEV_BORDER: Record<string, string> = {
  critical: "border-l-red-600",
  high:     "border-l-amber-500",
  medium:   "border-l-yellow-500",
  low:      "border-l-stone-400 dark:border-l-stone-600",
};

const SEV_BADGE: Record<string, string> = {
  critical: "bg-[#fef2f2] text-[#991b1b] border-[#fca5a5] dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50",
  high:     "bg-[#fffbeb] text-[#92400e] border-[#fcd34d] dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50",
  medium:   "bg-[#fefce8] text-[#713f12] border-[#fde047] dark:bg-yellow-950/20 dark:text-yellow-400 dark:border-yellow-900/50",
  low:      "bg-[#f9fafb] text-[#6b7280] border-[#d1d5db] dark:bg-stone-900/20 dark:text-stone-500 dark:border-stone-700",
};

const TREND_ARROW: Record<string, string> = {
  improving: "↑",
  stable:    "→",
  declining: "↓",
};

const TREND_COLOR: Record<string, string> = {
  improving: "text-emerald-600 dark:text-emerald-400",
  stable:    "text-stone-500",
  declining: "text-red-600 dark:text-red-400",
};

const GRADE_COLOR: Record<string, string> = {
  A:   "text-emerald-600 dark:text-emerald-400",
  B:   "text-emerald-700 dark:text-emerald-500",
  C:   "text-amber-600 dark:text-amber-400",
  D:   "text-amber-700 dark:text-amber-500",
  F:   "text-red-600 dark:text-red-400",
  "?": "text-stone-600",
};

/** Task status display config */
const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "NOT STARTED",
  in_progress: "STARTED",
  escalated:   "ESCALATED",
  blocked:     "BLOCKED",
};
const TASK_STATUS_COLOR: Record<string, string> = {
  not_started: "text-stone-400 dark:text-stone-600",
  in_progress: "text-amber-600 dark:text-amber-400",
  escalated:   "text-red-600 dark:text-red-400",
  blocked:     "text-red-600 dark:text-red-400",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtZAR(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

function fmtPct(n: number, showPlus = false): string {
  const sign = n >= 0 && showPlus ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtMins(mins: number): string {
  if (mins <= 0) return "Closing";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Returns true when the action title relates to duties/checklists. */
function isDutiesCard(title: string): boolean {
  const t = title.toLowerCase();
  return t.includes("dut") || t.includes("checklist") || t.includes("daily check");
}

/** Compute SAST-relative deadline countdown. */
function deadlineCountdown(
  deadline: string | null,
  minutesToClose: number,
  minutesToMidnight: number,
): { label: string; isUrgent: boolean } | null {
  if (!deadline) return null;
  const dl = deadline.toLowerCase();
  if (dl === "immediate") return { label: "Act now", isUrgent: true };
  if (dl.includes("session end") || dl.includes("this session") || dl.includes("this service") || dl.includes("until session")) {
    if (minutesToClose <= 0) return null;
    return { label: `${fmtMins(minutesToClose)} left`, isUrgent: minutesToClose < 120 };
  }
  if (dl.includes("today")) {
    if (minutesToMidnight <= 0) return null;
    return { label: `${fmtMins(minutesToMidnight)} left`, isUrgent: minutesToMidnight < 240 };
  }
  return null;
}

/** Derive severity for action cards beyond #1. */
function deriveSeverity(
  idx: number,
  primarySeverity: BrainThreatSeverity,
  moneyAtRisk: number | null,
): BrainThreatSeverity {
  if (idx === 0) return primarySeverity;
  if (moneyAtRisk && moneyAtRisk > 10_000) return "high";
  if (moneyAtRisk && moneyAtRisk > 0)      return "medium";
  return "medium";
}

/**
 * Generate a specific, operational action title from a score driver.
 * Always: WHAT + HOW MANY + BY WHEN. No abstract words.
 */
function makeOperationalTitle(
  driver: ScoreDriver,
  brain: BrainOutput,
  saHour: number,
  dutiesIncomplete?: number,
): string {
  const nextSession = saHour < 17 ? "dinner service" : "close";
  const nextSessionTime = saHour < 17 ? "17:00" : "22:00";

  switch (driver.module) {
    case "DUTIES": {
      if (dutiesIncomplete !== undefined && dutiesIncomplete > 0) {
        return `${dutiesIncomplete} ${dutiesIncomplete === 1 ? "duty" : "duties"} incomplete before ${nextSession}`;
      }
      const completionPct = Math.round((driver.pts / MODULE_MAX.DUTIES) * 100);
      const remaining = 100 - completionPct;
      if (completionPct === 0) return `Daily checklist not started — service risk before ${nextSessionTime}`;
      if (completionPct < 30)  return `FOH checklist ${completionPct}% complete — critical tasks outstanding before ${nextSessionTime}`;
      return `${remaining}% of duties incomplete before ${nextSession} (${completionPct}/100 done)`;
    }

    case "COMPLIANCE": {
      const match = driver.reason.match(/(\d+) overdue/i);
      const count = match ? parseInt(match[1], 10) : 1;
      return `${count} compliance cert${count > 1 ? "s" : ""} expired — legal exposure active`;
    }

    case "MAINTENANCE": {
      if (driver.reason.includes("Service block")) {
        return `Equipment failure blocking ${nextSession} — escalate now`;
      }
      const match = driver.reason.match(/(\d+) urgent/i);
      const count = match ? parseInt(match[1], 10) : 1;
      return `${count} urgent maintenance issue${count > 1 ? "s" : ""} unresolved — ${nextSession} risk`;
    }

    case "LABOUR": {
      const match = driver.reason.match(/([\d.]+)% over/i);
      const overPct = match ? match[1] : "?";
      const gap = brain.recoveryMeter?.revenueGap
        ? ` — ${fmtZAR(Math.round(brain.recoveryMeter.revenueGap * 0.05))} overspend by close`
        : " — reduce now before shift locks in";
      return `Labour ${overPct}% over target${gap}`;
    }

    case "REVENUE": {
      const match = driver.reason.match(/([\d.]+)% below/i);
      const varPct = match ? match[1] : "?";
      if (brain.recoveryMeter && brain.recoveryMeter.revenueGap > 0) {
        return `${fmtZAR(brain.recoveryMeter.revenueGap)} revenue gap — ${varPct}% below target during ${nextSession}`;
      }
      return `Revenue ${varPct}% behind target — active floor effort needed`;
    }

    default:
      return driver.reason;
  }
}

/**
 * Generate operational consequence language — guest/financial/legal impact only.
 * Never mentions points or scoring.
 */
function makeOperationalConsequence(
  driver: ScoreDriver,
  brain: BrainOutput,
  saHour: number,
): string {
  const closeTime = "22:00";
  const hoursLeft  = Math.max(0, 22 - saHour);

  switch (driver.module) {
    case "DUTIES":
      return `Incomplete duties increase ${saHour < 17 ? "dinner" : "service"} unreadiness risk. FOH handover gaps create guest experience failures and team confusion under pressure.`;

    case "COMPLIANCE":
      return `Operating with expired certificates. Legal exposure is active. Insurance may be invalidated. Closure risk if inspected — escalate to head office immediately.`;

    case "MAINTENANCE": {
      if (driver.reason.includes("Service block")) {
        return `Equipment failure during service means lost covers and guest complaints. Every hour unresolved compounds revenue loss and team pressure.`;
      }
      return `Unresolved maintenance during service creates food safety risk and guest-facing failures. Urgent issues escalate into closures if not contained.`;
    }

    case "LABOUR":
      return `Excess labour on shift with ${hoursLeft}h remaining. No recovery path after shift ends — adjust roster now or absorb the confirmed overspend on P&L.`;

    case "REVENUE": {
      if (brain.recoveryMeter && brain.recoveryMeter.revenueGap > 0) {
        const coversNeeded = brain.forecastSummary.projectedClose > 0
          ? Math.ceil(brain.recoveryMeter.revenueGap / Math.max(1, brain.forecastSummary.projectedClose / Math.max(1, 60)))
          : null;
        const coverStr = coversNeeded ? ` Approximately ${coversNeeded} covers at current average needed.` : "";
        return `${fmtZAR(brain.recoveryMeter.revenueGap)} needed to close the gap.${coverStr} Walk-in window closes at ${closeTime}. Act before service thins.`;
      }
      return `Revenue is behind pace. Walk-in window closes at ${closeTime}. Push floor conversion and upsell on current tables before service thins.`;
    }

    default:
      return driver.reason;
  }
}

/**
 * Build the Brain Recommendation line combining top 2 actions into one instruction.
 */
function buildBrainRecommendation(brain: BrainOutput): string | null {
  const top = brain.actionQueue.slice(0, 2);
  if (top.length === 0) return null;

  const gradeOrder: Array<keyof typeof GRADE_THRESHOLDS> = ["D", "C", "B", "A"];
  const nextGrade = gradeOrder.find((g) => brain.systemHealth.score < GRADE_THRESHOLDS[g]);

  const action1 = top[0].title.toLowerCase().replace(/^(critical|high|medium|low):\s*/i, "");
  const action2 = top[1]?.title.toLowerCase().replace(/^(critical|high|medium|low):\s*/i, "");

  if (top.length >= 2 && nextGrade) {
    return `${action1.charAt(0).toUpperCase() + action1.slice(1)} and ${action2} — moves Grade ${brain.systemHealth.grade} → ${nextGrade}.`;
  }
  if (nextGrade) {
    return `${action1.charAt(0).toUpperCase() + action1.slice(1)} — key step towards Grade ${nextGrade}.`;
  }
  return `${action1.charAt(0).toUpperCase() + action1.slice(1)} — highest priority action now.`;
}

/** Build grade-path steps for the right column. */
function gradeMotivator(
  score: number,
  allScoreDrivers: BrainOutput["systemHealth"]["allScoreDrivers"],
  dutiesIncompleteCount?: number,
): Array<{ label: string; pts: number; nextGrade: string }> {
  const gradeOrder: Array<keyof typeof GRADE_THRESHOLDS> = ["D", "C", "B", "A"];
  const nextGrade = gradeOrder.find((g) => score < GRADE_THRESHOLDS[g]);
  if (!nextGrade) return [];

  const results: Array<{ label: string; pts: number; nextGrade: string }> = [];
  const downDrivers = allScoreDrivers.filter((d) => d.direction === "down");

  downDrivers.slice(0, 2).forEach((driver) => {
    const max = MODULE_MAX[driver.module] ?? 20;
    const potential = max - driver.pts;
    if (potential > 0) {
      let label: string;
      if (driver.module === "DUTIES") {
        const n = dutiesIncompleteCount;
        const timeEst = n ? `~${n * 8} min` : "~30 min";
        label = n !== undefined && n > 0
          ? `Complete ${n} remaining ${n === 1 ? "duty" : "duties"} (+${potential} pts) ${timeEst}`
          : `Complete duties (+${potential} pts) ${timeEst}`;
      } else if (driver.module === "COMPLIANCE") {
        label = `Renew compliance item (+${potential} pts) ~20 min`;
      } else if (driver.module === "MAINTENANCE") {
        label = `Clear urgent maintenance (+${potential} pts)`;
      } else if (driver.module === "LABOUR") {
        label = `Trim labour excess (+${potential} pts)`;
      } else {
        label = `Fix ${driver.module.toLowerCase()} (+${potential} pts)`;
      }
      results.push({ label, pts: potential, nextGrade: String(nextGrade) });
    }
  });

  if (results.length === 0) {
    results.push({ label: `${GRADE_THRESHOLDS[nextGrade] - score} pts needed`, pts: GRADE_THRESHOLDS[nextGrade] - score, nextGrade: String(nextGrade) });
  }
  return results;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PriorityActionBoard({ brain, siteId, dutiesData }: Props) {
  const {
    primaryThreat,
    actionQueue,
    doNothingConsequences,
    systemHealth,
    forecastSummary,
    gmSituation,
    recoveryMeter,
  } = brain;

  // ── SAST time → countdown helpers ─────────────────────────────────────────
  const saTimeStr = new Date().toLocaleString("en-US", {
    timeZone: "Africa/Johannesburg",
    hour:     "numeric",
    minute:   "2-digit",
    hour12:   false,
  });
  const [saHStr, saMinStr] = saTimeStr.split(":");
  const saHour   = parseInt(saHStr ?? "12", 10);
  const saMinute = parseInt(saMinStr ?? "0", 10);
  const totalMins = saHour * 60 + saMinute;
  const minutesToClose    = Math.max(0, 22 * 60 - totalMins);
  const minutesToMidnight = Math.max(0, 24 * 60 - totalMins);

  // ── Duties drilldown data ──────────────────────────────────────────────────
  const incompleteTasks = dutiesData
    ? dutiesData.tasks.filter((t) => t.status !== "completed")
    : [];
  const dutiesIncompleteCount = dutiesData ? incompleteTasks.length : undefined;

  // ── Action list ─────────────────────────────────────────────────────────────
  const score = systemHealth.score;
  const hasRealActions = actionQueue.length > 0;

  const displayActions = hasRealActions
    ? actionQueue
    : score < 80
    ? systemHealth.allScoreDrivers
        .filter((d) => d.direction === "down")
        .map((d, i) => ({
          priority:         i + 1,
          title:            makeOperationalTitle(d, brain, saHour, d.module === "DUTIES" ? dutiesIncompleteCount : undefined),
          why:              d.reason,
          impact:           makeOperationalConsequence(d, brain, saHour),
          owner:            gmSituation.name,
          estimatedMinutes: 30,
          moneyAtRisk:      null  as number | null,
          deadline:         "Today" as string | null,
          financialImpact:  null  as string | null,
          ownerRole:        "GM"  as const,
          escalateTo:       null  as BrainOutput["actionQueue"][0]["escalateTo"],
          status:           "not_started" as const,
        }))
    : [];

  const hasActions = displayActions.length > 0;

  // ── Grade motivator ────────────────────────────────────────────────────────
  const gradeSteps = gradeMotivator(score, systemHealth.allScoreDrivers, dutiesIncompleteCount);
  const gradeOrder: Array<keyof typeof GRADE_THRESHOLDS> = ["D", "C", "B", "A"];
  const nextGrade = gradeOrder.find((g) => score < GRADE_THRESHOLDS[g]);

  // ── Score bars ─────────────────────────────────────────────────────────────
  const scoreBars = systemHealth.allScoreDrivers.map((driver) => {
    const max = MODULE_MAX[driver.module] ?? 20;
    const pct = Math.round((driver.pts / max) * 100);
    const barColor =
      pct >= 80 ? "bg-emerald-500" :
      pct >= 50 ? "bg-amber-500"   : "bg-red-500";
    const textColor =
      pct >= 80 ? "text-emerald-700 dark:text-emerald-500" :
      pct >= 50 ? "text-amber-600 dark:text-amber-400"     : "text-red-600 dark:text-red-400";
    return { driver, max, pct, barColor, textColor };
  });

  // ── Brain recommendation ───────────────────────────────────────────────────
  const brainRec = buildBrainRecommendation(brain);

  return (
    <div className="border-b border-[#e2e2e0] dark:border-[#1a1a1a] bg-white dark:bg-[#0c0c0c]">
      <div className="grid grid-cols-1 lg:grid-cols-[65fr_35fr] divide-y lg:divide-y-0 lg:divide-x divide-[#e2e2e0] dark:divide-[#1a1a1a]">

        {/* ════════════ LEFT — Priority Actions ════════════ */}
        <div className="p-4 space-y-3 bg-white dark:bg-[#0f0f0f]">

          {/* Section header */}
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.2em] font-semibold text-stone-600">
              {hasActions ? "REQUIRES ACTION TODAY" : "ALL CLEAR — MONITOR ONLY"}
            </span>
            {hasActions && (
              <span className="text-[9px] font-mono text-stone-500">
                {displayActions.length} action{displayActions.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* All clear state */}
          {!hasActions && (
            <p className="text-[11px] text-stone-500 font-mono py-4 text-center">
              All systems nominal. Monitor floor energy and walk-in conversion.
            </p>
          )}

          {/* Action cards */}
          {displayActions.map((action, idx) => {
            const sev = deriveSeverity(idx, primaryThreat.severity, action.moneyAtRisk);
            const isCritical = sev === "critical";
            const countdown = deadlineCountdown(action.deadline, minutesToClose, minutesToMidnight);
            const isTop = idx === 0;
            const ifIgnored = isTop
              ? primaryThreat.ifIgnored
              : doNothingConsequences[idx - 1]?.consequence ?? null;
            const showDrilldown = isDutiesCard(action.title) && incompleteTasks.length > 0;

            return (
              <div
                key={action.priority}
                className={cn(
                  "border-l-[6px] border border-[#e2e2e0] dark:border-[#1a1a1a]",
                  isCritical ? "bg-[#fff8f8] dark:bg-[#0f0505]" : "bg-white dark:bg-[#0c0c0c]",
                  SEV_BORDER[sev],
                )}
              >
                {/* Card header */}
                <div className="px-3 pt-3 pb-2 flex items-start gap-2.5">
                  <span className="text-[11px] font-black font-mono text-stone-600 dark:text-stone-500 shrink-0 w-4 mt-[1px]">
                    {action.priority}.
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        "text-[10px] font-black uppercase tracking-wider border px-1.5 py-0.5",
                        SEV_BADGE[sev],
                      )}>
                        {sev}
                      </span>
                      {/* Expiry/overdue badge for critical */}
                      {isCritical && action.deadline && (
                        <span className="text-[9px] font-mono font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">
                          {action.deadline.toLowerCase() === "immediate" ? "ACT NOW" :
                           action.deadline.toLowerCase().includes("today") ? "DUE TODAY" : "OVERDUE"}
                        </span>
                      )}
                      {action.financialImpact && (
                        <span className="text-[9px] font-mono text-amber-700 dark:text-amber-500/80 uppercase tracking-wider">
                          ⚠ {action.financialImpact}
                        </span>
                      )}
                    </div>
                    <p className={cn(
                      "font-bold text-[#0a0a0a] dark:text-stone-100 leading-snug",
                      isCritical ? "text-[15px]" : "text-sm",
                    )}>
                      {action.title}
                    </p>
                    {action.why && (
                      <p className="text-[11px] text-stone-500 dark:text-stone-500 leading-relaxed">
                        {action.why}
                      </p>
                    )}
                  </div>
                </div>

                {/* Consequence text */}
                <div className="px-3 pb-2 pl-[calc(0.75rem+1.5rem)]">
                  <p className="text-[11px] text-[#0a0a0a] dark:text-stone-300 leading-relaxed">
                    {action.impact}
                  </p>
                </div>

                {/* Duties drilldown — incomplete task list */}
                {showDrilldown && (
                  <div className="mx-3 ml-[calc(0.75rem+1.5rem)] mb-2 border border-[#ebebea] dark:border-[#1e1e1e] bg-[#fafafa] dark:bg-[#080808]">
                    <div className="px-2.5 py-1.5 border-b border-[#ebebea] dark:border-[#1e1e1e] flex items-center justify-between">
                      <span className="text-[9px] uppercase tracking-wider text-stone-500 font-semibold">
                        INCOMPLETE DUTIES ({incompleteTasks.length} remaining)
                      </span>
                      {dutiesData && (
                        <span className="text-[9px] font-mono text-stone-500">
                          {dutiesData.completedCount}/{dutiesData.totalCount} done
                        </span>
                      )}
                    </div>
                    <div className="divide-y divide-[#ebebea] dark:divide-[#1e1e1e]">
                      {incompleteTasks.map((task) => {
                        const statusLabel = TASK_STATUS_LABEL[task.status] ?? task.status.toUpperCase();
                        const statusColor = TASK_STATUS_COLOR[task.status] ?? "text-stone-500";
                        return (
                          <div key={task.id} className="px-2.5 py-1.5 flex items-center gap-2 font-mono">
                            <span className="text-stone-400 dark:text-stone-700 shrink-0">●</span>
                            <span className="text-[11px] text-[#0a0a0a] dark:text-stone-300 flex-1 min-w-0 truncate">
                              {task.action_name}
                            </span>
                            <span className={cn("text-[9px] font-bold shrink-0 uppercase tracking-wider", statusColor)}>
                              {statusLabel}
                            </span>
                            <span className="text-[9px] text-stone-500 shrink-0 w-16 text-right truncate">
                              {task.assigned_to_name ?? "—"}
                            </span>
                            <span className="text-[9px] text-stone-500 dark:text-stone-600 shrink-0 w-12 text-right">
                              {task.due_time ? `SLA: ${task.due_time}` : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Meta row: owner · deadline · escalate */}
                <div className="px-3 pb-2 pl-[calc(0.75rem+1.5rem)] flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-stone-600 dark:text-stone-500 border-t border-[#f0f0ee] dark:border-[#181818] pt-2">
                  <span><span className="text-[9px] uppercase tracking-wider text-stone-500 mr-1">OWNER</span>{action.ownerRole}</span>
                  {action.deadline && (
                    <span>
                      <span className="text-[9px] uppercase tracking-wider text-stone-500 mr-1">DEADLINE</span>
                      {action.deadline}
                      {countdown && (
                        <span className={cn(
                          "ml-1 font-bold",
                          countdown.isUrgent ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
                        )}>
                          [{countdown.label}]
                        </span>
                      )}
                    </span>
                  )}
                  {action.escalateTo && (
                    <span>
                      <span className="text-[9px] uppercase tracking-wider text-stone-500 mr-1">ESCALATE</span>
                      {action.escalateTo}
                    </span>
                  )}
                  {action.estimatedMinutes > 0 && (
                    <span className="text-stone-500">~{action.estimatedMinutes} min</span>
                  )}
                </div>

                {/* If ignored */}
                {ifIgnored && sev !== "low" && (
                  <div className="px-3 pb-2 pl-[calc(0.75rem+1.5rem)] border-t border-[#f0f0ee] dark:border-[#181818] pt-2">
                    <span className="text-[9px] uppercase tracking-wider text-red-500/60 font-semibold block mb-0.5">
                      IF YOU DO NOTHING
                    </span>
                    <p className={cn(
                      "text-[11px] leading-relaxed transition-opacity duration-200",
                      isCritical
                        ? "text-red-700 dark:text-red-400/80 opacity-80 hover:opacity-100"
                        : "text-red-700/70 dark:text-red-300/60 opacity-60 hover:opacity-100",
                    )}>
                      {ifIgnored}
                    </p>
                  </div>
                )}

                {/* Action taken */}
                {sev !== "low" && (
                  <div className="px-3 pb-3 pl-[calc(0.75rem+1.5rem)] pt-1">
                    <ActionTakenButton signalId={action.title} siteId={siteId} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ════════════ RIGHT — System Status ════════════ */}
        <div className="p-4 space-y-4 bg-[#fafafa] dark:bg-[#0a0a0a]">

          {/* Brain recommendation */}
          {brainRec && (
            <div className="border-l-[3px] border-l-amber-500 border border-[#e2e2e0] dark:border-[#2a2a2a] bg-[#fffdf5] dark:bg-amber-950/10 px-3 py-2.5 font-mono">
              <span className="text-[9px] uppercase tracking-wider text-amber-700 dark:text-amber-500 font-bold block mb-1">
                ⚡ BRAIN RECOMMENDATION
              </span>
              <p className="text-[11px] text-[#0a0a0a] dark:text-stone-200 leading-relaxed">
                {brainRec}
              </p>
            </div>
          )}

          {/* Score + Grade + Trend */}
          <div className="font-mono">
            <span className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-medium block mb-2">
              SYSTEM PULSE
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-[#0a0a0a] dark:text-stone-100">
                {systemHealth.score}
              </span>
              <span className={cn("text-xl font-black", GRADE_COLOR[systemHealth.grade] ?? "text-stone-500")}>
                {systemHealth.isDayStarting ? "" : systemHealth.grade}
              </span>
              <span className={cn("text-base font-bold leading-none", TREND_COLOR[systemHealth.trend])}>
                {TREND_ARROW[systemHealth.trend]}
              </span>
            </div>
            {systemHealth.isDayStarting && (
              <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
                DAY STARTING
              </span>
            )}
          </div>

          {/* Score breakdown bars */}
          <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3 space-y-2.5 font-mono">
            <span className="text-[9px] uppercase tracking-wider text-stone-600 block">SCORE BREAKDOWN</span>
            {scoreBars.map(({ driver, max, pct, barColor, textColor }) => {
              // Duties-specific sub-line
              const dutiesSubLine = driver.module === "DUTIES" && dutiesData
                ? `${dutiesData.completedCount} of ${dutiesData.totalCount} duties complete (${pct}%) · Full 20 pts at 100%`
                : null;

              return (
                <div key={driver.module}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] uppercase tracking-wider text-stone-600">
                      {driver.module}
                    </span>
                    <span className={cn("text-[9px] font-bold", textColor)}>
                      {driver.pts}/{max}
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#e5e5e5] dark:bg-[#1a1a1a] rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", barColor)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {dutiesSubLine && (
                    <p className="text-[9px] font-mono text-stone-500 dark:text-stone-600 mt-0.5 leading-tight">
                      {dutiesSubLine}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Fastest path to next grade */}
          {nextGrade && gradeSteps.length > 0 && (
            <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3 font-mono space-y-1.5">
              <span className="text-[9px] uppercase tracking-[0.15em] text-amber-700 dark:text-amber-500 font-bold block">
                FASTEST PATH TO GRADE {nextGrade}
              </span>
              {gradeSteps.map((step, i) => (
                <p key={i} className="text-[10px] text-amber-700 dark:text-amber-400">
                  <span className="font-bold">→</span> {step.label}
                </p>
              ))}
              {gradeSteps.length >= 2 && (
                <p className="text-[10px] text-stone-500 dark:text-stone-600">
                  Reach Grade {nextGrade} with both done
                </p>
              )}
            </div>
          )}

          {/* Recovery window */}
          {recoveryMeter && !recoveryMeter.isOnTrack && (
            <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3 font-mono space-y-1">
              <span className="text-[9px] uppercase tracking-wider text-stone-600 block">RECOVERY WINDOW</span>
              <div className="text-[11px] text-[#0a0a0a] dark:text-stone-300">
                <span className="text-amber-700 dark:text-amber-400 font-bold">
                  Gap: {fmtZAR(recoveryMeter.revenueGap)}
                </span>
                {" · "}
                <span className="text-emerald-700 dark:text-emerald-400">
                  Recoverable: {fmtZAR(recoveryMeter.recoverable)}
                </span>
                {" · "}
                <span className="text-stone-600">{fmtMins(recoveryMeter.timeLeftMinutes)} left</span>
              </div>
              {recoveryMeter.topActions.slice(0, 2).map((action, i) => (
                <p key={i} className="text-[10px] text-stone-600 dark:text-stone-500">
                  <span className="text-emerald-600 dark:text-emerald-500 font-bold">→</span> {action}
                </p>
              ))}
            </div>
          )}

          {/* Projected close */}
          {forecastSummary.projectedClose > 0 &&
            !forecastSummary.isPreService &&
            !forecastSummary.isDayClosed &&
            !forecastSummary.syncPending && (
            <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3 font-mono space-y-0.5">
              <span className="text-[9px] uppercase tracking-wider text-stone-600 block">PROJECTED CLOSE</span>
              <span className="text-base font-bold text-[#0a0a0a] dark:text-stone-200">
                {fmtZAR(forecastSummary.projectedClose)}
              </span>
              <span className={cn(
                "text-[11px] font-bold block",
                (forecastSummary.vsTarget ?? 0) >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400",
              )}>
                {fmtPct(forecastSummary.vsTarget ?? 0, true)} vs target
              </span>
            </div>
          )}

          {/* Closed day revenue */}
          {forecastSummary.isDayClosed && forecastSummary.projectedClose > 0 && (
            <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3 font-mono space-y-0.5">
              <span className="text-[9px] uppercase tracking-wider text-stone-600 block">TODAY'S REVENUE</span>
              <span className="text-base font-bold text-[#0a0a0a] dark:text-stone-200">
                {fmtZAR(forecastSummary.projectedClose)}
              </span>
              <span className={cn(
                "text-[11px] font-bold block",
                (forecastSummary.vsTarget ?? 0) >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400",
              )}>
                {fmtPct(forecastSummary.vsTarget ?? 0, true)} vs target
              </span>
            </div>
          )}

          {/* GM situation */}
          <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3 font-mono">
            <span className="text-[9px] uppercase tracking-wider text-stone-600 block mb-1">GM</span>
            <span className="text-[11px] text-[#0a0a0a] dark:text-stone-300 font-semibold">
              {gmSituation.name}
            </span>
            {gmSituation.tier !== "Unknown" && (
              <span className={cn(
                "text-[10px] font-bold ml-2",
                gmSituation.tier === "Elite"   ? "text-emerald-600 dark:text-emerald-400" :
                gmSituation.tier === "Strong"  ? "text-emerald-700 dark:text-emerald-500" :
                gmSituation.tier === "Average" ? "text-amber-600 dark:text-amber-400"     :
                "text-red-600 dark:text-red-400",
              )}>
                {gmSituation.tier}
              </span>
            )}
            {gmSituation.score > 0 && (
              <span className="text-[10px] text-stone-600 ml-2">{gmSituation.score}/100</span>
            )}
            {gmSituation.alertNeeded && gmSituation.alertReason && (
              <p className="text-[9px] text-red-700/80 dark:text-red-400/70 mt-0.5 leading-snug">
                {gmSituation.alertReason}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
