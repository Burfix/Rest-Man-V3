/**
 * HeroStrip — Layer 1 of the Command Center.
 *
 * Full-width strip: Operating Score → 4 KPI pills → Sync status.
 * Always visible without scrolling on any screen.
 *
 * Server Component (SyncNowButton is the only client leaf).
 */

import { cn } from "@/lib/utils";
import type { BrainOutput } from "@/services/brain/operating-brain";
import type { NormalizedSalesSnapshot } from "@/lib/sales/types";
import SyncNowButton from "./SyncNowButton";

type Props = {
  brain: BrainOutput;
  salesSnapshot: NormalizedSalesSnapshot;
  revenueVariance: number;     // (netSales - target) / target * 100
  servicePeriod: string;       // "DINNER", "LUNCH", etc.
  freshnessMinutes?: number;   // minutes since last data sync
};

// ── Colour helpers ─────────────────────────────────────────────────────────────

const GRADE_BOX: Record<string, string> = {
  A: "bg-emerald-600 text-white",
  B: "bg-teal-600 text-white",
  C: "bg-amber-500 text-white",
  D: "bg-orange-500 text-white",
  F: "bg-red-600 text-white",
  "?": "bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-400",
};

function scoreBarColor(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 65) return "bg-amber-500";
  if (score >= 50) return "bg-orange-400";
  return "bg-red-500";
}

function revPillClass(variance: number): string {
  if (variance >= 0) return "border-l-emerald-500 text-emerald-700 dark:text-emerald-400";
  if (variance >= -15) return "border-l-amber-500 text-amber-700 dark:text-amber-400";
  return "border-l-red-500 text-red-600 dark:text-red-400";
}

function driverPillClass(pts: number, max: number): string {
  const r = pts / max;
  if (r >= 0.8) return "border-l-emerald-500 text-emerald-700 dark:text-emerald-400";
  if (r >= 0.5) return "border-l-amber-500 text-amber-700 dark:text-amber-400";
  return "border-l-red-500 text-red-600 dark:text-red-400";
}

function driverIcon(pts: number, max: number): string {
  const r = pts / max;
  if (r >= 0.8) return "✓";
  if (r >= 0.5) return "⚠";
  return "✕";
}

function fmtZAR(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

function fmtPct(n: number, showPlus = false): string {
  const sign = n >= 0 && showPlus ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function syncLabel(minutes?: number): { text: string; stale: boolean } {
  if (minutes == null) return { text: "Status unknown", stale: true };
  if (minutes === 0)   return { text: "Just synced", stale: false };
  if (minutes < 60)    return { text: `Synced ${minutes}m ago`, stale: minutes > 15 };
  const h = Math.round(minutes / 60);
  return { text: `Synced ${h}h ago`, stale: true };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function HeroStrip({
  brain,
  salesSnapshot,
  revenueVariance,
  servicePeriod,
  freshnessMinutes,
}: Props) {
  const { systemHealth, voiceLine } = brain;
  const score = systemHealth.score;
  const grade = systemHealth.grade;
  const barWidth = `${Math.round(Math.min(100, Math.max(0, score)))}%`;

  // KPI pill sources
  const labourDriver     = systemHealth.allScoreDrivers.find((d) => d.module === "LABOUR");
  const compDriver       = systemHealth.allScoreDrivers.find((d) => d.module === "COMPLIANCE");
  const maintDriver      = systemHealth.allScoreDrivers.find((d) => d.module === "MAINTENANCE");

  // Sync
  const { text: syncText, stale } = syncLabel(freshnessMinutes);

  // SAST time for session label (server-side — static on each render)
  const saTimeStr = new Date().toLocaleString("en-US", {
    timeZone: "Africa/Johannesburg",
    hour:     "2-digit",
    minute:   "2-digit",
    hour12:   false,
  });

  return (
    <div className="bg-white dark:bg-[#0f0f0f] border-b border-[#e2e2e0] dark:border-[#1a1a1a]">
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-[#e2e2e0] dark:divide-[#1a1a1a]">

        {/* ── LEFT — Score + Grade + Readiness bar + Voice line ── */}
        <div className="px-5 py-3 flex items-center gap-4 min-h-[72px]">
          {/* Score + Grade box */}
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-4xl font-black font-mono text-[#0a0a0a] dark:text-stone-100 leading-none">
              {score}
            </span>
            {systemHealth.isDayStarting ? (
              <span className="text-[9px] font-semibold text-stone-500 uppercase tracking-wider">
                DAY<br />STARTING
              </span>
            ) : (
              <span className={cn(
                "text-xl font-black leading-none px-1.5 py-0.5 rounded-sm",
                GRADE_BOX[grade] ?? GRADE_BOX["?"],
              )}>
                {grade}
              </span>
            )}
          </div>

          {/* Bar + Voice */}
          <div className="min-w-0 flex-1">
            {/* Readiness bar */}
            <div className="h-1.5 bg-[#e5e5e5] dark:bg-[#252525] rounded-full mb-1.5 overflow-hidden">
              <div
                className={cn("h-full rounded-full", scoreBarColor(score))}
                style={{ width: barWidth }}
              />
            </div>
            {/* Voice line */}
            {voiceLine && (
              <p className="text-[11px] text-[#52524e] dark:text-stone-400 font-mono leading-snug line-clamp-2">
                {voiceLine}
              </p>
            )}
          </div>
        </div>

        {/* ── MIDDLE — 4 KPI pills ── */}
        <div className="px-5 py-3 flex items-center gap-2 flex-wrap">

          {/* Revenue */}
          <div className={cn(
            "border-l-[3px] border border-[#e2e2e0] dark:border-[#2a2a2a] px-2.5 py-1.5 font-mono text-[10px]",
            revPillClass(revenueVariance),
          )}>
            <span className="text-[9px] uppercase tracking-wider text-stone-500 dark:text-stone-600 block mb-0.5">
              REVENUE
            </span>
            <span className="font-bold">{fmtZAR(salesSnapshot.netSales)}</span>
            {" "}
            <span className="opacity-80">
              {fmtPct(revenueVariance, true)} {revenueVariance >= 0 ? "▲" : "▼"}
            </span>
          </div>

          {/* Labour */}
          {labourDriver && (
            <div className={cn(
              "border-l-[3px] border border-[#e2e2e0] dark:border-[#2a2a2a] px-2.5 py-1.5 font-mono text-[10px]",
              labourDriver.direction === "up"
                ? "border-l-emerald-500 text-emerald-700 dark:text-emerald-400"
                : "border-l-red-500 text-red-600 dark:text-red-400",
            )}>
              <span className="text-[9px] uppercase tracking-wider text-stone-500 dark:text-stone-600 block mb-0.5">
                LABOUR
              </span>
              <span className="font-bold">
                {labourDriver.direction === "up" ? "On target ✓" : "Over target ✕"}
              </span>
            </div>
          )}

          {/* Compliance */}
          {compDriver && (
            <div className={cn(
              "border-l-[3px] border border-[#e2e2e0] dark:border-[#2a2a2a] px-2.5 py-1.5 font-mono text-[10px]",
              driverPillClass(compDriver.pts, 15),
            )}>
              <span className="text-[9px] uppercase tracking-wider text-stone-500 dark:text-stone-600 block mb-0.5">
                COMPLIANCE
              </span>
              <span className="font-bold">
                {compDriver.pts >= 13
                  ? "All clear ✓"
                  : `${compDriver.pts}/15 pts ${driverIcon(compDriver.pts, 15)}`}
              </span>
            </div>
          )}

          {/* Maintenance */}
          {maintDriver && (
            <div className={cn(
              "border-l-[3px] border border-[#e2e2e0] dark:border-[#2a2a2a] px-2.5 py-1.5 font-mono text-[10px]",
              driverPillClass(maintDriver.pts, 15),
            )}>
              <span className="text-[9px] uppercase tracking-wider text-stone-500 dark:text-stone-600 block mb-0.5">
                MAINTENANCE
              </span>
              <span className="font-bold">
                {maintDriver.pts >= 13
                  ? "Clear ✓"
                  : `${maintDriver.pts}/15 pts ${driverIcon(maintDriver.pts, 15)}`}
              </span>
            </div>
          )}
        </div>

        {/* ── RIGHT — Sync + Session + Button ── */}
        <div className="px-5 py-3 flex flex-col justify-center gap-1.5">
          {/* Sync indicator */}
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "w-2 h-2 rounded-full shrink-0",
              stale ? "bg-amber-400" : "bg-emerald-400",
            )} />
            <span className="text-[10px] font-mono text-stone-500 dark:text-stone-500">
              {syncText}
            </span>
          </div>
          {/* Session label */}
          <span className="text-[10px] font-mono font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
            {servicePeriod} · {saTimeStr}
          </span>
          {/* Sync button */}
          <SyncNowButton />
        </div>
      </div>
    </div>
  );
}
