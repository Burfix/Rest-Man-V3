/**
 * SiteOverviewCard — per-site aggregate card for the Head Office Sites view.
 */
"use client";

import React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { SiteCardData } from "@/app/api/head-office/sites/route";

interface Props {
  site: SiteCardData;
}

const HEALTH_STYLE = {
  healthy:  { border: "border-emerald-700/40", badge: "bg-emerald-900/50 text-emerald-300", dot: "bg-emerald-500" },
  warning:  { border: "border-amber-700/40",   badge: "bg-amber-900/50 text-amber-300",    dot: "bg-amber-500"   },
  critical: { border: "border-red-700/50",     badge: "bg-red-900/50 text-red-300",        dot: "bg-red-500"     },
  unknown:  { border: "border-slate-700/40",   badge: "bg-slate-800/50 text-slate-400",    dot: "bg-slate-500"   },
} as const;

const MICROS_DOT: Record<string, string> = {
  connected:    "bg-emerald-500",
  syncing:      "bg-blue-500",
  error:        "bg-red-500",
  disconnected: "bg-red-500",
  unknown:      "bg-slate-500",
};

function fmt(n: number | null, prefix = ""): string {
  if (n == null) return "—";
  return prefix + n.toLocaleString("en-ZA");
}

function fmtCurrency(n: number | null): string {
  if (n == null) return "—";
  return `R ${(n / 100).toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtAge(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export default function SiteOverviewCard({ site }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const grade        = HEALTH_STYLE[site.healthGrade] ?? HEALTH_STYLE.unknown;

  function selectSite() {
    // Persist selection
    fetch("/api/preferences/site", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ siteId: site.siteId }),
    }).catch(() => {});

    // Navigate with ?site_id=
    const p = new URLSearchParams(searchParams.toString());
    p.set("site_id", site.siteId);
    router.push(`/dashboard?${p.toString()}`);
  }

  return (
    <div className={`rounded-xl border bg-slate-900/60 p-4 flex flex-col gap-3 ${grade.border}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full shrink-0 ${grade.dot}`} />
            <h3 className="text-slate-100 font-semibold truncate">{site.siteName}</h3>
          </div>
          {site.storeCode && (
            <p className="text-xs text-slate-500 mt-0.5 pl-4">{site.storeCode}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${grade.badge}`}>
          {site.healthGrade}
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <span className="text-slate-500 block">Revenue Today</span>
          <span className="text-slate-100 font-semibold">{fmtCurrency(site.revenueTodayNet)}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Covers</span>
          <span className="text-slate-100">{fmt(site.revenueChecks)}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Labour Hours</span>
          <span className="text-slate-100">{site.labourHours != null ? `${site.labourHours.toFixed(1)}h` : "—"}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Compliance</span>
          <span className={site.complianceScore != null && site.complianceScore < 70 ? "text-red-400 font-semibold" : "text-slate-100"}>
            {site.complianceScore != null ? `${site.complianceScore}%` : "—"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${MICROS_DOT[site.microsStatus] ?? "bg-slate-500"}`} />
          <span className="text-slate-500">MICROS</span>
          <span className="text-slate-300 ml-1 capitalize">{site.microsStatus}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Data Age</span>
          <span className={site.microsDataAgeMin != null && site.microsDataAgeMin > 120 ? "text-amber-400" : "text-slate-100"}>
            {fmtAge(site.microsDataAgeMin)}
          </span>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={selectSite}
        className="mt-auto w-full rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium py-1.5 transition-colors"
      >
        View Dashboard →
      </button>
    </div>
  );
}
