/**
 * Upcoming bookings — all future reservations
 */

import { getUpcomingWebsiteReservations } from "@/services/bookings/websiteService";
import BookingsPageClient from "@/components/dashboard/BookingsPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BookingsPage() {
  let reservations: Awaited<ReturnType<typeof getUpcomingWebsiteReservations>> = [];
  let fetchError: string | null = null;
  try {
    reservations = await getUpcomingWebsiteReservations();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Upcoming Bookings</h1>
        <p className="mt-1 text-sm text-stone-500">
          {reservations.length > 0
            ? `${reservations.length} reservation${reservations.length === 1 ? "" : "s"} from today onward.`
            : "All confirmed and pending reservations from today onward."}
        </p>
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          ⚠ Could not load bookings from the website API: <code className="font-mono">{fetchError}</code>
        </div>
      )}

      {!fetchError && <BookingsPageClient reservations={reservations} />}
    </div>
  );
}
