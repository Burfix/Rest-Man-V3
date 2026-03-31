/**
 * Settings — venue configuration (read-only view, edit via Supabase)
 */

import { createServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/get-user-context";
import { VenueSettings } from "@/types";
import UpcomingEventsManager from "@/components/settings/UpcomingEventsManager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getVenueSettings(): Promise<VenueSettings | null> {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("venue_settings")
      .select("*")
      .single();

    if (error || !data) return null;
    return data as VenueSettings;
  } catch {
    return null;
  }
}

export default async function SettingsPage() {
  const [settings, userCtx] = await Promise.all([
    getVenueSettings(),
    getUserContext().catch(() => null),
  ]);

  const siteId = userCtx?.siteId ?? "";

  if (!settings) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-stone-900">Venue Settings</h1>
        <p className="text-sm text-red-500">
          Could not load venue settings. Contact your system administrator.
        </p>
      </div>
    );
  }

  const hours = settings.opening_hours_json;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Venue Settings</h1>
        <p className="mt-1 text-sm text-stone-500">
          Contact your administrator to update these settings.
        </p>
      </div>

      {/* Venue info */}
      <section className="rounded-lg border border-stone-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-stone-800">
          Venue Information
        </h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SettingRow label="Venue Name" value={settings.venue_name} />
          <SettingRow label="Max Capacity" value={`${settings.max_capacity} guests`} />
          <SettingRow label="Max Table Size" value={`${settings.max_table_size} guests`} />
          <SettingRow
            label="Service Charge Threshold"
            value={`Groups over ${settings.service_charge_threshold} guests`}
          />
        </dl>
      </section>

      {/* Opening hours */}
      <section className="rounded-lg border border-stone-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-stone-800">
          Opening Hours
        </h2>
        <dl className="divide-y divide-stone-100">
          {(
            [
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
            ] as (keyof typeof hours)[]
          ).map((day) => (
            <div
              key={day}
              className="flex justify-between py-2 text-sm"
            >
              <dt className="capitalize text-stone-600">{day}</dt>
              <dd className="font-medium text-stone-800">
                {hours[day].open} –{" "}
                {hours[day].close === "late" ? "late" : hours[day].close}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Upcoming events */}
      {siteId && <UpcomingEventsManager siteId={siteId} />}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-stone-800">{value}</dd>
    </div>
  );
}
