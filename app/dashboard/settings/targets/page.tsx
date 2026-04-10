/**
 * /dashboard/settings/targets
 *
 * Revenue target management — set daily sales and covers goals.
 * These targets power the gap analysis in the Revenue Intelligence section.
 */

import Link from "next/link";
import { getUpcomingTargets } from "@/services/revenue/forecast";
import TargetsClient from "@/components/dashboard/TargetsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TargetsPage() {
  let targets = await getUpcomingTargets(60).catch(() => []);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
        <Link href="/dashboard/settings" className="hover:text-stone-700">
          Settings
        </Link>
        <span>/</span>
        <span className="text-stone-600">Revenue Targets</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Revenue Targets</h1>
        <p className="mt-0.5 text-sm text-stone-500">
          Set daily sales and covers goals for the Revenue Intelligence Engine.
        </p>
      </div>

      {/* Client form + list */}
      <TargetsClient targets={targets} />

      {/* Info box */}
      <div className="rounded-lg border border-stone-200 bg-stone-50 px-5 py-4 text-xs text-stone-500">
        <p className="font-medium text-stone-700 mb-1">How targets are used</p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong>Sales gap</strong> — the difference between the revenue forecast and your target for the day.
          </li>
          <li>
            <strong>Required extra covers</strong> — how many additional guests are needed at the current average spend to hit the sales target.
          </li>
          <li>
            Targets are visible on the <Link href="/dashboard" className="underline hover:text-stone-900">Operations dashboard</Link>.
          </li>
          <li>
            Re-submitting a target for the same date overwrites the previous value.
          </li>
        </ul>
      </div>
    </div>
  );
}
