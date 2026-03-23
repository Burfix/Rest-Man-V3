/**
 * HourlyDemandChart — Visualises hourly sales and covers forecast
 *
 * Uses recharts AreaChart for a clean, premium look.
 */

"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { HourlySlot } from "@/types/forecast";

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

export default function HourlyDemandChart({
  hourly,
  peakWindow,
}: {
  hourly: HourlySlot[];
  peakWindow: string;
}) {
  const data = hourly.map((s) => ({
    hour: formatHour(s.hour),
    Sales: s.forecastSales,
    Covers: s.forecastCovers,
  }));

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-blue-50 dark:bg-blue-950/50">
            <span className="text-sm">📊</span>
          </div>
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            Hourly Demand Forecast
          </h3>
        </div>
        <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 rounded-full px-2 py-0.5">
          Peak: {peakWindow}
        </span>
      </div>

      {/* Chart */}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="coversGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" strokeOpacity={0.5} />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1c1917",
                border: "1px solid #292524",
                borderRadius: "8px",
                fontSize: "11px",
                color: "#e7e5e4",
              }}
              formatter={(value: unknown, name: unknown) => {
                const v = Number(value);
                const n = String(name);
                return n === "Sales" ? [`R${v.toLocaleString()}`, n] : [v, n];
              }}
            />
            <Area
              type="monotone"
              dataKey="Sales"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#salesGrad)"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
            <Area
              type="monotone"
              dataKey="Covers"
              stroke="#10b981"
              strokeWidth={1.5}
              fill="url(#coversGrad)"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500" />
          <span className="text-[10px] text-stone-500 dark:text-stone-400">Forecast Sales (R)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-[10px] text-stone-500 dark:text-stone-400">Forecast Covers</span>
        </div>
      </div>
    </div>
  );
}
