/**
 * SiteStatusPanel
 *
 * Head Office executive explanation layer.
 * Shows a clean breakdown for every site that is not fully live —
 * what data is flowing, what is missing, and the recommended next action.
 *
 * Only renders if at least one site is partial or pending.
 */

"use client";

import { cn } from "@/lib/utils";
import {
  getSiteOperationalStatus,
  SITE_STATUS_LABEL,
  MODULE_LABEL,
  type SiteStatus,
  type SiteModuleStatus,
  type ModuleDataState,
} from "@/lib/ops/siteOperationalStatus";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SiteStatusRow {
  id:                 string;
  name:               string;
  deployment_stage:   "live" | "partial" | "pending";
  has_pos_connection: boolean;
  /** True if a manual daily sales upload exists recently */
  has_manual_sales?:  boolean;
  /** True if any compliance items are configured */
  has_compliance?:    boolean;
  /** True if any maintenance items are configured */
  has_maintenance?:   boolean;
}

// ── Palettes ──────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<SiteStatus, {
  border:    string;
  header:    string;
  badge:     string;
  dot:       string;
  dotPulse?: string;
}> = {
  live: {
    border:   "border-emerald-200 dark:border-emerald-800",
    header:   "bg-emerald-50 dark:bg-emerald-950/20",
    badge:    "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    dot:      "bg-emerald-500",
  },
  partial: {
    border:   "border-amber-200 dark:border-amber-800",
    header:   "bg-amber-50 dark:bg-amber-950/20",
    badge:    "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    dot:      "bg-amber-500",
  },
  pending: {
    border:   "border-stone-200 dark:border-stone-700",
    header:   "bg-stone-50 dark:bg-stone-900",
    badge:    "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400",
    dot:      "bg-stone-400",
  },
};

const MODULE_STATE_STYLE: Record<ModuleDataState | "none", {
  pill:  string;
  label: string;
}> = {
  live: {
    pill:  "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    label: "Live",
  },
  estimated: {
    pill:  "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    label: "Estimated",
  },
  none: {
    pill:  "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400",
    label: "Waiting",
  },
};

// ── Single site card ──────────────────────────────────────────────────────────

function SiteStatusCard({ site }: { site: SiteStatusRow }) {
  const opStatus = getSiteOperationalStatus({
    deployment_stage:   site.deployment_stage,
    has_pos_connection: site.has_pos_connection,
    has_manual_sales:   site.has_manual_sales ?? false,
    has_compliance:     site.has_compliance   ?? true,
    has_maintenance:    site.has_maintenance  ?? true,
  });

  const style = STATUS_STYLE[opStatus.status];

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden flex flex-col",
      style.border,
    )}>
      {/* Header */}
      <div className={cn("flex items-center justify-between gap-3 px-4 py-3", style.header)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("h-2 w-2 rounded-full shrink-0", style.dot)} />
          <p className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate leading-tight">
            {site.name}
          </p>
        </div>
        <span className={cn(
          "shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
          style.badge,
        )}>
          {SITE_STATUS_LABEL[opStatus.status]}
        </span>
      </div>

      {/* Module state row */}
      <div className="px-4 pt-3 pb-2 bg-white dark:bg-stone-900 flex flex-wrap gap-1.5">
        {(Object.keys(opStatus.modules) as Array<keyof SiteModuleStatus>).map((mod) => {
          const state   = opStatus.modules[mod] as ModuleDataState;
          const mStyle  = MODULE_STATE_STYLE[state];
          return (
            <span
              key={mod}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                mStyle.pill,
              )}
            >
              {MODULE_LABEL[mod]}
              <span className="opacity-70">·</span>
              {mStyle.label}
            </span>
          );
        })}
      </div>

      {/* Blockers */}
      {opStatus.blockers.length > 0 && (
        <div className="px-4 pb-3 bg-white dark:bg-stone-900 space-y-1">
          {opStatus.blockers.map((b, i) => (
            <p key={i} className="text-[11px] text-stone-500 dark:text-stone-400 flex items-start gap-1.5">
              <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-stone-300 dark:bg-stone-600 shrink-0" />
              {b}
            </p>
          ))}
        </div>
      )}

      {/* Next action */}
      {opStatus.status !== "live" && (
        <div className="px-4 py-2.5 border-t border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40">
          <p className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
            <span className="text-stone-400 dark:text-stone-500 font-normal mr-1">Next step:</span>
            {opStatus.next_action}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface SiteStatusPanelProps {
  sites: SiteStatusRow[];
}

export default function SiteStatusPanel({ sites }: SiteStatusPanelProps) {
  const nonLive = sites.filter(
    (s) => s.deployment_stage === "partial" || s.deployment_stage === "pending",
  );

  if (nonLive.length === 0) return null;

  const pendingCount = nonLive.filter((s) => s.deployment_stage === "pending").length;
  const partialCount = nonLive.filter((s) => s.deployment_stage === "partial").length;

  const summaryLine = [
    partialCount > 0 && `${partialCount} store${partialCount !== 1 ? "s" : ""} awaiting POS connection`,
    pendingCount > 0 && `${pendingCount} store${pendingCount !== 1 ? "s" : ""} not yet deployed`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">
            Store Setup Status
          </h2>
          <p className="text-[11px] text-stone-500 dark:text-stone-500 mt-0.5">
            {summaryLine} — scores reflect only connected modules
          </p>
        </div>
        <span className="rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-2.5 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
          Awaiting Data
        </span>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {nonLive.map((site) => (
          <SiteStatusCard key={site.id} site={site} />
        ))}
      </div>
    </section>
  );
}
