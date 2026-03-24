/**
 * ActionImpactPill — Small impact badge for action rows.
 *
 * Revenue protected / Service protected / Cost saved / Monitor only
 */

"use client";

import { cn } from "@/lib/utils";

export type ImpactType =
  | "revenue_protected"
  | "service_protected"
  | "cost_saved"
  | "compliance_risk"
  | "monitor";

type Props = {
  type: ImpactType;
  label?: string;
};

const STYLES: Record<ImpactType, { bg: string; text: string; defaultLabel: string }> = {
  revenue_protected: {
    bg: "bg-emerald-500/10 border-emerald-500/20",
    text: "text-emerald-400",
    defaultLabel: "Revenue protected",
  },
  service_protected: {
    bg: "bg-blue-500/10 border-blue-500/20",
    text: "text-blue-400",
    defaultLabel: "Service protected",
  },
  cost_saved: {
    bg: "bg-sky-500/10 border-sky-500/20",
    text: "text-sky-400",
    defaultLabel: "Cost saved",
  },
  compliance_risk: {
    bg: "bg-rose-500/10 border-rose-500/20",
    text: "text-rose-400",
    defaultLabel: "Compliance risk",
  },
  monitor: {
    bg: "bg-stone-500/10 border-stone-600/20",
    text: "text-stone-400",
    defaultLabel: "Monitor",
  },
};

export default function ActionImpactPill({ type, label }: Props) {
  const cfg = STYLES[type];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border",
        cfg.bg,
        cfg.text,
      )}
    >
      {label ?? cfg.defaultLabel}
    </span>
  );
}
