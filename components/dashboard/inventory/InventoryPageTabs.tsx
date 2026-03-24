/**
 * InventoryPageTabs — Tab switcher for Stock on Hand vs Food Cost & Ordering.
 */

"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tab = "stock" | "inventory";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "stock",     label: "Stock on Hand",         icon: "📦" },
  { key: "inventory", label: "Food Cost & Ordering",  icon: "📊" },
];

type Props = {
  stockOnHand: ReactNode;
  inventoryClient: ReactNode;
};

export default function InventoryPageTabs({ stockOnHand, inventoryClient }: Props) {
  const [tab, setTab] = useState<Tab>("stock");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 shadow-sm">
          <span className="text-lg text-white">📦</span>
        </div>
        <div>
          <h1 className="text-lg font-bold text-stone-900 dark:text-stone-100">Inventory</h1>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Stock levels, food cost tracking & ordering
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-200 dark:border-stone-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors",
              tab === t.key
                ? "border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100"
                : "border-transparent text-stone-400 dark:text-stone-600 hover:text-stone-600 dark:hover:text-stone-400",
            )}
          >
            <span className="text-sm">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "stock" ? stockOnHand : inventoryClient}
    </div>
  );
}
