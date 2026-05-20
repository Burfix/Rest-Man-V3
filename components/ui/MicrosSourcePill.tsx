/**
 * MicrosSourcePill — compact data-source provenance chip
 *
 * Shows "Source: MICROS Live" or "Source: CSV Upload" inline with
 * section headers on Daily Ops, Operational Health, and Command Center.
 *
 * Matches existing chip style from FreshnessBar — no new design tokens.
 */

import { cn } from "@/lib/utils";

type Source = "micros_live" | "csv_upload" | "manual" | null;

interface Props {
  source: Source;
  /** Optional ISO timestamp of the data */
  syncedAt?: string | null;
}

const LABEL: Record<NonNullable<Source>, string> = {
  micros_live: "MICROS Live",
  csv_upload:  "CSV Upload",
  manual:      "Manual entry",
};

const DOT: Record<NonNullable<Source>, string> = {
  micros_live: "bg-emerald-400",
  csv_upload:  "bg-sky-400",
  manual:      "bg-stone-300",
};

export default function MicrosSourcePill({ source, syncedAt }: Props) {
  if (!source) return null;

  const label    = LABEL[source];
  const dotColor = DOT[source];

  // Compact age label for MICROS live
  let ageLabel = "";
  if (source === "micros_live" && syncedAt) {
    const mins = Math.floor((Date.now() - new Date(syncedAt).getTime()) / 60_000);
    ageLabel = mins < 1 ? " · now" : mins < 60 ? ` · ${mins}m` : "";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-medium",
        source === "micros_live"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-stone-200 bg-stone-50 text-stone-500",
      )}
      title={`Data source: ${label}`}
    >
      <span className={cn("h-1 w-1 rounded-full shrink-0", dotColor)} />
      {label}{ageLabel}
    </span>
  );
}
