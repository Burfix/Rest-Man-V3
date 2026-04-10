"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export default function AddBookingForm({ onClose, onAdded }: Props) {
  const [form, setForm] = useState({
    customer_name: "",
    phone_number: "",
    booking_date: "",
    booking_time: "",
    guest_count: "2",
    event_name: "",
    special_notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.customer_name.trim()) return setError("Guest name is required.");
    if (!form.phone_number.trim()) return setError("Phone number is required.");
    if (!form.booking_date) return setError("Booking date is required.");
    if (!form.booking_time) return setError("Booking time is required.");
    if (!form.guest_count || Number(form.guest_count) < 1) return setError("Guest count must be at least 1.");

    setSaving(true);
    try {
      const res = await fetch("/api/bookings/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.customer_name.trim(),
          phone_number:  form.phone_number.trim(),
          booking_date:  form.booking_date,
          booking_time:  form.booking_time,
          guest_count:   Number(form.guest_count),
          event_name:    form.event_name.trim() || null,
          special_notes: form.special_notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create booking");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create booking");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">New Booking</h2>
        <button
          onClick={onClose}
          className="text-stone-500 dark:text-stone-400 hover:text-stone-700 text-lg leading-none"
        >
          ✕
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Row 1: Name + Phone */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Guest Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.customer_name}
              onChange={(e) => set("customer_name", e.target.value)}
              placeholder="e.g. Sarah Johnson"
              className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={form.phone_number}
              onChange={(e) => set("phone_number", e.target.value)}
              placeholder="e.g. +27821234567"
              className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
          </div>
        </div>

        {/* Row 2: Date + Time + Guests */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={form.booking_date}
              onChange={(e) => set("booking_date", e.target.value)}
              className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Time <span className="text-red-500">*</span>
            </label>
            <input
              type="time"
              value={form.booking_time}
              onChange={(e) => set("booking_time", e.target.value)}
              className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Guests <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={form.guest_count}
              onChange={(e) => set("guest_count", e.target.value)}
              className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
          </div>
        </div>

        {/* Row 3: Event name */}
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">
            Event / Occasion <span className="text-stone-500 dark:text-stone-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={form.event_name}
            onChange={(e) => set("event_name", e.target.value)}
            placeholder="e.g. Birthday, Anniversary, Quiz Night…"
            className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
        </div>

        {/* Row 4: Notes */}
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">
            Special Requests <span className="text-stone-500 dark:text-stone-400 font-normal">(optional)</span>
          </label>
          <textarea
            rows={2}
            value={form.special_notes}
            onChange={(e) => set("special_notes", e.target.value)}
            placeholder="Dietary requirements, seating preferences, etc."
            className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-stone-900 px-5 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Create Booking"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
