"use client";

/**
 * ThemeToggle — compact 3-way toggle: Auto / Light / Dark
 * Rendered in the sidebar footer.
 */

import { useTheme } from "@/components/ThemeProvider";
import type { Override } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";

type ToggleOption = { value: Override; label: string; icon: string };

const OPTIONS: ToggleOption[] = [
  { value: "auto",  label: "Auto",  icon: "⏰" },
  { value: "light", label: "Light", icon: "☀️" },
  { value: "dark",  label: "Dark",  icon: "🌙" },
];

export default function ThemeToggle() {
  const { override, setOverride, theme } = useTheme();

  return (
    <div className="px-3 py-3 border-t border-stone-200 dark:border-stone-700">
      <p className="mb-1.5 px-1 text-[9px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-600">
        Appearance
      </p>
      <div className="flex gap-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 p-0.5">
        {OPTIONS.map((opt) => {
          const active = override === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setOverride(opt.value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[10px] font-semibold transition-colors",
                active
                  ? "bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm"
                  : "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
              )}
              title={
                opt.value === "auto"
                  ? `Auto (currently ${theme})`
                  : opt.label
              }
            >
              <span>{opt.icon}</span>
              <span className="hidden sm:inline">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
