import { TodayBookingsSummary, Reservation } from "@/types";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/ui/StatusBadge";

interface Props {
  summary: TodayBookingsSummary;
}

export default function TodaySection({ summary }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-stone-900">Today&apos;s Bookings</h2>
        <a
          href="/dashboard/bookings"
          className="text-xs font-medium text-stone-500 dark:text-stone-400 hover:text-stone-700"
        >
          All bookings →
        </a>
      </div>

      {/* Stat row */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MiniStat label="Bookings" value={summary.total} />
        <MiniStat label="Covers" value={summary.totalCovers} />
        <MiniStat label="Large groups" value={summary.largeBookings} />
        <MiniStat label="Event-linked" value={summary.eventLinked} />
        <MiniStat
          label="Escalations"
          value={summary.escalationsToday}
          highlight={summary.escalationsToday > 0 ? "red" : undefined}
        />
      </div>

      {/* Booking list */}
      {summary.bookings.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm text-stone-500 dark:text-stone-400">
          No bookings confirmed for today.
        </p>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="space-y-2 sm:hidden">
            {summary.bookings.map((r) => (
              <BookingCard key={r.id} r={r} />
            ))}
          </div>
          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
              <thead>
                <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Guests</th>
                  <th className="px-4 py-2">Event</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Flags</th>
                  <th className="px-4 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {summary.bookings.map((r) => (
                  <BookingRow key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function BookingCard({ r }: { r: Reservation }) {
  const isEscalated = r.escalation_required;
  const isLarge = r.service_charge_applies;
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        isEscalated
          ? "border-red-200 bg-red-50"
          : "border-stone-200 bg-white"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-stone-900">{r.customer_name}</p>
          <p className="text-xs text-stone-500">
            {r.booking_time} · {r.guest_count} guests
            {r.event_name ? ` · ${r.event_name}` : ""}
          </p>
        </div>
        <StatusBadge status={r.status} />
      </div>
      {(isEscalated || isLarge || r.special_notes) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {isEscalated && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
              Escalation
            </span>
          )}
          {isLarge && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
              Svc Chg
            </span>
          )}
          {r.special_notes && (
            <span className="text-xs text-stone-500 dark:text-stone-400">{r.special_notes}</span>
          )}
        </div>
      )}
    </div>
  );
}

function BookingRow({ r }: { r: Reservation }) {
  const isEscalated = r.escalation_required;
  const isLarge = r.service_charge_applies;

  return (
    <tr
      className={cn(
        "hover:bg-stone-50",
        isEscalated && "bg-red-50 hover:bg-red-50"
      )}
    >
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm font-medium text-stone-800">
        {r.booking_time}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-stone-900">
        {r.customer_name}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-center text-stone-700">
        <span
          className={cn(
            "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold",
            isLarge
              ? "bg-amber-100 text-amber-800"
              : "bg-stone-100 text-stone-600"
          )}
        >
          {r.guest_count}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-stone-500">
        {r.event_name ?? <span className="text-stone-600 dark:text-stone-300">—</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <StatusBadge status={r.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <div className="flex gap-1">
          {isEscalated && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
              Escalation
            </span>
          )}
          {isLarge && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
              Svc Chg
            </span>
          )}
        </div>
      </td>
      <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-stone-500 dark:text-stone-400">
        {r.special_notes ?? "—"}
      </td>
    </tr>
  );
}

function MiniStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "red";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3",
        highlight === "red" && value > 0
          ? "border-red-200 bg-red-50"
          : "border-stone-200 bg-white"
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-2xl font-bold",
          highlight === "red" && value > 0 ? "text-red-700" : "text-stone-900"
        )}
      >
        {value}
      </p>
    </div>
  );
}
