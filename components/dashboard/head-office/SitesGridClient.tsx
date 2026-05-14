/**
 * SitesGridClient — client-side wrapper for the Head Office Sites page.
 * Fetches /api/head-office/sites and renders the grid.
 */
"use client";

import React, { useEffect, useState } from "react";
import SiteOverviewCard               from "@/components/dashboard/head-office/SiteOverviewCard";
import type { SiteCardData }          from "@/app/api/head-office/sites/route";

export default function SitesGridClient() {
  const [sites,   setSites]   = useState<SiteCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [asOf,    setAsOf]    = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/head-office/sites")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setSites(j.sites ?? []);
        setAsOf(j.asOf ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const healthy  = sites.filter((s) => s.healthGrade === "healthy").length;
  const warning  = sites.filter((s) => s.healthGrade === "warning").length;
  const critical = sites.filter((s) => s.healthGrade === "critical").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary strip */}
      {sites.length > 0 && (
        <div className="flex flex-wrap gap-6">
          <Stat label="Total Sites"   value={String(sites.length)}         color="text-slate-100" />
          <Stat label="Healthy"       value={String(healthy)}              color="text-emerald-400" />
          <Stat label="Warning"       value={String(warning)}              color={warning > 0 ? "text-amber-400" : "text-slate-400"} />
          <Stat label="Critical"      value={String(critical)}             color={critical > 0 ? "text-red-400" : "text-slate-400"} />
          <Stat
            label="Revenue Today"
            value={"R " + sites.reduce((a, s) => a + (s.revenueTodayNet ?? 0), 0).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
            color="text-slate-100"
          />
          {asOf && (
            <div className="ml-auto self-end text-xs text-slate-500">
              Updated {new Date(asOf).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="text-slate-400 text-sm">Loading sites…</div>
      )}

      {error && (
        <div className="rounded-lg bg-red-950/40 border border-red-700/50 p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && sites.length === 0 && (
        <div className="text-slate-500 text-sm py-16 text-center">No sites found.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Sort: critical first, then warning, then healthy */}
        {[...sites]
          .sort((a, b) => {
            const order = { critical: 0, warning: 1, healthy: 2, unknown: 3 };
            return (order[a.healthGrade] ?? 3) - (order[b.healthGrade] ?? 3);
          })
          .map((site) => (
            <SiteOverviewCard key={site.siteId} site={site} />
          ))}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <span className="text-xs text-slate-500 block">{label}</span>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}
