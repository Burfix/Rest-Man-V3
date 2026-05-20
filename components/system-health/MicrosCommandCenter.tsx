/**
 * MicrosCommandCenter — main client layout for MICROS Mission Control.
 * Wraps: banner, alert list, site cards grid.
 */
"use client";

import React, { useState } from "react";
import type { MicrosHealthApiResponse } from "@/lib/system-health/micros-health-types";
import MicrosExecutiveBanner from "@/components/system-health/MicrosExecutiveBanner";
import MicrosAlertBanner     from "@/components/system-health/MicrosAlertBanner";
import MicrosSiteCard        from "@/components/system-health/MicrosSiteCard";

interface Props {
  data: MicrosHealthApiResponse;
}

export default function MicrosCommandCenter({ data }: Props) {
  const { sites, summary, alerts, asOf } = data;

  return (
    <div className="flex flex-col gap-5">
      <MicrosExecutiveBanner summary={summary} asOf={asOf} />

      {alerts.length > 0 && <MicrosAlertBanner alerts={alerts} />}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sites.map((site) => (
          <MicrosSiteCard key={site.connectionId} site={site} />
        ))}
        {sites.length === 0 && (
          <div className="col-span-3 text-center text-slate-500 py-16">
            No MICROS connections configured.
          </div>
        )}
      </div>
    </div>
  );
}
