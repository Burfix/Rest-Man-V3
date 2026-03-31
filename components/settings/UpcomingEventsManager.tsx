"use client";

/**
 * Upcoming Events Manager — Settings Page Component
 *
 * Allows GMs and Head Office to add/remove upcoming events that influence
 * the forecasting engine's revenue projection for the site.
 *
 * Events are stored in site_events table and passed to forecastToday()
 * at runtime by the operating brain.
 */

import { useState, useEffect, useTransition } from "react";
import { CATEGORY_UPLIFT, type EventCategory } from "@/services/forecasting/events-calendar";

// ── Types ─────────────────────────────────────────────────────────────────────

type DbEvent = {
  id: string;
  event_name: string;
  event_date: string;       // "YYYY-MM-DD"
  category: EventCategory;
  uplift_multiplier: number;
  confirmed: boolean;
  notes: string | null;
};

const CATEGORY_LABELS: Record<EventCategory, string> = {
  springbok_home_ct:  "Springbok CT Home Test",
  rugby_world_cup_sa: "Rugby World Cup (SA)",
  afcon_bafana:       "AFCON / Bafana Bafana",
  dstv_premier_ct:    "DStv Premiership Derby",
  custom:             "Custom Event",
};

export default function UpcomingEventsManager({ siteId }: { siteId: string }) {
  const [events, setEvents]       = useState<DbEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [eventName, setEventName]               = useState("");
  const [eventDate, setEventDate]               = useState("");
  const [category, setCategory]                 = useState<EventCategory>("custom");
  const [upliftPct, setUpliftPct]               = useState("15");
  const [notes, setNotes]                       = useState("");
  const [formError, setFormError]               = useState<string | null>(null);
  const [submitting, setSubmitting]             = useState(false);

  // ── Load events ─────────────────────────────────────────────────────────────

  const loadEvents = async () => {
    try {
      const res = await fetch(`/api/events?siteId=${siteId}`);
      if (!res.ok) throw new Error("Failed to load events");
      const json = await res.json();
      setEvents(json.events ?? []);
    } catch {
      setError("Could not load events. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadEvents(); }, []);

  // When category changes, prefill uplift % with default
  useEffect(() => {
    const defaultMultiplier = CATEGORY_UPLIFT[category];
    setUpliftPct(String(Math.round((defaultMultiplier - 1) * 100)));
  }, [category]);

  // ── Add event ────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    setFormError(null);
    const upliftNum = parseFloat(upliftPct);
    const upliftMultiplier = 1 + upliftNum / 100;

    if (!eventName.trim()) { setFormError("Event name is required."); return; }
    if (!eventDate)         { setFormError("Date is required."); return; }
    if (isNaN(upliftNum) || upliftNum < 0 || upliftNum > 200) {
      setFormError("Uplift % must be between 0 and 200.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          eventName: eventName.trim(),
          eventDate,
          category,
          upliftMultiplier,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setFormError(j.error ?? "Failed to save event.");
        return;
      }
      // Reset form and reload
      setEventName(""); setEventDate(""); setNotes("");
      await loadEvents();
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete event ─────────────────────────────────────────────────────────────

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
      if (res.ok) {
        setEvents((prev) => prev.filter((e) => e.id !== id));
      }
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-stone-800">Upcoming Events</h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Events adjust the forecasting engine&apos;s revenue projection for that day.
            Springbok CT home games apply a ~40% uplift based on 2024 calibration.
          </p>
        </div>
      </div>

      {/* Existing events list */}
      {loading ? (
        <p className="text-sm text-stone-400">Loading events…</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : events.length === 0 ? (
        <p className="mb-4 text-sm text-stone-400">No upcoming events added. Use the form below to add one.</p>
      ) : (
        <div className="mb-6 divide-y divide-stone-100 rounded border border-stone-100">
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-800">{e.event_name}</p>
                <p className="text-xs text-stone-400">
                  {e.event_date} &middot; {CATEGORY_LABELS[e.category] ?? e.category} &middot;{" "}
                  <span className="font-mono text-green-700">
                    +{Math.round((e.uplift_multiplier - 1) * 100)}%
                  </span>
                </p>
                {e.notes && (
                  <p className="mt-0.5 truncate text-xs text-stone-400">{e.notes}</p>
                )}
              </div>
              <button
                onClick={() => handleDelete(e.id)}
                disabled={isPending}
                className="ml-4 shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add event form */}
      <div className="space-y-3 rounded border border-stone-100 bg-stone-50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Add Event</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-stone-500">Event Name</label>
            <input
              type="text"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Springbok Home Test — SA vs Ireland"
              className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder-stone-300 focus:border-stone-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500">Date</label>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus:border-stone-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EventCategory)}
              className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus:border-stone-400 focus:outline-none"
            >
              {(Object.keys(CATEGORY_LABELS) as EventCategory[]).map((k) => (
                <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500">
              Expected Revenue Uplift %
              <span className="ml-1 text-stone-400">(vs normal day)</span>
            </label>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={upliftPct}
              onChange={(e) => setUpliftPct(e.target.value)}
              className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm font-mono text-stone-800 focus:border-stone-400 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-stone-500">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. DHL Newlands — confirmed fixture"
            className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder-stone-300 focus:border-stone-400 focus:outline-none"
          />
        </div>

        {formError && (
          <p className="text-xs text-red-500">{formError}</p>
        )}

        <button
          onClick={handleAdd}
          disabled={submitting}
          className="rounded bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Add Event"}
        </button>
      </div>
    </section>
  );
}
