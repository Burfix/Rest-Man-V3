/**
 * Settings → Integrations page
 * Matches the existing settings aesthetic: same card style, same typography.
 */

import { getMicrosStatus } from "@/services/micros/status";
import MicrosSettingsCard  from "@/components/dashboard/settings/MicrosSettingsCard";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export default async function IntegrationsPage() {
  const { connection } = await getMicrosStatus().catch(() => ({ connection: null }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Integrations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Connect third-party data sources to power live operational intelligence.
        </p>
      </div>

      <MicrosSettingsCard connection={connection as never} />

      {/* Future integration slots — placeholder style matches empty maintenance card */}
      <section className="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-6">
        <h2 className="text-sm font-semibold text-stone-500">More integrations</h2>
        <p className="mt-1 text-xs text-stone-400">
          Upcoming: Google Reviews sync, WhatsApp automation, compliance feed.
        </p>
      </section>
    </div>
  );
}
