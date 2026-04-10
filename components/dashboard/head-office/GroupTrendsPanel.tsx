/**
 * GroupTrendsPanel
 *
 * 7-day trend sparklines for three group metrics: Revenue, Labour %, and
 * Operating Score — one line per store, colour-coded.
 * Uses inline SVG so no chart library is required.
 */

import { cn } from "@/lib/utils";
import type { GroupTrends, StoreTrendLine, DailyTrendPoint } from "@/services/ops/headOffice";

// ── Store colour palette (supports up to 6 stores) ───────────────────────────

const STORE_COLORS = [
  "#3b82f6", // blue-500
  "#8b5cf6", // violet-500
  "#f59e0b", // amber-500
  "#10b981", // emerald-500
  "#ef4444", // red-500
  "#ec4899", // pink-500
];

// ── Biggest mover helper ─────────────────────────────────────────────────────

function biggestMover(
  lines: StoreTrendLine[]
): { name: string; delta: number } | null {
  let best: { name: string; delta: number } | null = null;
  for (const line of lines) {
    const valid = line.points.filter((p): p is { date: string; value: number } => p.value !== null);
    if (valid.length < 2) continue;
    const delta = valid[valid.length - 1].value - valid[0].value;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = { name: line.name, delta };
    }
  }
  return best;
}

// ── SVG Sparkline ─────────────────────────────────────────────────────────────

const SVG_W = 200;
const SVG_H = 52;
const PAD   = 4;

function Sparkline({
  lines,
  yMin,
  yMax,
  threshold,    // optional horizontal warning line
  thresholdColor,
}: {
  lines:          { points: DailyTrendPoint[]; color: string }[];
  yMin:           number;
  yMax:           number;
  threshold?:     number;
  thresholdColor?: string;
}) {
  const range = yMax - yMin || 1;
  const plotH = SVG_H - PAD * 2;
  const plotW = SVG_W - PAD * 2;

  function toX(i: number, total: number) {
    if (total <= 1) return PAD + plotW / 2;
    return PAD + (i / (total - 1)) * plotW;
  }

  function toY(v: number) {
    return PAD + plotH - ((v - yMin) / range) * plotH;
  }

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      className="w-full h-13"
      aria-hidden
    >
      {/* Threshold line */}
      {threshold !== undefined && threshold >= yMin && threshold <= yMax && (
        <line
          x1={PAD}
          y1={toY(threshold)}
          x2={SVG_W - PAD}
          y2={toY(threshold)}
          stroke={thresholdColor ?? "#ef4444"}
          strokeWidth={1}
          strokeDasharray="3 2"
          opacity={0.5}
        />
      )}

      {/* Store lines */}
      {lines.map(({ points, color }, lineIdx) => {
        const validPts = points.filter((p) => p.value !== null);
        if (validPts.length < 2) return null;
        const d = validPts
          .map((p, i) =>
            `${i === 0 ? "M" : "L"} ${toX(i, validPts.length).toFixed(1)} ${toY(p.value as number).toFixed(1)}`
          )
          .join(" ");
        return (
          <path
            key={lineIdx}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}

      {/* Terminal dots */}
      {lines.map(({ points, color }, lineIdx) => {
        const validPts = points.filter((p) => p.value !== null);
        if (validPts.length === 0) return null;
        const last = validPts[validPts.length - 1];
        return (
          <circle
            key={`dot-${lineIdx}`}
            cx={toX(validPts.length - 1, validPts.length).toFixed(1)}
            cy={toY(last.value as number).toFixed(1)}
            r={2.5}
            fill={color}
          />
        );
      })}
    </svg>
  );
}

// ── Single chart panel ────────────────────────────────────────────────────────

function TrendChart({
  title,
  icon,
  trendLines,
  formatValue,
  yMinOverride,
  yMaxOverride,
  threshold,
  thresholdColor,
  moverLabel,
}: {
  title:          string;
  icon:           string;
  trendLines:     StoreTrendLine[];
  formatValue:    (v: number) => string;
  yMinOverride?:  number;
  yMaxOverride?:  number;
  threshold?:     number;
  thresholdColor?: string;
  moverLabel?:    string;
}) {
  // Compute y-axis range across all store lines
  const allValues = trendLines
    .flatMap((l) => l.points.map((p) => p.value))
    .filter((v): v is number => v !== null);

  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 100;
  const yMin   = yMinOverride ?? Math.max(0, rawMin - Math.max(5, (rawMax - rawMin) * 0.1));
  const yMax   = yMaxOverride ?? rawMax + Math.max(5, (rawMax - rawMin) * 0.1);

  const lines = trendLines.map((tl, i) => ({
    points: tl.points,
    color:  STORE_COLORS[i % STORE_COLORS.length],
  }));

  // Latest values per store for the summary
  const latest = trendLines.map((tl, i) => ({
    name:  tl.name,
    color: STORE_COLORS[i % STORE_COLORS.length],
    value: [...tl.points].reverse().find((p) => p.value !== null)?.value ?? null,
  }));

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">

      {/* Title */}
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-500 mb-3 flex items-center gap-1.5">
        <span>{icon}</span> {title}
      </p>

      {/* Chart */}
      <Sparkline
        lines={lines}
        yMin={yMin}
        yMax={yMax}
        threshold={threshold}
        thresholdColor={thresholdColor}
      />

      {/* Legend */}
      <div className="mt-3 space-y-1">
        {latest.map((l) => (
          <div key={l.name} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2 w-4 rounded-full shrink-0"
                style={{ backgroundColor: l.color }}
              />
              <span className="text-[10px] text-stone-500 dark:text-stone-400 truncate">{l.name}</span>
            </div>
            <span className="text-[10px] font-semibold text-stone-700 dark:text-stone-300 tabular-nums shrink-0">
              {l.value !== null ? formatValue(l.value) : "—"}
            </span>
          </div>
        ))}
      </div>

      {/* Biggest mover annotation */}
      {moverLabel && (
        <p className="mt-2 text-[10px] font-semibold text-blue-600 dark:text-blue-400 border-t border-stone-100 dark:border-stone-800 pt-2">
          📊 {moverLabel}
        </p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  trends: GroupTrends;
}

export default function GroupTrendsPanel({ trends }: Props) {
  const revMover   = biggestMover(trends.revenue);
  const labMover   = biggestMover(trends.labour);
  const scoreMover = biggestMover(trends.risk_score);

  function revMoverLabel(m: typeof revMover) {
    if (!m) return undefined;
    const sign = m.delta >= 0 ? "+" : "";
    return `${m.name} moved most — ${sign}R${Math.round(Math.abs(m.delta) / 1000)}k over 7d`;
  }
  function labMoverLabel(m: typeof labMover) {
    if (!m) return undefined;
    const sign = m.delta >= 0 ? "+" : "−";
    return `${m.name} drove labour ${m.delta >= 0 ? "up" : "down"} ${sign}${Math.abs(m.delta).toFixed(1)}pp`;
  }
  function scoreMoverLabel(m: typeof scoreMover) {
    if (!m) return undefined;
    const sign = m.delta >= 0 ? "+" : "";
    return `${m.name} ${m.delta >= 0 ? "improved" : "declined"} most — ${sign}${Math.round(m.delta)} pts`;
  }
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-500 dark:text-stone-400">
          7-Day Trends
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TrendChart
          title="Revenue"
          icon="💰"
          trendLines={trends.revenue}
          formatValue={(v) => `R${Math.round(v / 1000)}k`}
          moverLabel={revMoverLabel(revMover)}
        />

        <TrendChart
          title="Labour %"
          icon="👥"
          trendLines={trends.labour}
          formatValue={(v) => `${v.toFixed(1)}%`}
          threshold={35}
          thresholdColor="#ef4444"
          yMinOverride={20}
          yMaxOverride={50}
          moverLabel={labMoverLabel(labMover)}
        />

        <TrendChart
          title="Ops Score"
          icon="⚡"
          trendLines={trends.risk_score}
          formatValue={(v) => String(Math.round(v))}
          yMinOverride={0}
          yMaxOverride={100}
          threshold={70}
          thresholdColor="#f59e0b"
          moverLabel={scoreMoverLabel(scoreMover)}
        />
      </div>
    </section>
  );
}
