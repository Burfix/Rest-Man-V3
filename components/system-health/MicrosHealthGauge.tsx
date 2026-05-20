/**
 * MICROS Health Gauge — circular progress ring showing 0-100 health score.
 * Colour follows severity: emerald = healthy, amber = warning, red = critical.
 */
"use client";

import React from "react";

interface Props {
  score: number;
  severity: "healthy" | "warning" | "critical";
  size?: number;
}

const COLORS = {
  healthy:  "#10b981", // emerald-500
  warning:  "#f59e0b", // amber-500
  critical: "#ef4444", // red-500
} as const;

export default function MicrosHealthGauge({ score, severity, size = 64 }: Props) {
  const r      = (size / 2) - 6;
  const circ   = 2 * Math.PI * r;
  const offset = circ - (Math.max(0, Math.min(100, score)) / 100) * circ;
  const color  = COLORS[severity];

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f2937" strokeWidth={6} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={6} fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <span className="text-xs font-bold tabular-nums" style={{ color, marginTop: -size * 0.85, position: "relative", zIndex: 1, lineHeight: 1 }}>
        {score}
      </span>
    </div>
  );
}
