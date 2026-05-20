"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

type DayScore = {
  date: string;
  score: number;
  completionRate: number;
  onTimeRate: number;
  tasksAssigned: number;
  tasksCompleted: number;
};

function barColor(score: number): string {
  if (score >= 90) return "#34d399"; // emerald-400
  if (score >= 75) return "#38bdf8"; // sky-400
  if (score >= 60) return "#fbbf24"; // amber-400
  return "#f87171";                  // red-400
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

export default function DailyScoreChart({ data }: { data: DayScore[] }) {
  // Sort ascending for chart display (oldest → newest left to right)
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  const chartData = sorted.map((d) => ({
    label: formatDate(d.date),
    score: d.score,
    completionRate: d.completionRate,
    onTimeRate: d.onTimeRate,
    tasksAssigned: d.tasksAssigned,
    tasksCompleted: d.tasksCompleted,
    date: d.date,
  }));

  if (chartData.length === 0) return null;

  return (
    <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-stone-500">
          Daily Score — 30 Day Trend
        </p>
        {/* Legend */}
        <div className="flex items-center gap-3">
          {[
            { color: "bg-emerald-400", label: "90+" },
            { color: "bg-sky-400", label: "75+" },
            { color: "bg-amber-400", label: "60+" },
            { color: "bg-red-400", label: "<60" },
          ].map((l) => (
            <div key={l.label} className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${l.color}`} />
              <span className="text-[8px] font-mono text-stone-500">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#292524"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "#78716c" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 9, fill: "#78716c" }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine
              y={60}
              stroke="#f87171"
              strokeDasharray="4 4"
              strokeOpacity={0.4}
            />
            <ReferenceLine
              y={75}
              stroke="#38bdf8"
              strokeDasharray="4 4"
              strokeOpacity={0.2}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
              contentStyle={{
                backgroundColor: "#1c1917",
                border: "1px solid #292524",
                borderRadius: "8px",
                fontSize: "11px",
                color: "#e7e5e4",
              }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-[#1c1917] border border-[#292524] rounded-lg px-3 py-2 text-[11px] text-stone-300 space-y-0.5">
                    <p className="font-semibold text-stone-100">{d.date}</p>
                    <p>Score: <span className="font-mono font-bold" style={{ color: barColor(d.score) }}>{d.score}</span></p>
                    <p>Completion: <span className="font-mono">{d.completionRate}%</span></p>
                    <p>On-time: <span className="font-mono">{d.onTimeRate}%</span></p>
                    <p className="text-stone-500">{d.tasksCompleted}/{d.tasksAssigned} tasks</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="score" radius={[2, 2, 0, 0]} maxBarSize={18}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={barColor(entry.score)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
