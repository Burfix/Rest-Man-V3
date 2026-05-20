/**
 * Events — upcoming events as resolved by the event resolver
 */

import { resolveUpcomingEvents } from "@/services/events/resolver";
import EventsTable from "@/components/dashboard/EventsTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EventsPage() {
  let events: Awaited<ReturnType<typeof resolveUpcomingEvents>> = [];
  let dbError = false;
  try {
    events = await resolveUpcomingEvents(60); // next 60 days
  } catch {
    dbError = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Events</h1>
        <p className="mt-1 text-sm text-stone-500">
          Upcoming events for the next 60 days (database + recurring schedule).
        </p>
      </div>

      {dbError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠ Database not connected — showing computed recurring events only.
        </div>
      )}
      {events.length === 0 ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">No upcoming events found.</p>
      ) : (
        <EventsTable events={events} />
      )}
    </div>
  );
}
