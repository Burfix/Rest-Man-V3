/**
 * components/dashboard/profit/ProfitEmptyState.tsx
 *
 * Shown when no sales or labour data is available.
 * Clear, actionable — never shows ugly zeros.
 */

"use client";

const SETUP_STEPS = [
  {
    icon: "⚡",
    title: "Connect MICROS sales",
    description: "Live sales feed enables real-time profit tracking.",
  },
  {
    icon: "👥",
    title: "Sync labour data",
    description: "Labour cost and schedule data allows margin calculation.",
  },
  {
    icon: "🍽",
    title: "Configure food cost target",
    description: "Set your target food cost percentage in Profit Settings.",
  },
  {
    icon: "🏢",
    title: "Add overhead estimate",
    description: "Daily overhead lets us calculate operating profit accurately.",
  },
];

export function ProfitEmptyState() {
  return (
    <div className="flex flex-col items-center py-16 px-6 text-center max-w-lg mx-auto">
      <div className="w-14 h-14 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center mb-5 text-2xl">
        📊
      </div>

      <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 mb-2">
        Profit Intelligence requires data to calculate margin
      </h2>
      <p className="text-sm text-stone-500 dark:text-stone-400 mb-8 leading-relaxed">
        Connect your sales and labour feeds, then configure cost targets to unlock
        real-time profit visibility, leak detection, and margin analysis.
      </p>

      <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SETUP_STEPS.map((step) => (
          <div
            key={step.title}
            className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-4 text-left"
          >
            <div className="text-xl mb-2">{step.icon}</div>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 mb-1">
              {step.title}
            </p>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-relaxed">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
