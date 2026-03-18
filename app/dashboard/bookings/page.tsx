/**
 * Upcoming bookings — all future reservations
 */

import { getUpcomingWebsiteReservations } from "@/services/bookings/websiteService";
import BookingsPageClient from "@/components/dashboard/BookingsPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BookingsPage() {
  let reservations: Awaited<ReturnType<typeof getUpcomingWebsiteReservations>> = [];
  let dbError = false;
  try {
    reservations = await getUpcomingWebsiteReservations();
  } catch {
    dbError = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Upcoming Bookings</h1>
        <p className="mt-1 text-sm text-stone-500">
          All confirmed and pending reservations from today onward.
        </p>
      </div>

      {dbError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠ Unable to load bookings. Please contact your system administrator if this persists.
        </div>
      )}

      {!dbError && <BookingsPageClient reservations={reservations} />}
    </div>
  );
}
