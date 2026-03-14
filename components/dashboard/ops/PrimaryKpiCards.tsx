/**
 * PrimaryKpiCards — 4 large KPI cards rendered as a 2×2 (mobile) → 4-col (xl) grid.
 *
 * A. Compliance Risk        B. Maintenance Control
 * C. Revenue Today          D. Events & Service Today
 *
 * Each card: header + big metric + sub-stats grid + divider + CTA link.
 */

import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import StatusChip from "@/components/ui/StatusChip";
import EmptyStateBlock from "@/components/ui/EmptyStateBlock";
import type {
  ComplianceSummary,
  MaintenanceSummary,
  RevenueForecast,
  TodayBookingsSummary,
  VenueEvent,
  DailyOperationsDashboardSummary,
} from "@/types";

interface Props {
  compliance:  ComplianceSummary;
  maintenance: MaintenanceSummary;
  forecast:    RevenueForecast | null;
  today:       TodayBookingsSummary;
  events:      VenueEvent[];
  dailyOps:    DailyOperationsDashboardSummary;
  date:        string; // YYYY-MM-DD
}

export default function PrimaryKpiCards({
  compliance,
  maintenance,
  forecast,
  today,
  events,
  dailyOps,
  date,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <ComplianceCard  compliance={compliance} />
      <MaintenanceCard maintenance={maintenance} />
      <RevenueCard     forecast={forecast} dailyOps={dailyOps} />
      <ServiceCard     today={today} events={events} date={date} />
    </div>
  );
}

// ── Shared card shell ──────────────────────────────────────────────────────────

function KpiCard({
  title,
  icon,
  urgency = "none",
  chip,
  chipVariant,
  children,
  cta,
  ctaHref,
}: {
  title:        string;
  icon:         string;
  urgency?:     "critical" | "warning" | "none";
  chip?:        string;
  chipVariant?: "critical" | "warning" | "ok" | "neutral";
  children:     React.ReactNode;
  cta:          string;
  ctaHref:      string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-white shadow-sm overflow-hidden",
        urgency === "critical" ? "border-red-200"   :
        urgency === "warning"  ? "border-amber-200" :
        "border-stone-200"
      )}
    >
      {/* Card header */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3 border-b",
          urgency === "critical" ? "bg-red-50 border-red-100" :
          urgency === "warning"  ? "bg-amber-50 border-amber-100" :
          "bg-stone-50 border-stone-100"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-500">
            {title}
          </span>
        </div>
        {chip && chipVariant && (
          <StatusChip variant={chipVariant} size="xs" dot>
            {chip}
          </StatusChip>
        )}
      </div>

      {/* Card body */}
      <div className="flex-1 p-4">{children}</div>

      {/* Card footer CTA */}
      <div className={cn(
        "border-t px-4 py-3",
        urgency === "critical" ? "border-red-100 bg-red-50" :
        urgency === "warning"  ? "border-amber-100 bg-amber-50" :
        "border-stone-100"
      )}>
        <Link
          href={ctaHref}
          className={cn(
            "inline-flex items-center gap-1 text-xs font-semibold hover:underline",
            urgency === "critical" ? "text-red-700" :
            urgency === "warning"  ? "text-amber-700" :
            "text-stone-700"
          )}
        >
          {cta} <span className="opacity-60">→</span>
        </Link>
      </div>
    </div>
  );
}

// ── Stat grid row (2 cols) ─────────────────────────────────────────────────────

function StatGrid({ items }: { items: { label: string; value: string | number; highlight?: "red" | "amber" | "green" }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-stone-50 px-3 py-2">
          <p className={cn(
            "text-base font-bold tabular-nums",
            item.highlight === "red"   ? "text-red-600"   :
            item.highlight === "amber" ? "text-amber-600" :
            item.highlight === "green" ? "text-emerald-600" :
            "text-stone-900"
          )}>
            {item.value}
          </p>
          <p className="text-[10px] text-stone-400 leading-snug mt-px">{item.label}</p>
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

  const chip =
    isRed   ? `${compliance.expired} expired` :
    isAmber ? `${compliance.due_soon} due soon` :
    "Compliant";

  const chipVariant =
    isRed ? "critical" : isAmber ? "warning" : "ok";

  return (
    <KpiCard
      title="Compliance Risk"
      icon="📋"
      urgency={isRed ? "critical" : isAmber ? "warning" : "none"}
      chip={chip}
      chipVariant={chipVariant}
      cta="View Compliance Hub"
      ctaHref="/dashboard/compliance"
    >
      {compliance.total === 0 ? (
        <EmptyStateBlock compact icon="📋" title="No certificates tracked" body="Add compliance items to monitor expiry dates." />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className={cn("text-4xl font-bold tabular-nums", scoreColor)}>
              {compliance.compliance_pct}%
            </span>
            <span className="text-xs text-stone-400">overall compliance</span>
          </div>

          {/* progress bar */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
            <div
              className={cn("h-1.5 rounded-full", isRed ? "bg-red-500" : isAmber ? "bg-amber-400" : "bg-emerald-500")}
              style={{ width: `${compliance.compliance_pct}%` }}
            />
          </div>

          <StatGrid items={[
            { label: "Total items",    value: compliance.total },
            { label: "Compliant",      value: compliance.compliant, highlight: "green" },
            { label: "Expired",        value: compliance.expired,  highlight: compliance.expired > 0 ? "red" : undefined },
            { label: "Due within 30d", value: compliance.due_soon, highlight: compliance.due_soon > 0 ? "amber" : undefined },
          ]} />

          {/* Top critical item */}
          {compliance.critical_items.length > 0 && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-0.5">
                Most urgent
              </p>
              <p className="text-xs font-semibold text-red-800 leading-snug">
                {compliance.critical_items[0].display_name}
              </p>
              {compliance.critical_items[0].next_due_date && (
                <p className="text-[10px] text-red-500 mt-0.5">
                  Due {compliance.critical_items[0].next_due_date}
                </p>
              )}
            </div>
          )}
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

  const chip =
    isRed   ? `${maintenance.outOfService} out of service` :
    isAmber ? `${totalOpen} open` :
    "All operational";

  const chipVariant =
    isRed ? "critical" : isAmber ? "warning" : "ok";

  const latestIssue = maintenance.urgentIssues[0] ?? null;

  return (
    <KpiCard
      title="Maintenance Control"
      icon="🔧"
      urgency={isRed ? "critical" : isAmber ? "warning" : "none"}
      chip={chip}
      chipVariant={chipVariant}
      cta="Open Maintenance Board"
      ctaHref="/dashboard/maintenance"
    >
      {maintenance.totalEquipment === 0 ? (
        <EmptyStateBlock compact icon="🔧" title="No equipment tracked" body="Add equipment to monitor maintenance status." />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className={cn(
              "text-4xl font-bold tabular-nums",
              isRed ? "text-red-600" : isAmber ? "text-amber-600" : "text-emerald-600"
            )}>
              {totalOpen}
            </span>
            <span className="text-xs text-stone-400">open issues</span>
          </div>

          <StatGrid items={[
            { label: "Equipment",   value: maintenance.totalEquipment },
            { label: "Out of SVC",  value: maintenance.outOfService, highlight: maintenance.outOfService > 0 ? "red" : undefined },
            { label: "In Progress", value: maintenance.inProgress,   highlight: maintenance.inProgress > 0 ? "amber" : undefined },
            { label: "Awaiting",    value: maintenance.awaitingParts, highlight: maintenance.awaitingParts > 0 ? "amber" : undefined },
          ]} />

          {latestIssue && (
            <div className={cn(
              "mt-3 rounded-lg border px-3 py-2",
              latestIssue.priority === "urgent" ? "bg-red-50 border-red-100" : "bg-amber-50 border-amber-100"
            )}>
              <p className={cn(
                "text-[10px] font-bold uppercase tracking-wider mb-0.5",
                latestIssue.priority === "urgent" ? "text-red-500" : "text-amber-600"
              )}>
                Latest urgent issue
              </p>
              <p className="text-xs font-semibold text-stone-800 leading-snug">
                {latestIssue.unit_name}
              </p>
              <p className="text-[10px] text-stone-500 mt-px">{latestIssue.issue_title}</p>
            </div>
          )}
        </>
      )}
    </KpiCard>
  );
}

// ── C. Revenue Today ─────────────────────────────────────────────────────────

function RevenueCard({
  forecast,
  dailyOps,
}: {
  forecast: RevenueForecast | null;
  dailyOps: DailyOperationsDashboardSummary;
}) {
  const gapPct = forecast?.sales_gap_pct ?? null;
  const isRed   = forecast !== null && gapPct !== null && gapPct < -20;
  const isAmber = forecast !== null && gapPct !== null && gapPct < 0 && !isRed;
  const isGreen = forecast !== null && gapPct !== null && gapPct >= 0;

  const chip =
    !forecast          ? "No forecast" :
    isRed              ? `▼ ${Math.abs(gapPct!).toFixed(1)}% below` :
    isAmber            ? `▼ ${Math.abs(gapPct!).toFixed(1)}% below` :
    isGreen            ? "On track" :
    "No target";

  const chipVariant =
    isRed   ? "critical" as const :
    isAmber ? "warning"  as const :
    isGreen ? "ok"       as const :
    "neutral" as const;

  const report   = dailyOps.latestReport;
  const avgSpend = report?.guests_average_spend ?? null;
  const margin   = report?.margin_percent ?? null;

  return (
    <KpiCard
      title="Revenue Today"
      icon="📈"
      urgency={isRed ? "critical" : isAmber ? "warning" : "none"}
      chip={chip}
      chipVariant={chipVariant}
      cta="View Revenue Intelligence"
      ctaHref="/dashboard/settings/targets"
    >
      {!forecast ? (
        <EmptyStateBlock compact icon="📈" title="No forecast data" body="Set a revenue target to enable forecasting." cta={{ label: "Set target", href: "/dashboard/settings/targets" }} />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums text-stone-900">
              {formatCurrency(forecast.forecast_sales)}
            </span>
          </div>
          <p className="text-xs text-stone-400 mt-0.5">forecast sales today</p>

          {forecast.target_sales && (
            <p className={cn(
              "mt-1.5 text-xs font-semibold",
              isRed   ? "text-red-600" :
              isAmber ? "text-amber-600" :
              "text-emerald-600"
            )}>
              {(forecast.sales_gap ?? 0) >= 0
                ? `▲ ${formatCurrency(forecast.sales_gap!)} above target`
                : `▼ ${formatCurrency(Math.abs(forecast.sales_gap!))} below target`}
            </p>
          )}

          <StatGrid items={[
            { label: "Target",     value: forecast.target_sales ? formatCurrency(forecast.target_sales) : "Not set" },
            { label: "Risk level", value: forecast.risk_level.charAt(0).toUpperCase() + forecast.risk_level.slice(1),
              highlight: forecast.risk_level === "high" ? "red" : forecast.risk_level === "medium" ? "amber" : undefined },
            { label: "Avg spend",  value: avgSpend != null ? formatCurrency(avgSpend) : "—" },
            { label: "Margin",     value: margin != null ? `${margin.toFixed(1)}%` : "—",
              highlight: margin != null && margin < 20 ? "red" : margin != null && margin < 35 ? "amber" : undefined },
          ]} />
        </>
      )}
    </KpiCard>
  );
}

// ── D. Events & Service Today ─────────────────────────────────────────────────

function fmtTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${ampm}`;
}

function ServiceCard({
  today,
  events,
  date,
}: {
  today:  TodayBookingsSummary;
  events: VenueEvent[];
  date:   string;
}) {
  const todayEvent    = events.find((e) => e.event_date === date && !e.cancelled);
  const hasEscalation = today.escalationsToday > 0;

  const chip =
    todayEvent && hasEscalation ? "Event + escalation" :
    todayEvent                  ? "Event tonight"       :
    hasEscalation               ? `${today.escalationsToday} escalation${today.escalationsToday > 1 ? "s" : ""}` :
    today.total > 0             ? `${today.total} bookings` :
    "Quiet service";

  const chipVariant =
    hasEscalation               ? "critical"  as const :
    today.total > 0             ? "neutral"   as const :
                                  "neutral"   as const;

  // Derive lunch vs dinner from bookings
  const lunchBookings  = today.bookings.filter((b) => {
    const h = parseInt((b.booking_time ?? "00:00").split(":")[0], 10);
    return h >= 11 && h < 16;
  });
  const dinnerBookings = today.bookings.filter((b) => {
    const h = parseInt((b.booking_time ?? "00:00").split(":")[0], 10);
    return h >= 16;
  });

  const lunchCovers  = lunchBookings.reduce((s, b) => s + (b.guest_count ?? 0), 0);
  const dinnerCovers = dinnerBookings.reduce((s, b) => s + (b.guest_count ?? 0), 0);

  return (
    <KpiCard
      title="Events & Service Today"
      icon="🎉"
      urgency={hasEscalation ? "critical" : "none"}
      chip={chip}
      chipVariant={chipVariant}
      cta="Open Service Plan"
      ctaHref="/dashboard/bookings"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold tabular-nums text-stone-900">
          {today.total}
        </span>
        <span className="text-xs text-stone-400">bookings today</span>
      </div>
      <p className="text-xs text-stone-500 mt-0.5">{today.totalCovers} total covers</p>

      <StatGrid items={[
        { label: "Lunch covers",   value: lunchCovers,          highlight: lunchCovers > 0 ? undefined : undefined },
        { label: "Dinner covers",  value: dinnerCovers },
        { label: "Large groups",   value: today.largeBookings,  highlight: today.largeBookings > 0 ? "amber" : undefined },
        { label: "Escalations",    value: today.escalationsToday, highlight: today.escalationsToday > 0 ? "red" : undefined },
      ]} />

      {todayEvent && (
        <div className="mt-3 rounded-lg bg-purple-50 border border-purple-100 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-purple-500 mb-0.5">
            Tonight&apos;s event
          </p>
          <p className="text-xs font-semibold text-purple-900 leading-snug">
            {todayEvent.name}
          </p>
          {todayEvent.start_time && (
            <p className="text-[10px] text-purple-600 mt-0.5">
              {fmtTime(todayEvent.start_time)}
              {todayEvent.end_time ? ` – ${fmtTime(todayEvent.end_time)}` : ""}
            </p>
          )}
        </div>
      )}
    </KpiCard>
  );
}
