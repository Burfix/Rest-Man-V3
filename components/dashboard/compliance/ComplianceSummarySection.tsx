import Link from "next/link";
import { cn, formatShortDate } from "@/lib/utils";
import type { ComplianceSummary } from "@/types";

interface Props {
  summary: ComplianceSummary;
}

export default function ComplianceSummarySection({ summary }: Props) {
  const pct = summary.compliance_pct;
  const allGood = summary.expired === 0 && summary.due_soon === 0 && summary.unknown === 0;

  const barColor =
    summary.expired > 0 ? "bg-red-500" :
    summary.due_soon > 0 ? "bg-amber-500" :
    "bg-emerald-500";

  // Urgency banner config
  const banner =
    summary.expired > 0
      ? {
          bg: "bg-red-600",
          text: "text-white",
          icon: "🚨",
          message:
            summary.expired === 1
              ? "1 compliance certificate expired — immediate action required."
              : `${summary.expired} compliance certificates expired — immediate action required.`,
        }
      : summary.due_soon > 0
      ? {
          bg: "bg-amber-400",
          text: "text-amber-900",
          icon: "⚠",
          message:
            summary.due_soon === 1
              ? "1 compliance item due soon — renew before it lapses."
              : `${summary.due_soon} compliance items due soon — renew before they lapse.`,
        }
      : summary.total > 0
      ? {
          bg: "bg-emerald-500",
          text: "text-white",
          icon: "✓",
          message: "All compliance requirements are current.",
        }
      : null;

  return (
    <section>
      {/* Section header */}
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-stone-900">Compliance Risk</h2>
        <Link
          href="/dashboard/compliance"
          className="text-xs font-medium text-stone-400 hover:text-stone-700"
        >
          Full hub →
        </Link>
      </div>

      {/* Urgency status banner */}
      {banner && (
        <div className={cn("mb-3 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold", banner.bg, banner.text)}>
          <span>{banner.icon}</span>
          <span>{banner.message}</span>
        </div>
      )}

      {/* Summary card */}
      <div className={cn(
        "rounded-xl border bg-white p-4 shadow-sm",
        summary.expired > 0 ? "border-red-200" :
        summary.due_soon > 0 ? "border-amber-200" :
        "border-stone-200"
      )}>
        {/* Score + bar */}
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            <p className={cn(
              "text-3xl font-bold tabular-nums",
              pct >= 80 ? "text-emerald-600" :
              pct >= 50 ? "text-amber-600" :
              "text-red-600"
            )}>
              {pct}%
            </p>
            <p className="text-xs text-stone-400">compliant</p>
          </div>
          <div className="flex-1 space-y-1">
            <div className="h-2 w-full rounded-full bg-stone-100">
              <div
                className={cn("h-2 rounded-full transition-all", barColor)}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-stone-500">
              {summary.compliant} of {summary.total - summary.unknown} categories up-to-date
            </p>
          </div>
        </div>

        {/* Stat row */}
        <div className="mt-3 flex gap-3 text-xs">
          <span className="flex items-center gap-1 text-emerald-600">
            <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
            {summary.compliant} compliant
          </span>
          {summary.due_soon > 0 && (
            <span className="flex items-center gap-1 text-amber-600">
              <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
              {summary.due_soon} due soon
            </span>
          )}
          {summary.expired > 0 && (
            <span className="flex items-center gap-1 text-red-600 font-semibold">
              <span className="h-2 w-2 rounded-full bg-red-500 inline-block" />
              {summary.expired} expired
            </span>
          )}
          {summary.unknown > 0 && (
            <span className="flex items-center gap-1 text-stone-400">
              <span className="h-2 w-2 rounded-full bg-stone-300 inline-block" />
              {summary.unknown} not set up
            </span>
          )}
        </div>

        {/* Critical issues */}
        {summary.expired > 0 && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <p className="text-xs font-semibold text-red-700 mb-1">🚨 Critical — Expired</p>
            <ul className="space-y-0.5">
              {summary.critical_items.slice(0, 3).map((item) => (
                <li key={item.id} className="text-xs text-red-600 flex items-center gap-1.5">
                  <span className="shrink-0">✗</span>
                  <span>{item.display_name}</span>
                  {item.next_due_date && (
                    <span className="text-red-400">(expired {formatShortDate(item.next_due_date)})</span>
                  )}
                </li>
              ))}
              {summary.critical_items.length > 3 && (
                <li className="text-xs text-red-400">
                  +{summary.critical_items.length - 3} more
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Due-soon warnings (when no expired) */}
        {summary.expired === 0 && summary.due_soon > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="text-xs font-semibold text-amber-700 mb-1">⚠ Due Soon</p>
            <ul className="space-y-0.5">
              {summary.due_soon_items.slice(0, 3).map((item) => (
                <li key={item.id} className="text-xs text-amber-700 flex items-center gap-1.5">
                  <span className="shrink-0">→</span>
                  <span>{item.display_name}</span>
                  {item.next_due_date && (
                    <span className="text-amber-500">({formatShortDate(item.next_due_date)})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* All good */}
        {allGood && summary.total > 0 && (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            ✓ All compliance requirements are up-to-date.
          </p>
        )}

        {/* Empty state */}
        {summary.total === 0 && (
          <p className="mt-3 text-xs text-stone-400 text-center py-2">
            No compliance data yet.{" "}
            <Link href="/dashboard/compliance" className="text-blue-600 hover:underline">
              Set up the Compliance Hub
            </Link>
          </p>
        )}

        {/* CTA */}
        {(summary.expired > 0 || summary.due_soon > 0 || summary.unknown > 2) && (
          <Link
            href="/dashboard/compliance"
            className="mt-3 block w-full rounded-lg bg-stone-900 px-4 py-2 text-center text-xs font-semibold text-white hover:bg-stone-700 transition-colors"
          >
            Manage Compliance →
          </Link>
        )}
      </div>
    </section>
  );
}
