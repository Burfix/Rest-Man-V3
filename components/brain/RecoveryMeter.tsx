/**
 * RecoveryMeter — Revenue recovery opportunity visualisation.
 *
 * Server Component. Only renders when there is an active revenue gap
 * during service hours. Hidden after hours.
 */

import { cn } from "@/lib/utils";
import type { BrainOutput } from "@/services/brain/operating-brain";

type Props = {
  brain: BrainOutput;
};

function fmt(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

export default function RecoveryMeter({ brain }: Props) {
  const { recoveryMeter, forecastSummary } = brain;

  // Nothing to show: no gap, on track, or after hours
  if (!recoveryMeter || forecastSummary.isDayClosed) return null;

  const {
    revenueGap,
    recoverable,
    timeLeftMinutes,
    isOnTrack,
    limitedWindow,
    partialOnly,
    topActions,
  } = recoveryMeter;

  const recoverablePct = revenueGap > 0 ? Math.min(100, (recoverable / revenueGap) * 100) : 0;
  const hoursLeft       = Math.floor(timeLeftMinutes / 60);
  const minsLeft        = timeLeftMinutes % 60;
  const timeLabel       =
    timeLeftMinutes <= 0
      ? "Closed"
      : hoursLeft === 0
      ? `${minsLeft}m left`
      : minsLeft === 0
      ? `${hoursLeft}h left`
      : `${hoursLeft}h ${minsLeft}m left`;

  const statusColor = limitedWindow
    ? "border-[#e2e2e0] bg-white dark:border-red-900/40 dark:bg-red-950/10"
    : partialOnly
    ? "border-[#e2e2e0] bg-white dark:border-amber-900/40 dark:bg-amber-950/10"
    : "border-[#e2e2e0] bg-white dark:border-stone-800 dark:bg-[#0f0f0f]";

  const barColor = limitedWindow
    ? "bg-red-500"
    : partialOnly
    ? "bg-amber-500"
    : "bg-emerald-500";

  return (
    <div className={cn("border p-4 space-y-3", statusColor)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-medium">
          RECOVERY METER
        </span>
        <span className={cn(
          "text-[9px] font-mono uppercase tracking-wider font-bold",
          limitedWindow ? "text-red-600 dark:text-red-400" : partialOnly ? "text-amber-700 dark:text-amber-400" : "text-stone-500",
        )}>
          {timeLabel}
        </span>
      </div>

      {/* Gap + Recoverable amounts */}
      <div className="grid grid-cols-2 gap-4 font-mono">
        <div>
          <span className="text-[9px] uppercase tracking-wider text-stone-600 block">REVENUE GAP</span>
          <span className="text-sm font-bold text-red-600 dark:text-red-400">{fmt(revenueGap)}</span>
        </div>
        <div>
          <span className="text-[9px] uppercase tracking-wider text-stone-600 block">RECOVERABLE</span>
          <span className={cn(
            "text-sm font-bold",
            limitedWindow ? "text-red-600 dark:text-red-400" : partialOnly ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400",
          )}>
            {fmt(recoverable)}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="w-full h-1.5 bg-stone-100 dark:bg-stone-800 overflow-hidden">
          <div
            className={cn("h-full transition-all duration-500", barColor)}
            style={{ width: `${recoverablePct}%` }}
          />
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-[9px] font-mono text-stone-600">
            {recoverablePct.toFixed(0)}% of gap recoverable
          </span>
          {partialOnly && (
            <span className="text-[9px] font-mono text-amber-500/70">partial only</span>
          )}
          {limitedWindow && (
            <span className="text-[9px] font-mono text-red-400/70">narrow window</span>
          )}
        </div>
      </div>

      {/* Top recovery actions */}
      {topActions.length > 0 && (
        <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-2.5 space-y-1">
          <span className="text-[9px] uppercase tracking-wider text-stone-600 block">TOP ACTIONS</span>
          {topActions.slice(0, 2).map((action, i) => (
            <p key={i} className="text-[10px] text-stone-500 leading-snug font-mono">
              {String(i + 1)}. {action}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
