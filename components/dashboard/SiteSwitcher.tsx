/**
 * SiteSwitcher — global site selector for multi-site roles.
 *
 * Rendered in the Sidebar for super_admin, head_office, executive, auditor, area_manager.
 * Selection is persisted via POST /api/preferences/site (cookie) AND URL param.
 *
 * On select: writes cookie, then navigates to the current path with ?site_id=<id>.
 * Supports "All Sites" aggregate mode (site_id=all).
 */
"use client";

import React, { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export interface SiteOption {
  id:   string;  // "all" | uuid
  name: string;
}

interface Props {
  sites:      SiteOption[];
  currentId:  string | "all";
  role:       string;
}

const MULTI_SITE_ROLES = new Set(["super_admin", "head_office", "executive", "auditor", "area_manager"]);

export default function SiteSwitcher({ sites, currentId, role }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (!MULTI_SITE_ROLES.has(role)) return null;

  const options: SiteOption[] = [
    { id: "all", name: "All Sites" },
    ...sites,
  ];

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value;

    // Persist cookie BEFORE navigating — prevents race condition where the
    // server re-renders the page before the cookie is set, causing
    // getUserContext() to still return the old siteId.
    try {
      await fetch("/api/preferences/site", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ siteId: selected }),
      });
    } catch { /* best-effort — navigate anyway */ }

    // Navigate — rebuild search params keeping any existing ones
    const params = new URLSearchParams(searchParams.toString());
    params.set("site_id", selected);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  const displayName =
    currentId === "all"
      ? "All Sites"
      : sites.find((s) => s.id === currentId)?.name ?? "Select Site";

  return (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-1.5 rounded-lg bg-stone-100 dark:bg-stone-800/70 px-2.5 py-1.5">
        <span className="text-[10px] shrink-0 text-stone-400">🏢</span>
        <select
          value={currentId}
          onChange={handleChange}
          disabled={pending}
          className="flex-1 min-w-0 bg-transparent text-[12px] font-medium text-stone-700 dark:text-stone-200 focus:outline-none cursor-pointer truncate disabled:opacity-60"
          aria-label="Select active site"
        >
          {options.map((opt) => (
            <option key={opt.id} value={opt.id} className="bg-white dark:bg-stone-900">
              {opt.name}
            </option>
          ))}
        </select>
        {pending && (
          <span className="shrink-0 h-2.5 w-2.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
        )}
      </div>
    </div>
  );
}
