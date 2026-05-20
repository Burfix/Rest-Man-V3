/**
 * Escalations — reservations and conversations flagged for manager attention
 */

import { getReservations } from "@/services/bookings/service";
import EscalationsTable from "@/components/dashboard/EscalationsTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EscalationsPage() {
  let escalations: Awaited<ReturnType<typeof getReservations>> = [];
  let dbError = false;
  try {
    escalations = await getReservations({ escalationOnly: true, upcomingOnly: true });
  } catch {
    dbError = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Escalations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Bookings and enquiries flagged for manager review.
        </p>
      </div>

      {dbError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠ Database not connected. Add your Supabase credentials to <code>.env.local</code> to see live data.
        </div>
      ) : escalations.length === 0 ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          No escalations at this time.
        </div>
      ) : (
        <EscalationsTable reservations={escalations} />
      )}
    </div>
  );
}
