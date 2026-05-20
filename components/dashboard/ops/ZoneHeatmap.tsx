"use client";

/**
 * ZoneHeatmap — interactive zone risk grid.
 *
 * Renders one card per zone (green / amber / red).
 * Includes a "Recompute" button that calls POST /api/risk/recompute
 * and refreshes the view. Clicking a zone card expands a drill-down
 * panel showing the key risk factors.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ZoneSummary, ZoneRiskStatus } from "@/types/universal";

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_RING: Record<ZoneRiskStatus, string> = {
  green: "ring-emerald-300",
  amber: "ring-amber-300",
  red:   "ring-red-400",
};

const STATUS_BG: Record<ZoneRiskStatus, string> = {
  green: "bg-emerald-50",
  amber: "bg-amber-50",
  red:   "bg-red-50",
};

const STATUS_HEADER: Record<ZoneRiskStatus, string> = {
  green: "bg-emerald-600",
  amber: "bg-amber-500",
  red:   "bg-red-600",
};

const STATUS_DOT: Record<ZoneRiskStatus, string> = {
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red:   "bg-red-500 animate-pulse",
};

const STATUS_LABEL: Record<ZoneRiskStatus, string> = {
  green: "All Clear",
  amber: "Attention",
  red:   "At Risk",
};

const STATUS_TEXT: Record<ZoneRiskStatus, string> = {
  green: "text-emerald-700",
  amber: "text-amber-700",
  red:   "text-red-700",
};

const ZONE_ICONS: Record<string, string> = {
  kitchen:     "🍳",
  bar:         "🍸",
  dining_room: "🍽️",
  terrace:     "🌿",
  bathrooms:   "🚿",
  entrance:    "🚪",
  storage:     "📦",
  office:      "💼",
  general:     "📍",
};

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score, status }: { score: number; status: ZoneRiskStatus }) {
  const fill =
    status === "red"   ? "bg-red-500" :
    status === "amber" ? "bg-amber-400" :
                         "bg-emerald-500";
  return (
    <div className="mt-2 h-1.5 w-full rounded-full bg-stone-200">
      <div
        className={cn("h-1.5 rounded-full transition-all duration-500", fill)}
        style={{ width: `${Math.min(score, 100)}%` }}
      />
    </div>
  );
}

// ── Zone card ─────────────────────────────────────────────────────────────────

function ZoneCard({
  summary,
  isExpanded,
  onClick,
}: {
  summary: ZoneSummary;
  isExpanded: boolean;
  onClick: () => void;
}) {
  const { zone, status, composite_score } = summary;
  const icon = ZONE_ICONS[zone.zone_type] ?? "📍";
  const hasIssues = status !== "green";

  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left w-full rounded-xl ring-2 transition-all duration-200",
        "hover:shadow-md focus:outline-none focus-visible:ring-offset-2",
        STATUS_RING[status],
        isExpanded ? "shadow-md" : "shadow-sm"
      )}
    >
      {/* Coloured header strip */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-2.5 rounded-t-xl",
          STATUS_HEADER[status]
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="text-sm font-bold text-white">{zone.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
          <span className="text-xs font-semibold text-white/90">
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>

      {/* Card body */}
      <div className={cn("px-4 py-3 rounded-b-xl", STATUS_BG[status])}>
        {/* Score */}
        <div className="flex items-baseline justify-between">
          <span className={cn("text-2xl font-bold tabular-nums", STATUS_TEXT[status])}>
            {Math.round(composite_score)}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Risk Score / 100
          </span>
        </div>
        <ScoreBar score={composite_score} status={status} />

        {/* Key metrics */}
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <Metric
            label="Tickets"
            value={summary.open_tickets}
            alert={summary.open_tickets > 0}
          />
          <Metric
            label="Overdue"
            value={summary.overdue_obligations}
            alert={summary.overdue_obligations > 0}
          />
          <Metric
            label="OOS Assets"
            value={summary.oos_assets}
            alert={summary.oos_assets > 0}
          />
        </div>

        {/* Primary risk label */}
        {hasIssues && summary.primary_risk && (
          <p className="mt-2.5 text-[11px] font-medium text-stone-600 leading-snug line-clamp-1">
            ⚠ {summary.primary_risk}
          </p>
        )}

        {/* Expand indicator */}
        <div className="mt-2 flex justify-end">
          <span className="text-[10px] text-stone-500 dark:text-stone-400 font-medium">
            {isExpanded ? "▲ Hide details" : "▼ Details"}
          </span>
        </div>
      </div>

      {/* Expanded drill-down */}
      {isExpanded && (
        <div className="border-t border-stone-200 bg-white rounded-b-xl px-4 py-3 space-y-2">
          <DrillDownRow
            icon="🔧"
            label="Open tickets"
            value={summary.open_tickets}
            sub={`${summary.critical_tickets} critical`}
            alert={summary.open_tickets > 0}
          />
          <DrillDownRow
            icon="📋"
            label="Overdue obligations"
            value={summary.overdue_obligations}
            sub={`${summary.due_soon_obligations} due soon`}
            alert={summary.overdue_obligations > 0}
          />
          <DrillDownRow
            icon="🏭"
            label="Out-of-service assets"
            value={summary.oos_assets}
            alert={summary.oos_assets > 0}
          />
          {summary.active_event_conflicts > 0 && (
            <DrillDownRow
              icon="🎉"
              label="Event conflict risk"
              value={summary.active_event_conflicts}
              sub="critical ticket during event"
              alert
            />
          )}
          {summary.secondary_risk && (
            <p className="text-[11px] text-stone-500 pt-1 border-t border-stone-100">
              ℹ {summary.secondary_risk}
            </p>
          )}
          {summary.last_computed_at && (
            <p className="text-[10px] text-stone-500 dark:text-stone-400">
              Last computed:{" "}
              {new Date(summary.last_computed_at).toLocaleTimeString("en-ZA", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
      )}
    </button>
  );
}

function Metric({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md px-1 py-1.5",
        alert && value > 0 ? "bg-white/60" : "bg-white/30"
      )}
    >
      <p
        className={cn(
          "text-lg font-bold tabular-nums leading-none",
          alert && value > 0 ? "text-stone-800" : "text-stone-500 dark:text-stone-400"
        )}
      >
        {value}
      </p>
      <p className="text-[9px] uppercase tracking-wide text-stone-500 mt-0.5">
        {label}
      </p>
    </div>
  );
}

function DrillDownRow({
  icon,
  label,
  value,
  sub,
  alert,
}: {
  icon: string;
  label: string;
  value: number;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <span className="text-sm">{icon}</span>
        <div>
          <p className="text-xs font-medium text-stone-700">{label}</p>
          {sub && <p className="text-[10px] text-stone-500 dark:text-stone-400">{sub}</p>}
        </div>
      </div>
      <span
        className={cn(
          "text-sm font-bold tabular-nums",
          alert && value > 0 ? "text-red-600" : "text-stone-500 dark:text-stone-400"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── Site summary bar ──────────────────────────────────────────────────────────

function SiteSummaryBar({
  zones,
  computedAt,
}: {
  zones: ZoneSummary[];
  computedAt: string | null;
}) {
  const red   = zones.filter((z) => z.status === "red").length;
  const amber = zones.filter((z) => z.status === "amber").length;
  const green = zones.filter((z) => z.status === "green").length;

  const overall: ZoneRiskStatus =
    red > 0 ? "red" : amber > 0 ? "amber" : "green";

  return (
    <div
      className={cn(
        "rounded-xl px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-2",
        STATUS_BG[overall],
        "ring-1",
        STATUS_RING[overall]
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-3 w-3 rounded-full", STATUS_DOT[overall])} />
        <span className={cn("text-sm font-bold", STATUS_TEXT[overall])}>
          Site Status — {STATUS_LABEL[overall]}
        </span>
      </div>
      <div className="flex items-center gap-5 text-sm">
        <Pill count={red}   label="At Risk"   color="text-red-700 bg-red-100"     />
        <Pill count={amber} label="Attention" color="text-amber-700 bg-amber-100" />
        <Pill count={green} label="Clear"     color="text-emerald-700 bg-emerald-100" />
      </div>
      {computedAt && (
        <p className="ml-auto text-[11px] text-stone-500 dark:text-stone-400 hidden sm:block">
          Updated{" "}
          {new Date(computedAt).toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}

function Pill({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        color
      )}
    >
      {count} {label}
    </span>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  initialZones: ZoneSummary[];
  initialComputedAt: string | null;
  siteId: string;
}

export default function ZoneHeatmap({
  initialZones,
  initialComputedAt,
  siteId,
}: Props) {
  const router = useRouter();
  const [zones, setZones] = useState<ZoneSummary[]>(initialZones);
  const [computedAt, setComputedAt] = useState<string | null>(initialComputedAt);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [recomputeError, setRecomputeError] = useState<string | null>(null);
  const [lastRecomputed, setLastRecomputed] = useState<string | null>(null);

  async function handleRecompute() {
    setRecomputeError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/risk/recompute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteId }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Recompute failed");
        }

        const data = await res.json();
        setZones(data.zones ?? []);
        setComputedAt(data.computed_at);
        setLastRecomputed(new Date().toLocaleTimeString("en-ZA", {
          hour: "2-digit",
          minute: "2-digit",
        }));
        router.refresh();
      } catch (err) {
        setRecomputeError(
          err instanceof Error ? err.message : "Recompute failed"
        );
      }
    });
  }

  function toggleZone(zoneId: string) {
    setExpandedZone((prev) => (prev === zoneId ? null : zoneId));
  }

  return (
    <div className="space-y-6">
      {/* Site summary + controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <SiteSummaryBar zones={zones} computedAt={computedAt} />
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={handleRecompute}
            disabled={isPending}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold",
              "bg-stone-900 text-white hover:bg-stone-700 active:bg-stone-800",
              "transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isPending ? (
              <>
                <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Computing…
              </>
            ) : (
              <>
                <span>⚡</span>
                Recompute Risk
              </>
            )}
          </button>
          {lastRecomputed && (
            <p className="text-[11px] text-emerald-600 font-medium">
              ✓ Refreshed at {lastRecomputed}
            </p>
          )}
          {recomputeError && (
            <p className="text-[11px] text-red-600">{recomputeError}</p>
          )}
        </div>
      </div>

      {/* Zone grid */}
      {zones.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {zones.map((summary) => (
            <ZoneCard
              key={summary.zone.id}
              summary={summary}
              isExpanded={expandedZone === summary.zone.id}
              onClick={() => toggleZone(summary.zone.id)}
            />
          ))}
        </div>
      )}

      {/* Risk legend */}
      <RiskLegend />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-8 py-12 text-center">
      <p className="text-2xl">🗺️</p>
      <p className="mt-2 text-sm font-semibold text-stone-700">No zones found</p>
      <p className="mt-1 text-xs text-stone-500">
        Run the SQL migrations and click{" "}
        <span className="font-mono bg-stone-100 px-1 rounded">Recompute Risk</span> to
        populate the heatmap.
      </p>
    </div>
  );
}

function RiskLegend() {
  const bands = [
    {
      range: "0 – 25",
      label: "Green — All Clear",
      color: "bg-emerald-500",
      desc: "No open tickets, no overdue obligations, all assets operational",
    },
    {
      range: "26 – 59",
      label: "Amber — Attention Required",
      color: "bg-amber-400",
      desc: "Open tickets, due-soon obligations, or minor asset issues",
    },
    {
      range: "60 – 100",
      label: "Red — At Risk",
      color: "bg-red-500",
      desc: "Critical ticket, overdue obligation, OOS asset, or event conflict",
    },
  ];

  return (
    <div className="rounded-xl border border-stone-200 bg-white px-5 py-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-500">
        Scoring Guide
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {bands.map((b) => (
          <div key={b.range} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 h-3 w-3 shrink-0 rounded-full",
                b.color
              )}
            />
            <div>
              <p className="text-[11px] font-bold text-stone-700">{b.label}</p>
              <p className="text-[10px] text-stone-500 leading-relaxed">{b.desc}</p>
              <p className="text-[10px] font-mono text-stone-500 dark:text-stone-400">Score {b.range}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
