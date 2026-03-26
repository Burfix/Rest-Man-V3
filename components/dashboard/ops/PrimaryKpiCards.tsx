/**
 * PrimaryKpiCards — 2 large KPI cards in a side-by-side grid.
 *
 * A. Compliance Risk
 * B. Maintenance Control
 *
 * Each card: plain white header + large primary metric + compact stat strip + footer summary line.
 * Revenue and Service data moved to the secondary grid.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import StatusChip from "@/components/ui/StatusChip";
import EmptyStateBlock from "@/components/ui/EmptyStateBlock";
import type {
  ComplianceSummary,
  MaintenanceSummary,
  RevenueForecast,
  TodayBookingsSummary,
  VenueEvent,
} from "@/types";

interface Props {
  compliance:  ComplianceSummary;
  maintenance: MaintenanceSummary;
  forecast:    RevenueForecast | null;
  today:       TodayBookingsSummary;
  events:      VenueEvent[];
  date:        string; // YYYY-MM-DD
}

export default function PrimaryKpiCards({
  compliance,
  maintenance,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <ComplianceCard  compliance={compliance} />
      <MaintenanceCard maintenance={maintenance} />
    </div>
  );
}

// ── Card shell ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  urgency = "none",
  chip,
  chipVariant,
  children,
  footer,
  cta,
  ctaHref,
}: {
  title:        string;
  urgency?:     "critical" | "warning" | "none";
  chip?:        string;
  chipVariant?: "critical" | "warning" | "ok" | "neutral";
  children:     React.ReactNode;
  footer?:      React.ReactNode;
  cta:          string;
  ctaHref:      string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-white dark:bg-stone-900 overflow-hidden",
        urgency === "critical" ? "border-red-200 dark:border-red-900"     :
        urgency === "warning"  ? "border-amber-200 dark:border-amber-900" :
        "border-stone-200 dark:border-stone-800"
      )}
    >
      {/* Header — plain white, no tinted background */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">{title}</span>
        {chip && chipVariant && (
          <StatusChip variant={chipVariant} size="xs" dot>
            {chip}
          </StatusChip>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 px-5 py-5">{children}</div>

      {/* Footer summary line */}
      {footer && (
        <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3">
          {footer}
        </div>
      )}

      {/* CTA */}
      <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3">
        <Link
          href={ctaHref}
          className={cn(
            "text-xs font-medium hover:underline transition-colors",
            urgency === "critical" ? "text-red-700" :
            urgency === "warning"  ? "text-amber-700" :
            "text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
          )}
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}

// ── Inline stat strip (horizontal row) ────────────────────────────────────────

function StatStrip({ items }: {
  items: { label: string; value: string | number; highlight?: "red" | "amber" | "green" }[]
}) {
  return (
    <div className="mt-4 grid grid-cols-4 gap-px border border-stone-100 dark:border-stone-800 rounded-lg overflow-hidden">
      {items.map((item) => (
        <div key={item.label} className="bg-stone-50 dark:bg-stone-800 px-3 py-2.5 text-center">
          <p className={cn(
            "text-sm font-bold tabular-nums",
            item.highlight === "red"   ? "text-red-600"     :
            item.highlight === "amber" ? "text-amber-600"   :
            item.highlight === "green" ? "text-emerald-600" :
            "text-stone-800 dark:text-stone-200"
          )}>
            {item.value}
          </p>
          <p className="text-[9px] text-stone-400 dark:text-stone-600 leading-tight mt-0.5 uppercase tracking-wide">
            {item.label}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── A. Compliance Risk ────────────────────────────────────────────────────────

function ComplianceCard({ compliance }: { compliance: ComplianceSummary }) {
  const isRed   = compliance.expired > 0;
  const isAmber = !isRed && compliance.due_soon > 0;

  const scoreColor =
    isRed   ? "text-red-600"   :
    isAmber ? "text-amber-600" :
    "text-emerald-600";

  const barColor =
    isRed   ? "bg-red-500"     :
    isAmber ? "bg-amber-400"   :
    "bg-emerald-500";

  const chip =
    isRed   ? `${compliance.expired} expired`   :
    isAmber ? `${compliance.due_soon} due soon` :
    "All current";

  const chipVariant =
    isRed ? "critical" : isAmber ? "warning" : "ok";

  // Footer: next critical item due date
  const nextItem = compliance.critical_items[0] ?? compliance.due_soon_items[0] ?? null;
  const footer = nextItem ? (
    <p className="text-[11px] text-stone-500">
      Next risk:{" "}
      <span className="font-semibold text-stone-700">{nextItem.display_name}</span>
      {nextItem.next_due_date && (
        <span className={cn(
          "ml-1",
          isRed ? "text-red-600" : "text-amber-600"
        )}>— due {nextItem.next_due_date}</span>
      )}
    </p>
  ) : compliance.total > 0 ? (
    <p className="text-[11px] text-emerald-600 font-medium">✓ All certificates current</p>
  ) : null;

  return (
    <KpiCard
      title="Compliance Risk"
      urgency={isRed ? "critical" : isAmber ? "warning" : "none"}
      chip={chip}
      chipVariant={chipVariant}
      footer={footer}
      cta="View compliance hub →"
      ctaHref="/dashboard/compliance"
    >
      {compliance.total === 0 ? (
        <EmptyStateBlock compact icon="📋" title="No certificates tracked" body="Add compliance items to monitor expiry dates." />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className={cn("text-5xl font-bold tabular-nums leading-none", scoreColor)}>
              {compliance.compliance_pct}%
            </span>
            <span className="text-xs text-stone-400 dark:text-stone-600">compliant</span>
          </div>

          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
            <div
              className={cn("h-1.5 rounded-full transition-all", barColor)}
              style={{ width: `${compliance.compliance_pct}%` }}
            />
          </div>

          <StatStrip items={[
            { label: "Total",     value: compliance.total },
            { label: "Compliant", value: compliance.compliant,  highlight: "green" },
            { label: "Due soon",  value: compliance.due_soon,   highlight: compliance.due_soon > 0 ? "amber" : undefined },
            { label: "Expired",   value: compliance.expired,    highlight: compliance.expired > 0 ? "red" : undefined },
          ]} />
        </>
      )}
    </KpiCard>
  );
}

// ── B. Maintenance Control ────────────────────────────────────────────────────

function MaintenanceCard({ maintenance }: { maintenance: MaintenanceSummary }) {
  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;
  const isRed   = maintenance.outOfService > 0;
  const isAmber = !isRed && totalOpen > 0;

  const scoreColor =
    isRed   ? "text-red-600"   :
    isAmber ? "text-amber-600" :
    "text-emerald-600";

  const chip =
    isRed   ? `${maintenance.outOfService} out of service` :
    isAmber ? `${totalOpen} open`                          :
    "All operational";

  const chipVariant =
    isRed ? "critical" : isAmber ? "warning" : "ok";

  const latestIssue = maintenance.urgentIssues[0] ?? null;

  const footer = latestIssue ? (
    <p className="text-[11px] text-stone-500">
      Urgent:{" "}
      <span className="font-semibold text-stone-700">{latestIssue.unit_name}</span>
      <span className="text-stone-400"> — {latestIssue.issue_title}</span>
    </p>
  ) : maintenance.totalEquipment > 0 ? (
    <p className="text-[11px] text-emerald-600 font-medium">✓ No urgent issues</p>
  ) : null;

  return (
    <KpiCard
      title="Maintenance Control"
      urgency={isRed ? "critical" : isAmber ? "warning" : "none"}
      chip={chip}
      chipVariant={chipVariant}
      footer={footer}
      cta="Open maintenance board →"
      ctaHref="/dashboard/maintenance"
    >
      {maintenance.totalEquipment === 0 ? (
        <EmptyStateBlock compact icon="🔧" title="No equipment tracked" body="Add equipment to monitor maintenance status." />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className={cn("text-5xl font-bold tabular-nums leading-none", scoreColor)}>
              {totalOpen}
            </span>
            <span className="text-xs text-stone-400 dark:text-stone-600">open issues</span>
          </div>

          <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-600">
            {maintenance.totalEquipment} units tracked
          </p>

          <StatStrip items={[
            { label: "Open",       value: maintenance.openRepairs,   highlight: maintenance.openRepairs > 0 ? "amber" : undefined },
            { label: "In prog.",   value: maintenance.inProgress,    highlight: maintenance.inProgress > 0 ? "amber" : undefined },
            { label: "Awaiting",   value: maintenance.awaitingParts, highlight: maintenance.awaitingParts > 0 ? "amber" : undefined },
            { label: "Out of SVC", value: maintenance.outOfService,  highlight: maintenance.outOfService > 0 ? "red" : undefined },
          ]} />
        </>
      )}
    </KpiCard>
  );
}

