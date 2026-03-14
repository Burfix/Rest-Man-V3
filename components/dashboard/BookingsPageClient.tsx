"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BookingsTable from "@/components/dashboard/BookingsTable";
import AddBookingForm from "@/components/dashboard/AddBookingForm";
import type { Reservation } from "@/types";

interface Props {
  reservations: Reservation[];
}

export default function BookingsPageClient({ reservations }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  function handleAdded() {
    setShowForm(false);
    router.refresh(); // re-runs the server component to pick up the new row
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700 transition-colors"
        >
          {showForm ? "✕ Cancel" : "+ New Booking"}
        </button>
      </div>

      {/* Inline add form */}
      {showForm && (
        <AddBookingForm
          onClose={() => setShowForm(false)}
          onAdded={handleAdded}
        />
      )}

      {/* Bookings list */}
      {reservations.length === 0 && !showForm ? (
        <p className="text-sm text-stone-400">
          No upcoming bookings found.{" "}
          <button
            onClick={() => setShowForm(true)}
            className="text-stone-600 underline hover:text-stone-900"
          >
            Add the first one.
          </button>
        </p>
      ) : (
        reservations.length > 0 && <BookingsTable reservations={reservations} />
      )}
    </div>
  );
}
