/**
 * OperatingContextRow — Zone 4
 *
 * 4 compact operational context cards rendered in a responsive grid:
 * A. Revenue Intelligence — forecast vs target, avg spend
 * B. Staffing / Labour    — labor %, threshold, pressure
 * C. Bookings & Covers    — total, covers, large groups, escalations
 * D. Events Context       — tonight's event or next event
 */

import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  RevenueForecast,
  TodayBookingsSummary,
  VenueEvent,
} from "@/types";

interface Props {
  forecast:  RevenueForecast | null;
  today:     TodayBookingsSummary;
  events:    VenueEvent[];
  date:      string; // YYYY-MM-DD
}

export default function OperatingContextRow({ forecast, today, events, date }: Props) {
  return (
    <div>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-stone-400">
        Today&apos;s Operating Context
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RevenueContextCard  forecast={forecast} />
        <StaffingCard />
        <BookingsCard        today={today} />
        <EventsContextCard   events={events} date={date} />
      </div>
    </div>
  );
}

// ── Revenue Intelligence ────────────────────────────────────────────────────────

function RevenueContextCard({
  forecast,
}: {
  forecast: RevenueForecast | null;
}) {
  const avgSpend  = null as number | null;
  const margin    = null as number | null;
  const hasActual = false;

  return (
    <ContextCard icon="💰" title="Revenue" href="/dashboard/settings/targets">
      {forecast ? (
        <>
          <BigStat
            value={formatCurrency(forecast.forecast_sales)}
            label="forecast"
          />
          {forecast.target_sales && (
            <GapLine
              gap={forecast.sales_gap ?? null}
              gapPct={forecast.sales_gap_pct ?? null}
            />
          )}
          {!forecast.target_sales && (
            <p className="text-xs text-stone-400 mt-1">No target set</p>
          )}
        </>
      ) : (
        <NoData label="No forecast" />
      )}

      {hasActual && (
        <div className="mt-3 border-t border-stone-100 pt-3 space-y-1">
          {avgSpend !== null && (
            <MetaRow label="Avg spend" value={formatCurrency(avgSpend)} />
          )}
          {margin !== null && (
            <MetaRow label="Margin" value={`${margin.toFixed(1)}%`} />
          )}
        </div>
      )}
    </ContextCard>
  );
}

// ── Staffing ────────────────────────────────────────────────────────────────────

function StaffingCard() {
  const laborPct   = null as number | null;
  const threshold  = 30; // typical restaurant labour threshold

  const isRed   = laborPct !== null && laborPct > threshold + 5;
  const isAmber = laborPct !== null && laborPct > threshold && !isRed;
  const isGood  = laborPct !== null && laborPct <= threshold;

  return (
    <ContextCard icon="👥" title="Staffing" href="/dashboard/operations">
      {laborPct !== null ? (
        <>
          <BigStat
            value={`${laborPct.toFixed(1)}%`}
            label="labour cost"
            color={isRed ? "red" : isAmber ? "amber" : "emerald"}
          />
          <p className={cn(
            "mt-1 text-xs font-medium",
            isRed   ? "text-red-600"   :
            isAmber ? "text-amber-600" :
            "text-emerald-600"
          )}>
            {isRed   ? `⚠ ${(laborPct - threshold).toFixed(1)}% over threshold` :
             isAmber ? "Near threshold" :
             isGood  ? `✓ Within target` : ""}
          </p>
        </>
      ) : (
        <NoData label="No labour data" />
      )}
    </ContextCard>
  );
}

// ── Bookings ────────────────────────────────────────────────────────────────────

function BookingsCard({ today }: { today: TodayBookingsSummary }) {
  const hasEsc   = today.escalationsToday > 0;
  const hasLarge = today.largeBookings > 0;

  return (
    <ContextCard icon="📅" title="Bookings" href="/dashboard/bookings">
      <BigStat value={today.total.toString()} label="bookings" />

      <div className="mt-1 flex items-center gap-2">
        <span className="text-xs text-stone-500">
          {today.totalCovers} covers
        </span>
        {today.eventLinked > 0 && (
          <span className="rounded bg-purple-100 px-1.5 py-px text-[10px] font-medium text-purple-700">
            {today.eventLinked} event-linked
          </span>
        )}
      </div>

      {(hasEsc || hasLarge) && (
        <div className="mt-3 border-t border-stone-100 pt-3 space-y-1">
          {hasEsc && (
            <MetaRow
              label="Escalations"
              value={today.escalationsToday.toString()}
              valueClass="text-red-600 font-bold"
            />
          )}
          {hasLarge && (
            <MetaRow
              label="Large groups"
              value={today.largeBookings.toString()}
              valueClass="text-amber-600"
            />
          )}
        </div>
      )}

      {today.total === 0 && (
        <p className="mt-2 text-xs text-stone-400">No bookings today</p>
      )}
    </ContextCard>
  );
}

// ── Events Context ──────────────────────────────────────────────────────────────

function EventsContextCard({ events, date }: { events: VenueEvent[]; date: string }) {
  const todayEvent  = events.find((e) => e.event_date === date && !e.cancelled);
  const upcomingEvt = !todayEvent
    ? events.find((e) => e.event_date > date && !e.cancelled)
    : null;

  const displayEvent = todayEvent ?? upcomingEvt;
  const isToday      = !!todayEvent;

  return (
    <ContextCard icon="🎉" title="Events" href="/dashboard/events">
      {displayEvent ? (
        <>
          <p className={cn(
            "mt-2 text-xs font-bold uppercase tracking-widest",
            isToday ? "text-purple-700" : "text-stone-400"
          )}>
            {isToday ? "Tonight" : formatEventDate(displayEvent.event_date)}
          </p>
          <p className="mt-0.5 text-sm font-bold text-stone-800 leading-tight line-clamp-2">
            {displayEvent.name}
          </p>
          {displayEvent.start_time && (
            <p className="mt-1 text-xs text-stone-500">
              {fmtTime(displayEvent.start_time)}
              {displayEvent.end_time ? ` – ${fmtTime(displayEvent.end_time)}` : ""}
            </p>
          )}
          {displayEvent.is_special_event && (
            <span className="mt-2 inline-block rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-700">
              Special Event
            </span>
          )}
        </>
      ) : (
        <NoData label="No events scheduled" />
      )}
    </ContextCard>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────────

function ContextCard({
  icon,
  title,
  href,
  children,
}: {
  icon: string;
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-stone-500">
          <span>{icon}</span>
          {title}
        </p>
        <Link href={href} className="text-xs text-stone-400 hover:text-stone-700">
          Detail →
        </Link>
      </div>
      {children}
    </div>
  );
}

function BigStat({
  value,
  label,
  color = "stone",
}: {
  value: string;
  label: string;
  color?: "stone" | "red" | "amber" | "emerald";
}) {
  return (
    <div className="mt-3 flex items-baseline gap-1.5">
      <span className={cn(
        "text-3xl font-bold tabular-nums",
        color === "red"     ? "text-red-600"   :
        color === "amber"   ? "text-amber-600" :
        color === "emerald" ? "text-emerald-600" :
        "text-stone-900"
      )}>
        {value}
      </span>
      <span className="text-xs text-stone-400">{label}</span>
    </div>
  );
}

function GapLine({ gap, gapPct }: { gap: number | null; gapPct: number | null }) {
  if (gap == null) return null;
  const isPositive = gap >= 0;
  return (
    <p className={cn(
      "mt-1 text-xs font-semibold",
      isPositive ? "text-emerald-600" : "text-red-600"
    )}>
      {isPositive
        ? `▲ ${formatCurrency(gap)} above target`
        : `▼ ${formatCurrency(Math.abs(gap))} below (${Math.abs(gapPct ?? 0).toFixed(1)}%)`}
    </p>
  );
}

function MetaRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-stone-400">{label}</span>
      <span className={cn("text-xs font-semibold text-stone-700", valueClass)}>{value}</span>
    </div>
  );
}

function NoData({ label }: { label: string }) {
  return <p className="mt-3 text-xs text-stone-400">{label}</p>;
}

function formatEventDate(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-ZA", {
      weekday: "short",
      month:   "short",
      day:     "numeric",
    });
  } catch {
    return dateStr;
  }
}

function fmtTime(time: string): string {
  // time is "HH:MM:SS" or "HH:MM"
  const parts = time.split(":");
  const h = parseInt(parts[0], 10);
  const m = parts[1] ?? "00";
  const ampm = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return `${hour}:${m}${ampm}`;
}
