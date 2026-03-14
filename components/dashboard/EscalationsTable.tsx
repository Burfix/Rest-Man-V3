import { Reservation } from "@/types";
import { formatShortDate } from "@/lib/utils";
import Badge from "@/components/ui/Badge";

interface Props {
  reservations: Reservation[];
}

export default function EscalationsTable({ reservations }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-red-100">
      <table className="min-w-full divide-y divide-red-100 bg-white text-sm">
        <thead>
          <tr className="bg-red-50">
            {["Name", "Phone", "Date", "Time", "Guests", "Event", "Notes", "Status"].map(
              (h) => (
                <th
                  key={h}
                  className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-red-400"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-red-50">
          {reservations.map((r) => (
            <tr key={r.id} className="hover:bg-red-50/40">
              <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-800">
                {r.customer_name}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-stone-500">
                {r.phone_number}
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
              <td className="max-w-[200px] truncate px-4 py-3 text-stone-400">
                {r.special_notes ?? "—"}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <Badge color="red">Needs attention</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
