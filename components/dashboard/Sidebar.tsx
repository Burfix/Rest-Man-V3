"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

// ── Nav data ──────────────────────────────────────────────────────────────────

type NavItem = {
  href:  string;
  label: string;
  icon:  string;
  soon?: boolean;
};

type NavGroup = {
  group: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    group: "",
    items: [
      { href: "/dashboard",         label: "Command Center", icon: "⚡" },
      { href: "/dashboard/actions", label: "Actions",        icon: "✅" },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/dashboard/compliance",  label: "Compliance",   icon: "📋" },
      { href: "/dashboard/maintenance", label: "Maintenance",  icon: "🔧" },
      { href: "/dashboard/operations",  label: "Daily Ops",    icon: "📊" },
      { href: "/dashboard/heatmap",     label: "Zone Heatmap", icon: "🗺️" },
      { href: "#",                      label: "Incidents",    icon: "🚨", soon: true },
    ],
  },
  {
    group: "Service",
    items: [
      { href: "/dashboard/bookings",    label: "Bookings",    icon: "📅" },
      { href: "/dashboard/escalations", label: "Escalations", icon: "⚠️" },
      { href: "/dashboard/events",      label: "Events",      icon: "🎉" },
      { href: "#",                      label: "Floor Notes",  icon: "📝", soon: true },
    ],
  },
  {
    group: "Finance",
    items: [
      { href: "/dashboard/settings/targets", label: "Revenue Targets", icon: "🎯" },
      { href: "/dashboard/sales",            label: "Sales",           icon: "💰" },
      { href: "/dashboard/sales/historical", label: "Historical",      icon: "📈" },
      { href: "#",                           label: "Forecast",        icon: "🔮", soon: true },
    ],
  },
  {
    group: "Reputation",
    items: [
      { href: "/dashboard/reviews", label: "Reviews", icon: "⭐" },
    ],
  },
  {
    group: "Assets",
    items: [
      { href: "/dashboard/maintenance", label: "Equipment",    icon: "🏭" },
      { href: "#",                      label: "Contractors",  icon: "👷", soon: true },
      { href: "#",                      label: "Warranties",   icon: "🛡️", soon: true },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/dashboard/settings",              label: "Settings",     icon: "⚙️" },
      { href: "/dashboard/settings/integrations", label: "Integrations", icon: "🔌" },
    ],
  },
];

// ── Nav list ──────────────────────────────────────────────────────────────────

function NavList({
  pathname,
  onNavClick,
}: {
  pathname: string;
  onNavClick?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {NAV.map((group, gi) => (
        <div key={gi}>
          {group.group && (
            <p className="mb-1 px-2 text-[9px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600">
              {group.group}
            </p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const isActive =
                item.soon ? false :
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href + item.label}
                  href={item.soon ? "#" : item.href}
                  onClick={item.soon ? undefined : onNavClick}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors group",
                    item.soon
                      ? "cursor-default opacity-40"
                      : isActive
                      ? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                      : "text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/60 hover:text-stone-800 dark:hover:text-stone-200"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm w-4 text-center shrink-0">{item.icon}</span>
                    <span className="text-[13px] font-medium leading-none">{item.label}</span>
                  </div>
                  {item.soon && (
                    <span className="rounded bg-stone-200 dark:bg-stone-700 px-1 py-px text-[9px] font-semibold text-stone-500 dark:text-stone-400 tracking-wide">
                      SOON
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface Props {
  footer?: React.ReactNode;
}

export default function Sidebar({ footer }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:w-56 flex-col border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shrink-0">
        {/* Brand header */}
        <div className="flex h-14 items-center gap-3 px-4 border-b border-stone-100 dark:border-stone-800 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-stone-900 shrink-0">
            <span className="text-xs font-bold text-white">OE</span>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-stone-900 dark:text-stone-100 leading-tight truncate">
              Ops Engine
            </p>
            <p className="text-[10px] text-stone-400 dark:text-stone-600 leading-none">Operations</p>
          </div>
        </div>

        <NavList pathname={pathname} />
        {footer}
      </aside>

      {/* ── Mobile top bar ───────────────────────────────────────────── */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-30 flex h-14 items-center justify-between border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 px-4">
        <div className="flex items-center gap-2.5">
          <div className="h-6 w-6 flex items-center justify-center rounded-md bg-stone-900">
            <span className="text-[10px] font-bold text-white">OE</span>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-stone-900 dark:text-stone-100 leading-tight">Ops Engine</p>
            <p className="text-[9px] text-stone-400 dark:text-stone-600 leading-none">Operations</p>
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <rect y="3" width="20" height="2" rx="1" />
            <rect y="9" width="20" height="2" rx="1" />
            <rect y="15" width="20" height="2" rx="1" />
          </svg>
        </button>
      </header>

      {/* ── Mobile drawer ────────────────────────────────────────────── */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-50 flex w-72 max-w-[85vw] flex-col bg-white dark:bg-stone-950 shadow-xl dark:shadow-stone-900">
            <div className="flex h-14 items-center justify-between border-b border-stone-100 dark:border-stone-800 px-4 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-6 w-6 flex items-center justify-center rounded-md bg-stone-900">
                  <span className="text-[10px] font-bold text-white">OE</span>
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-stone-900 dark:text-stone-100">Ops Engine</p>
                  <p className="text-[9px] text-stone-400 dark:text-stone-600">Operations</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 dark:text-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.22 3.22a.75.75 0 0 1 1.06 0L8 6.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L9.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L8 9.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L6.94 8 3.22 4.28a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
            </div>

            <NavList pathname={pathname} onNavClick={() => setOpen(false)} />
            {footer}
          </div>
        </div>
      )}
    </>
  );
}
