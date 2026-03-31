/**
 * CommandFeed — The heart of the Operating Brain.
 *
 * Renders max 5 intelligent briefing items, each with severity,
 * title, explanation, recommended action, impact, and confidence.
 * Feels like an intelligent briefing, not an alert dump.
 */

"use client";

import { cn } from "@/lib/utils";
import type { OperatingDecision } from "@/services/decision-engine";

type Props = {
  decisions: OperatingDecision[];
};

const SEV_STYLES: Record<
  OperatingDecision["severity"],
  { badge: string; border: string; dot: string }
> = {
  critical: {
    badge: "bg-red-500/15 text-red-400 border-red-500/20",
    border: "border-l-red-500",
    dot: "bg-red-400 animate-pulse",
  },
  high: {
    badge: "bg-orange-500/15 text-orange-400 border-orange-500/20",
    border: "border-l-orange-400",
    dot: "bg-orange-400",
  },
  medium: {
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    border: "border-l-amber-400",
    dot: "bg-amber-400",
  },
  low: {
    badge: "bg-stone-500/15 text-stone-400 border-stone-600/20",
    border: "border-l-stone-600",
    dot: "bg-stone-500",
  },
};

const CAT_LABEL: Record<OperatingDecision["category"], string> = {
  revenue: "Revenue",
  labour: "Labour",
  maintenance: "Maintenance",
  compliance: "Compliance",
  service: "Service",
  forecast: "Forecast",
};

function ConfidencePips({ level }: { level?: "low" | "medium" | "high" }) {
  if (!level) return null;
  const fill = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="flex items-center gap-0.5 ml-2" title={`${level} confidence`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            "h-1 w-3 rounded-full",
            n <= fill ? "bg-emerald-500/60" : "bg-stone-700",
          )}
        />
      ))}
    </span>
  );
}

export default function CommandFeed({ decisions }: Props) {
  if (decisions.length === 0) {
    return (
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 px-5 py-8 text-center">
        <p className="text-sm text-stone-500">No active decisions — operations are clear</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Command Feed
      </h2>
      <div className="space-y-2">
        {decisions.map((d) => {
          const sev = SEV_STYLES[d.severity];
          return (
            <div
              key={d.id}
              className={cn(
                "rounded-lg border border-stone-800/40 bg-stone-900/50 border-l-[3px] px-4 py-3.5",
                sev.border,
              )}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border",
                      sev.badge,
                    )}
                  >
                    {d.severity}
                  </span>
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                    {CAT_LABEL[d.category]}
                  </span>
                </div>
                <div className="flex items-center">
                  {d.due && (
                    <span className="text-[10px] text-stone-500 font-mono">
                      Due: {d.due}
                    </span>
                  )}
                  <ConfidencePips level={d.confidence} />
                </div>
              </div>

              {/* Title */}
              <h3 className="mt-2 text-sm font-semibold text-stone-100 leading-snug">
                {d.title}
              </h3>

              {/* Explanation */}
              <p className="mt-1 text-xs text-stone-400 leading-relaxed">
                {d.explanation}
              </p>

              {/* Action */}
              <div className="mt-2.5 flex items-start gap-2">
                <span className="text-[10px] uppercase tracking-wider text-stone-500 font-medium shrink-0 mt-0.5">
                  Action
                </span>
                <span className="text-xs text-stone-300 font-medium">
                  {d.action}
                </span>
              </div>

              {/* Impact */}
              {d.impact && (
                <div className="mt-2 flex items-center gap-2">
                  <ImpactPill impact={d.impact} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ImpactPill({
  impact,
}: {
  impact: NonNullable<OperatingDecision["impact"]>;
}) {
  const styles: Record<string, string> = {
    revenue_protected: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    cost_saved: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    service_risk: "bg-red-500/10 text-red-400 border-red-500/20",
    compliance_risk: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium border",
        styles[impact.type] ?? "bg-stone-800 text-stone-400",
      )}
    >
      {impact.label}
    </span>
  );
}
