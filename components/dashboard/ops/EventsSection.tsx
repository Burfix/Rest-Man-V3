import { VenueEvent } from "@/types";
import { cn, formatShortDate } from "@/lib/utils";

interface Props {
  events: VenueEvent[];
}

export default function EventsSection({ events }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-stone-900">
          Upcoming Events
        </h2>
        <a
          href="/dashboard/events"
          className="text-xs font-medium text-stone-400 hover:text-stone-700"
        >
          All events →
        </a>
      </div>

      {events.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm text-stone-400">
          No upcoming events scheduled.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </section>
  );
}

function EventCard({ event }: { event: VenueEvent }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-stone-900 leading-snug">{event.name}</p>
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
            event.booking_enabled
              ? "bg-green-50 text-green-700 ring-green-200"
              : "bg-stone-100 text-stone-400 ring-stone-200"
          )}
        >
          {event.booking_enabled ? "Bookings on" : "No bookings"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
        <span>{formatShortDate(event.event_date)}</span>
        {event.start_time && (
          <span>
            {event.start_time}
            {event.end_time ? ` – ${event.end_time}` : ""}
          </span>
        )}
        {event.is_special_event && (
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">
            Special
          </span>
        )}
      </div>

      {event.description && (
        <p className="mt-2 line-clamp-2 text-xs text-stone-400">
          {event.description}
        </p>
      )}
    </div>
  );
}
