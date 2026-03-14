import { ResolvedEvent } from "@/types";
import { formatShortDate } from "@/lib/utils";
import Badge from "@/components/ui/Badge";

interface Props {
  events: ResolvedEvent[];
}

export default function EventsTable({ events }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="min-w-full divide-y divide-stone-200 bg-white text-sm">
        <thead>
          <tr className="bg-stone-50">
            {["Event", "Date", "Time", "Description", "Source", "Booking"].map(
              (h) => (
                <th
                  key={h}
                  className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {events.map((e) => (
            <tr key={`${e.name}|${e.event_date}`} className="hover:bg-stone-50">
              <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-800">
                {e.name}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-stone-600">
                {formatShortDate(e.event_date)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-stone-500">
                {e.start_time && e.end_time
                  ? `${e.start_time} – ${e.end_time}`
                  : e.start_time ?? "—"}
              </td>
              <td className="max-w-[280px] truncate px-4 py-3 text-stone-400">
                {e.description ?? "—"}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <Badge color={e.source === "database" ? "blue" : "stone"}>
                  {e.source === "database" ? "DB" : "Computed"}
                </Badge>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {e.booking_enabled ? (
                  <Badge color="green">Open</Badge>
                ) : (
                  <Badge color="stone">Closed</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
