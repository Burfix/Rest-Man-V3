/**
 * Service Window Engine
 *
 * getServiceWindow(now, timezone?) → ServiceWindowInfo
 *
 * Determines the current service window based on time of day.
 * Windows are tuned for a Primi-style all-day restaurant.
 */

import type { ServiceWindow, ServiceWindowInfo } from "./types";

// ── Window definitions (HH:mm boundaries, local time) ────────────────────────

const WINDOWS: Array<{ window: ServiceWindow; label: string; start: string; end: string }> = [
  { window: "pre_open",        label: "Pre-Open",        start: "06:00", end: "08:30"  },
  { window: "breakfast",       label: "Breakfast",       start: "08:30", end: "11:00"  },
  { window: "lunch_build",     label: "Lunch Build-Up",  start: "11:00", end: "12:00"  },
  { window: "lunch_peak",      label: "Lunch Peak",      start: "12:00", end: "14:30"  },
  { window: "afternoon_lull",  label: "Afternoon Lull",  start: "14:30", end: "17:30"  },
  { window: "dinner_build",    label: "Dinner Build-Up", start: "17:30", end: "19:00"  },
  { window: "dinner_peak",     label: "Dinner Peak",     start: "19:00", end: "21:30"  },
  { window: "close",           label: "Close",           start: "21:30", end: "06:00"  },
];

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function localMinutes(now: Date, tz: string): number {
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  return local.getHours() * 60 + local.getMinutes();
}

export function getServiceWindow(
  now: Date = new Date(),
  timezone = "Africa/Johannesburg",
): ServiceWindowInfo {
  const mins = localMinutes(now, timezone);

  for (let i = 0; i < WINDOWS.length; i++) {
    const w = WINDOWS[i];
    const start = parseHHMM(w.start);
    const end = parseHHMM(w.end);

    // Handle the close window that wraps past midnight
    if (w.window === "close") {
      if (mins >= start || mins < end) {
        const remaining = mins >= start ? (24 * 60 - mins) + end : end - mins;
        return {
          window: w.window,
          label: w.label,
          startsAt: w.start,
          endsAt: w.end,
          isActive: true,
          minutesRemaining: remaining,
          nextWindow: "pre_open",
        };
      }
      continue;
    }

    if (mins >= start && mins < end) {
      const remaining = end - mins;
      const nextIdx = (i + 1) % WINDOWS.length;
      return {
        window: w.window,
        label: w.label,
        startsAt: w.start,
        endsAt: w.end,
        isActive: true,
        minutesRemaining: remaining,
        nextWindow: WINDOWS[nextIdx].window,
      };
    }
  }

  // Fallback — should not reach
  return {
    window: "close",
    label: "Close",
    startsAt: "21:30",
    endsAt: "06:00",
    isActive: true,
    minutesRemaining: null,
    nextWindow: "pre_open",
  };
}

/**
 * Returns true if the current window is a revenue-generating period.
 */
export function isRevenueWindow(window: ServiceWindow): boolean {
  return ["breakfast", "lunch_build", "lunch_peak", "dinner_build", "dinner_peak"].includes(window);
}

/**
 * Returns true if the current window is a peak period.
 */
export function isPeakWindow(window: ServiceWindow): boolean {
  return window === "lunch_peak" || window === "dinner_peak";
}

/**
 * Returns the urgency multiplier for the window.
 * Peak windows amplify urgency of decisions.
 */
export function windowUrgencyMultiplier(window: ServiceWindow): number {
  switch (window) {
    case "lunch_peak":
    case "dinner_peak":
      return 1.5;
    case "lunch_build":
    case "dinner_build":
      return 1.25;
    case "breakfast":
    case "afternoon_lull":
      return 1.0;
    case "pre_open":
    case "close":
      return 0.75;
  }
}
