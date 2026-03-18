/**
 * CommandHeadlineBanner
 *
 * A single decisive GM headline above Critical Actions.
 * Reads like an operator insight, not a data report.
 * Three severity states: good / warning / urgent.
 *
 * Keep slim. Never more than one line of headline + optional subtext.
 */

import { cn } from "@/lib/utils";
import type { CommandHeadline } from "@/lib/commandCenter";

const SEVERITY_STYLES: Record<CommandHeadline["severity"], {
  wrapper: string;
  dot:     string;
  text:    string;
  sub:     string;
}> = {
  good: {
    wrapper: "border-emerald-200 bg-emerald-50",
    dot:     "bg-emerald-500",
    text:    "text-emerald-800",
    sub:     "text-emerald-600",
  },
  warning: {
    wrapper: "border-amber-200 bg-amber-50",
    dot:     "bg-amber-500",
    text:    "text-amber-900",
    sub:     "text-amber-700",
  },
  urgent: {
    wrapper: "border-red-200 bg-red-50",
    dot:     "bg-red-500",
    text:    "text-red-900",
    sub:     "text-red-700",
  },
};

interface Props {
  headline: CommandHeadline;
}

export default function CommandHeadlineBanner({ headline }: Props) {
  const cfg = SEVERITY_STYLES[headline.severity];
  return (
    <div className={cn(
      "flex items-start gap-3 rounded-xl border px-5 py-3.5",
      cfg.wrapper,
    )}>
      <span
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          cfg.dot,
          headline.severity === "urgent" && "animate-pulse",
        )}
      />
      <div className="min-w-0">
        <p className={cn("text-sm font-semibold leading-snug", cfg.text)}>
          {headline.text}
        </p>
        {headline.subtext && (
          <p className={cn("mt-0.5 text-xs leading-snug", cfg.sub)}>
            {headline.subtext}
          </p>
        )}
      </div>
    </div>
  );
}
