/**
 * GlobalAlertBar
 *
 * Client-rendered top strip for the Head Office Control Tower.
 * Colour-coded by risk state (red → amber → green), shows:
 *   • Number of stores at risk (with pulsing dot when red)
 *   • Projected revenue gap in ZAR
 *   • Compliance issues count
 *   • Overdue actions count
 *   • Live clock + minutes-since-data staleness
 *   • Quick link to the Actions board
 */

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { GroupMetrics } from "@/services/ops/headOffice";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtZAR(n: number): string {
  if (n >= 1_000_000) return `R${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000)     return `R${Math.round(n / 1_000)}k`;
  return `R${Math.round(n)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  metrics:    GroupMetrics;
  computedAt: string;   // ISO timestamp from the last snapshot computation
}

export default function GlobalAlertBar({ metrics, computedAt }: Props) {
  const [now, setNow] = useState<Date | null>(null);

  // Hydrate on client only — avoids SSR/client mismatch on time
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const hasRisk = metrics.red_stores > 0;
  const hasWarn = !hasRisk && metrics.yellow_stores > 0;
  const allGood = !hasRisk && !hasWarn;

  // Revenue at risk in absolute ZAR
  const revAtRisk =
    metrics.total_revenue_target != null &&
    metrics.group_revenue_gap_pct != null &&
    metrics.group_revenue_gap_pct > 0
      ? metrics.total_revenue_target * (metrics.group_revenue_gap_pct / 100)
      : null;

  const minutesAgo = now
    ? Math.max(0, Math.floor((now.getTime() - new Date(computedAt).getTime()) / 60_000))
    : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-xl flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors",
        hasRisk ? "bg-red-600"    :
        hasWarn ? "bg-amber-500"  :
                  "bg-emerald-600"
      )}
    >
      {/* ── Left: status signals ── */}
      <div className="flex flex-wrap items-center gap-4">

        {/* Risk state primary label */}
        {hasRisk && (
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-white animate-ping shrink-0" />
            <span className="text-sm font-black text-white uppercase tracking-wider">
              {metrics.red_stores} store{metrics.red_stores !== 1 ? "s" : ""} at risk
            </span>
          </div>
        )}
        {hasWarn && (
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-white animate-pulse shrink-0" />
            <span className="text-sm font-bold text-white">
              {metrics.yellow_stores} store{metrics.yellow_stores !== 1 ? "s" : ""} need attention
            </span>
          </div>
        )}
        {allGood && (
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-white shrink-0" />
            <span className="text-sm font-bold text-white">
              All {metrics.green_stores} stores operating normally
            </span>
          </div>
        )}

        {/* Secondary signals — always shown when relevant */}
        {revAtRisk != null && revAtRisk > 500 && (
          <span className="text-sm font-semibold text-white/90">
            · {fmtZAR(revAtRisk)} projected revenue gap
          </span>
        )}
        {metrics.compliance_risk_count > 0 && (
          <span className="text-sm font-semibold text-white/90">
            · {metrics.compliance_risk_count} compliance issue{metrics.compliance_risk_count !== 1 ? "s" : ""}
          </span>
        )}
        {metrics.total_actions_overdue > 0 && (
          <span className="text-sm font-semibold text-white/90">
            · {metrics.total_actions_overdue} overdue action{metrics.total_actions_overdue !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Right: live clock + action link ── */}
      <div className="flex items-center gap-4 shrink-0">
        {now && (
          <span className="text-[11px] text-white/70 tabular-nums">
            {now.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            {" · "}
            {minutesAgo < 2 ? "Live" : `${minutesAgo}m ago`}
          </span>
        )}
        <Link
          href="/dashboard/actions"
          className="rounded-lg bg-white/20 hover:bg-white/30 transition-colors px-3 py-1.5 text-xs font-bold text-white whitespace-nowrap"
        >
          View Actions →
        </Link>
      </div>
    </div>
  );
}
