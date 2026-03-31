/**
 * CrossModuleSignalFeed
 *
 * Renders cross-module compound signals at the top of the command feed.
 * Visual distinction from single-module decisions:
 *   — Left border is 6px (double width)
 *   — Module tag row shows all involved modules
 *   — Amber "money at risk" line
 *   — Muted "time window" text
 */

import type { CrossModuleSignal, SignalSeverity, SignalModule } from "@/services/intelligence/signal-detector";

// ── Severity styles ───────────────────────────────────────────────────────────

const SEV_STYLES: Record<
  SignalSeverity,
  { badge: string; border: string; dot: string }
> = {
  CRITICAL: {
    badge:  "bg-red-500/15 text-red-400 border border-red-500/20",
    border: "border-l-red-500",
    dot:    "bg-red-400 animate-pulse",
  },
  HIGH: {
    badge:  "bg-orange-500/15 text-orange-400 border border-orange-500/20",
    border: "border-l-orange-400",
    dot:    "bg-orange-400",
  },
  MEDIUM: {
    badge:  "bg-amber-500/15 text-amber-400 border border-amber-500/20",
    border: "border-l-amber-400",
    dot:    "bg-amber-400",
  },
  INFO: {
    badge:  "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
    border: "border-l-emerald-600",
    dot:    "bg-emerald-500",
  },
};

const MODULE_LABEL: Record<SignalModule, string> = {
  REVENUE:     "REVENUE",
  LABOUR:      "LABOUR",
  OPS:         "OPS",
  MAINTENANCE: "MAINT",
  COMPLIANCE:  "COMPLIANCE",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ModuleTags({ modules }: { modules: SignalModule[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {modules.map((m, i) => (
        <span key={m} className="flex items-center gap-0.5">
          <span className="font-mono text-[9px] tracking-widest text-stone-400 uppercase">
            {MODULE_LABEL[m]}
          </span>
          {i < modules.length - 1 && (
            <span className="text-stone-700 text-[9px] mx-0.5">·</span>
          )}
        </span>
      ))}
    </div>
  );
}

function SignalCard({ signal }: { signal: CrossModuleSignal }) {
  const sev = SEV_STYLES[signal.severity];

  return (
    <div
      className={`
        group rounded-sm border border-stone-800/40 bg-[#0f0f0f]
        ${sev.border} border-l-[6px]
        px-4 py-3 space-y-2
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${sev.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
            {signal.severity}
          </span>
          <span className="text-stone-700 text-[9px] font-mono tracking-widest uppercase">
            CROSS-MODULE
          </span>
        </div>
        {signal.timeWindow && (
          <span className="text-[10px] text-stone-600 font-mono">
            {signal.timeWindow}
          </span>
        )}
      </div>

      {/* Module tags */}
      <ModuleTags modules={signal.modules} />

      {/* Title */}
      <p className="text-sm font-semibold text-stone-100 leading-snug">
        {signal.title}
      </p>

      {/* Recommendation */}
      <p className="text-[11px] text-stone-400 leading-relaxed">
        {signal.recommendation}
      </p>

      {/* Money at risk */}
      {signal.moneyAtRisk != null && signal.moneyAtRisk > 0 && (
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[9px] font-mono tracking-widest text-stone-600 uppercase">
            Money at risk
          </span>
          <span className="text-[11px] font-mono font-semibold text-amber-400">
            R{Math.round(signal.moneyAtRisk).toLocaleString("en-ZA")}
          </span>
        </div>
      )}

      {/* Confidence */}
      <div className="flex items-center gap-2 pt-0.5 opacity-50">
        <span className="text-[9px] font-mono tracking-widest text-stone-600 uppercase">
          Confidence
        </span>
        <span className="text-[10px] font-mono text-stone-500">
          {signal.confidence}%
        </span>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  signals: CrossModuleSignal[];
  variant?: "command-center" | "copilot";
}

export default function CrossModuleSignalFeed({ signals, variant = "command-center" }: Props) {
  if (signals.length === 0) return null;

  // Filter out INFO from command-center by default (reduce noise)
  const visible = variant === "command-center"
    ? signals.filter((s) => s.severity !== "INFO")
    : signals;

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Section header */}
      <div className="flex items-center gap-3 px-0.5">
        <span className="text-[9px] font-mono tracking-[0.15em] text-stone-600 uppercase">
          Cross-Module Signals
        </span>
        <div className="flex-1 h-px bg-stone-800/60" />
        <span className="text-[9px] font-mono text-stone-700">
          {visible.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {visible.map((signal) => (
          <SignalCard key={signal.id} signal={signal} />
        ))}
      </div>
    </div>
  );
}
