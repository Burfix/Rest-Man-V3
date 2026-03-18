"use client";

import { Reservation } from "@/types";
import { formatShortDate, formatDisplayDate, maskPhoneNumber, isTestEntry } from "@/lib/utils";
import StatusBadge from "@/components/ui/StatusBadge";
import Badge from "@/components/ui/Badge";
import BookingRowActions from "@/components/dashboard/BookingRowActions";

interface Props {
  reservations: Reservation[];
  /** Group rows by booking date (default true). Pass false for single-day views. */
  showDateGroups?: boolean;
}

const COLUMNS = ["Name", "Phone", "Date", "Time", "Guests", "Event", "Status", "Flags", "Notes", "Actions"];

export default function BookingsTable({ reservations, showDateGroups = true }: Props) {
  // Filter out test/dummy entries (WhatsApp/dashboard test bookings).
  // Website-sourced bookings (source_channel === 'website') skip this filter.
  const filtered = reservations.filter(
    (r) =>
      r.source_channel === "website" ||
      !isTestEntry({ name: r.customer_name, phone: r.phone_number })
  );

  // Build ordered date-group map
  const groups = filtered.reduce<Map<string, Reservation[]>>((acc, r) => {
    const existing = acc.get(r.booking_date) ?? [];
    existing.push(r);
    acc.set(r.booking_date, existing);
    return acc;
  }, new Map());

  const dates = Array.from(groups.keys()); // already sorted by query

  if (filtered.length === 0) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white px-6 py-10 text-center text-sm text-stone-400">
        No bookings to display.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="min-w-full divide-y divide-stone-200 bg-white text-sm">
        <thead>
          <tr className="bg-stone-50">
            {COLUMNS.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {showDateGroups && dates.length > 1
            ? dates.flatMap((date) => [
                <tr key={`date-group-${date}`}>
                  <td
                    colSpan={COLUMNS.length}
                    className="bg-stone-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500"
                  >
                    {formatDisplayDate(date)}
                  </td>
                </tr>,
                ...(groups.get(date) ?? []).map((r) => (
                  <BookingRow key={r.id} r={r} />
                )),
              ])
            : filtered.map((r) => <BookingRow key={r.id} r={r} />)}
        </tbody>
      </table>
    </div>
  );
}

function BookingRow({ r }: { r: Reservation }) {
  return (
    <tr className="hover:bg-stone-50">
      <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-800">
        {r.customer_name}
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-stone-500">
        {maskPhoneNumber(r.phone_number)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-stone-600">
        {formatShortDate(r.booking_date)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-stone-600">
        {r.booking_time}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-center text-stone-700">
        {r.guest_count}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-stone-500">
        {r.event_name ?? <span className="text-stone-300">—</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge status={r.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {r.escalation_required && (
            <Badge color="red">Escalation</Badge>
          )}
          {r.service_charge_applies && (
            <Badge color="amber">Svc Charge</Badge>
          )}
        </div>
      </td>
      <td className="max-w-[180px] truncate px-4 py-3 text-stone-400">
        {r.special_notes ?? "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <BookingRowActions reservation={r} />
      </td>
    </tr>
  );
}
