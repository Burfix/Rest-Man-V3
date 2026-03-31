/**
 * BrainTopDecisions — Top 3 actions from the Brain's action queue.
 *
 * Replaces the original TopDecisions (which drew from copilot.decisions)
 * in the GM Co-Pilot page.
 */

import { cn } from "@/lib/utils";
import type { BrainOutput } from "@/services/brain/operating-brain";

type Props = {
  brain: BrainOutput;
};

function fmt(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

export default function BrainTopDecisions({ brain }: Props) {
  const top3 = brain.actionQueue.slice(0, 3);

  if (top3.length === 0) {
    return (
      <div className="border border-[#1a1a1a] bg-[#0f0f0f] px-4 py-3">
        <p className="text-[11px] text-stone-600 font-mono">
          No actions required. All systems nominal.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-[#1a1a1a] bg-[#0f0f0f]">
      {/* Header */}
      <div className="px-4 py-2 border-b border-[#1a1a1a]">
        <span className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold">
          TOP DECISIONS
        </span>
      </div>

      {/* Actions */}
      <div className="divide-y divide-[#1a1a1a]">
        {top3.map((action) => (
          <div key={action.priority} className="px-4 py-3 flex gap-3">
            <span className="text-[10px] font-black font-mono text-stone-600 w-5 shrink-0 mt-[1px]">
              {action.priority}.
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-[12px] font-semibold text-stone-200 leading-snug">
                {action.title}
              </p>
              <p className="text-[10px] text-stone-500 leading-relaxed">{action.why}</p>
              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                <span className="text-[10px] font-mono text-stone-600">{action.owner}</span>
                <span className="text-stone-700">·</span>
                <span className="text-[10px] font-mono text-stone-600">~{action.estimatedMinutes} min</span>
                {action.moneyAtRisk != null && action.moneyAtRisk > 0 && (
                  <>
                    <span className="text-stone-700">·</span>
                    <span className="text-[10px] font-mono text-amber-500/70">
                      {fmt(action.moneyAtRisk)} at risk
                    </span>
                  </>
                )}
              </div>
              {/* Impact line */}
              <p className={cn(
                "text-[10px] text-stone-600 leading-snug italic pt-0.5",
              )}>
                {action.impact}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Do-nothing consequences */}
      {brain.doNothingConsequences.length > 0 && (
        <div className="border-t border-[#1a1a1a] px-4 py-3 space-y-1.5 opacity-50 hover:opacity-100 transition-opacity">
          <span className="text-[9px] uppercase tracking-wider text-red-500/70 font-semibold block">
            IF IGNORED
          </span>
          {brain.doNothingConsequences.slice(0, 3).map((c, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-[10px] font-mono text-stone-600 shrink-0 w-20">{c.timeframe}</span>
              <span className="text-[10px] text-red-300/70 leading-snug">{c.consequence}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
