/**
 * TodayOpsPanel — Today's Operating Context
 *
 * Compact two-column panel showing:
 * Left:  Lunch service / Dinner service breakdown
 * Right: Events tonight + operational highlights
 *
 * Plus a row of "operational notes" derived from live data.
 */

import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import StatusChip from "@/components/ui/StatusChip";
import type {
  TodayBookingsSummary,
  VenueEvent,
  DailyOperationsDashboardSummary,
  DailyOperationsReport,
  MaintenanceSummary,
} from "@/types";

interface Props {
  today:       TodayBookingsSummary;
  events:      VenueEvent[];
  dailyOps:    DailyOperationsDashboardSummary;
  maintenance: MaintenanceSummary;
  date:        string; // YYYY-MM-DD
}

function fmtTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, "0")}${ampm}`;
}

export default function TodayOpsPanel({
  today,
  events,
  dailyOps,
  maintenance,
  date,
}: Props) {
  const todayEvent    = events.find((e) => e.event_date === date && !e.cancelled);
  const nextEvent     = events.find((e) => e.event_date > date && !e.cancelled);
  const report        = dailyOps.latestReport;

  // Split bookings by service period
  const lunchBkgs  = today.bookings.filter((b) => {
    const h = parseInt((b.booking_time ?? "00:00").split(":")[0], 10);
    return h >= 11 && h < 16;
  });
  const dinnerBkgs = today.bookings.filter((b) => {
    const h = parseInt((b.booking_time ?? "00:00").split(":")[0], 10);
    return h >= 16;
  });
  const lunchCovers  = lunchBkgs.reduce((s, b) => s + (b.guest_count ?? 0), 0);
  const dinnerCovers = dinnerBkgs.reduce((s, b) => s + (b.guest_count ?? 0), 0);

  // Derive operational notes from real data
  const notes: { text: string; severity: "red" | "amber" | "green" | "blue" }[] = [];

  if (maintenance.outOfService > 0) {
    const unit = maintenance.urgentIssues.find((i) => i.repair_status === "open");
    notes.push({
      text:     `${maintenance.outOfService} equipment unit${maintenance.outOfService > 1 ? "s" : ""} out of service${unit ? ` — ${unit.unit_name}` : ""}`,
      severity: "red",
    });
  }
  if (today.escalationsToday > 0) {
    notes.push({
      text:     `${today.escalationsToday} booking escalation${today.escalationsToday > 1 ? "s" : ""} require manager attention`,
      severity: "red",
    });
  }
  if (todayEvent) {
    notes.push({
      text:     `Event tonight: ${todayEvent.name}${todayEvent.start_time ? ` at ${fmtTime(todayEvent.start_time)}` : ""}. Brief front-of-house before service.`,
      severity: "blue",
    });
  }
  if (today.largeBookings > 0) {
    notes.push({
      text:     `${today.largeBookings} large group booking${today.largeBookings > 1 ? "s" : ""} — confirm seating arrangements.`,
      severity: "amber",
    });
  }
  if (report?.labor_cost_percent != null && report.labor_cost_percent > 35) {
    notes.push({
      text:     `Labour cost at ${report.labor_cost_percent.toFixed(1)}% — review shift coverage before service.`,
      severity: "amber",
    });
  }
  if (!report) {
    notes.push({
      text:     "Daily operations report not uploaded — labour and margin data unavailable.",
      severity: "amber",
    });
  }
  if (report && notes.filter((n) => n.severity === "red" || n.severity === "amber").length === 0) {
    notes.push({
      text:     "All systems normal. No operational issues flagged.",
      severity: "green",
    });
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-stone-50">
        <div className="flex items-center gap-2.5">
          <span className="text-sm">📋</span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-700">
            Today&apos;s Operations
          </span>
        </div>
        <Link href="/dashboard/bookings" className="text-xs text-stone-400 hover:text-stone-700">
          Full view →
        </Link>
      </div>

      <div className="p-5">
        {/* ── Service periods + events grid ──────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ServicePeriodCell
            title="Lunch Service"
            range="12:00 – 15:00"
            bookings={lunchBkgs.length}
            covers={lunchCovers}
            href="/dashboard/bookings"
          />
          <ServicePeriodCell
            title="Dinner Service"
            range="18:00 – 22:00"
            bookings={dinnerBkgs.length}
            covers={dinnerCovers}
            href="/dashboard/bookings"
          />
          <EventCell
            title="Tonight's Event"
            event={todayEvent ?? null}
          />
          <FinanceCell report={report} />
        </div>

        {/* ── Operational notes ─────────────────────────────────────── */}
        <div className="mt-4 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">
            Operational Notes
          </p>
          {notes.map((note, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2",
                note.severity === "red"   ? "bg-red-50" :
                note.severity === "amber" ? "bg-amber-50" :
                note.severity === "green" ? "bg-emerald-50" :
                "bg-blue-50"
              )}
            >
              <span className="shrink-0 mt-px">
                {note.severity === "red"   ? "🔴" :
                 note.severity === "amber" ? "⚠️" :
                 note.severity === "green" ? "✅" : "ℹ️"}
              </span>
              <p className={cn(
                "text-xs leading-relaxed",
                note.severity === "red"   ? "text-red-800" :
                note.severity === "amber" ? "text-amber-800" :
                note.severity === "green" ? "text-emerald-800" :
                "text-blue-800"
              )}>
                {note.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ServicePeriodCell({
  title,
  range,
  bookings,
  covers,
  href,
}: {
  title:    string;
  range:    string;
  bookings: number;
  covers:   number;
  href:     string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-stone-100 bg-stone-50 px-4 py-3 hover:bg-stone-100 transition-colors group"
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 group-hover:text-stone-600">
        {title}
      </p>
      <p className="text-[10px] text-stone-400 mt-px">{range}</p>
      <div className="mt-3">
        <p className="text-2xl font-bold text-stone-900 tabular-nums">{bookings}</p>
        <p className="text-xs text-stone-500 mt-0.5">bookings · {covers} covers</p>
      </div>
      {bookings === 0 && (
        <p className="mt-1 text-[10px] text-stone-300 italic">None booked</p>
      )}
    </Link>
  );
}

function EventCell({ title, event }: { title: string; event: { name: string; start_time: string | null; end_time: string | null; is_special_event: boolean } | null }) {
  return (
    <div className={cn(
      "rounded-lg border px-4 py-3",
      event ? "border-purple-200 bg-purple-50" : "border-stone-100 bg-stone-50"
    )}>
      <p className={cn(
        "text-[10px] font-bold uppercase tracking-wider",
        event ? "text-purple-500" : "text-stone-400"
      )}>
        {title}
      </p>
      {event ? (
        <>
          <p className="mt-2 text-sm font-bold text-purple-900 leading-snug">{event.name}</p>
          {event.start_time && (
            <p className="text-xs text-purple-600 mt-1">
              {fmtTime(event.start_time)}
              {event.end_time ? ` – ${fmtTime(event.end_time)}` : ""}
            </p>
          )}
          {event.is_special_event && (
            <StatusChip variant="info" size="xs" className="mt-2">Special</StatusChip>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-stone-400 italic">No events scheduled</p>
      )}
    </div>
  );
}

function FinanceCell({ report }: { report: DailyOperationsReport | null }) {
  const r = report;
  if (!r) {
    return (
      <div className="rounded-lg border border-stone-100 bg-stone-50 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
          Labour &amp; Margin
        </p>
        <p className="mt-3 text-xs text-stone-300 italic">Upload daily ops report</p>
      </div>
    );
  }

  const labor  = r.labor_cost_percent;
  const margin = r.margin_percent;

  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
        Labour &amp; Margin
      </p>
      <div className="mt-2 space-y-1.5">
        {labor != null && (
          <div>
            <div className="flex justify-between text-xs">
              <span className="text-stone-500">Labour</span>
              <span className={cn(
                "font-bold",
                labor > 45 ? "text-red-600" :
                labor > 35 ? "text-amber-600" :
                "text-emerald-600"
              )}>
                {labor.toFixed(1)}%
              </span>
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-stone-200">
              <div
                className={cn("h-1 rounded-full", labor > 45 ? "bg-red-500" : labor > 35 ? "bg-amber-400" : "bg-emerald-500")}
                style={{ width: `${Math.min(labor, 100)}%` }}
              />
            </div>
          </div>
        )}
        {margin != null && (
          <div>
            <div className="flex justify-between text-xs">
              <span className="text-stone-500">Margin</span>
              <span className={cn(
                "font-bold",
                margin < 20 ? "text-red-600" :
                margin < 35 ? "text-amber-600" :
                "text-emerald-600"
              )}>
                {margin.toFixed(1)}%
              </span>
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-stone-200">
              <div
                className={cn("h-1 rounded-full", margin < 20 ? "bg-red-500" : margin < 35 ? "bg-amber-400" : "bg-emerald-500")}
                style={{ width: `${Math.min(margin, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
