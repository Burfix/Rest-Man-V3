/**
 * ReviewResponseKPIs
 *
 * Header strip for the reviews dashboard showing:
 *   - Avg response time (from response_time_minutes generated column)
 *   - Reply rate % (GMB reviews with posted replies / total GMB)
 *   - Awaiting reply (low-rated with no reply)
 *
 * Colour bands:
 *   excellent      — ≤30 min avg, green
 *   good           — ≤2 hr avg, blue
 *   needs_attention — ≤8 hr avg, amber
 *   critical        — >8 hr or ≥3 awaiting, red
 *   no_data         — no GMB reviews yet, neutral
 */

import { cn } from "@/lib/utils";
import type { ReplyMetrics } from "@/services/reviews/reviewsSummaryService";

const bandStyle: Record<ReplyMetrics["band"], {
  border:    string;
  valueCls:  string;
  label:     string;
}> = {
  excellent:       { border: "border-emerald-200 dark:border-emerald-800/50", valueCls: "text-emerald-700 dark:text-emerald-400", label: "Excellent" },
  good:            { border: "border-blue-200 dark:border-blue-800/50",       valueCls: "text-blue-700 dark:text-blue-400",      label: "Good" },
  needs_attention: { border: "border-amber-200 dark:border-amber-800/50",     valueCls: "text-amber-700 dark:text-amber-400",    label: "Slow" },
  critical:        { border: "border-red-300 dark:border-red-800/50",         valueCls: "text-red-700 dark:text-red-400",        label: "Critical" },
  no_data:         { border: "border-stone-200 dark:border-stone-800",        valueCls: "text-stone-400",                        label: "No data" },
};

interface Props {
  metrics: ReplyMetrics;
}

export default function ReviewResponseKPIs({ metrics }: Props) {
  const style = bandStyle[metrics.band];

  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Avg response time */}
      <div className={cn(
        "border bg-white dark:bg-[#0f0f0f] p-4 space-y-2",
        style.border,
      )}>
        <p className="text-[9px] uppercase tracking-[0.2em] font-medium text-stone-500">
          Avg Response Time
        </p>
        <div className="flex items-end gap-2">
          <span className={cn("text-3xl font-bold tabular-nums", style.valueCls)}>
            {metrics.avgResponseLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-medium",
            metrics.band === "excellent"       ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" :
            metrics.band === "good"            ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" :
            metrics.band === "needs_attention" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" :
            metrics.band === "critical"        ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" :
                                                 "bg-stone-100 text-stone-500",
          )}>
            {style.label}
          </span>
          <span className="text-[9px] text-stone-400">GMB · last 30d</span>
        </div>
      </div>

      {/* Reply rate */}
      <div className="border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#0f0f0f] p-4 space-y-2">
        <p className="text-[9px] uppercase tracking-[0.2em] font-medium text-stone-500">
          Reply Rate
        </p>
        <div className="flex items-end gap-1">
          <span className={cn(
            "text-3xl font-bold tabular-nums",
            metrics.replyRatePct >= 80 ? "text-emerald-700 dark:text-emerald-400" :
            metrics.replyRatePct >= 50 ? "text-amber-700 dark:text-amber-400" :
                                         "text-red-700 dark:text-red-400",
          )}>
            {metrics.replyRatePct}
          </span>
          <span className="mb-1 text-sm text-stone-400 font-mono">%</span>
        </div>
        {/* Progress bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              metrics.replyRatePct >= 80 ? "bg-emerald-500" :
              metrics.replyRatePct >= 50 ? "bg-amber-400" :
                                           "bg-red-400",
            )}
            style={{ width: `${metrics.replyRatePct}%` }}
          />
        </div>
        <p className="text-[9px] text-stone-400 font-mono">of GMB reviews replied</p>
      </div>

      {/* Awaiting reply */}
      <div className={cn(
        "border bg-white dark:bg-[#0f0f0f] p-4 space-y-2",
        metrics.awaitingReplyCount === 0
          ? "border-stone-200 dark:border-stone-800"
          : metrics.awaitingReplyCount >= 3
          ? "border-red-300 dark:border-red-800/50"
          : "border-amber-200 dark:border-amber-800/50",
      )}>
        <p className="text-[9px] uppercase tracking-[0.2em] font-medium text-stone-500">
          Awaiting Reply
        </p>
        <div className="flex items-end gap-2">
          <span className={cn(
            "text-3xl font-bold tabular-nums",
            metrics.awaitingReplyCount === 0 ? "text-stone-900 dark:text-stone-100" :
            metrics.awaitingReplyCount >= 3  ? "text-red-700 dark:text-red-400" :
                                               "text-amber-700 dark:text-amber-400",
          )}>
            {metrics.awaitingReplyCount}
          </span>
        </div>
        <p className="text-[9px] text-stone-400">
          {metrics.awaitingReplyCount === 0
            ? "All low-rated reviews replied ✓"
            : `low-rated review${metrics.awaitingReplyCount !== 1 ? "s" : ""} need a reply`}
        </p>
      </div>
    </div>
  );
}
