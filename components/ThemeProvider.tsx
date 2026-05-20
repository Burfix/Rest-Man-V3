"use client";

/**
 * ThemeProvider — time-dependent dark mode
 *
 * Dark mode is active outside daylight hours:
 *   dark  →  18:00 – 05:59  (evening / night)
 *   light →  06:00 – 17:59  (day)
 *
 * Re-evaluates every 60 seconds so the transition happens automatically.
 * Applies/removes the `dark` class on <html> — works with Tailwind `darkMode: "class"`.
 *
 * Also persists a manual override in localStorage:
 *   "theme" = "dark" | "light" | null (auto)
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";

type Theme = "dark" | "light";
export type Override = "dark" | "light" | "auto";

interface ThemeCtx {
  theme:    Theme;       // resolved theme currently active
  override: Override;    // user preference
  setOverride: (o: Override) => void;
}

const Ctx = createContext<ThemeCtx>({
  theme:       "light",
  override:    "auto",
  setOverride: () => undefined,
});

export function useTheme() {
  return useContext(Ctx);
}

// Determine theme from current hour (local time)
function timeBasedTheme(): Theme {
  const hour = new Date().getHours();
  return hour >= 18 || hour < 6 ? "dark" : "light";
}

function resolveTheme(override: Override): Theme {
  if (override === "dark")  return "dark";
  if (override === "light") return "light";
  return timeBasedTheme();
}

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [override, setOverrideState] = useState<Override>("auto");
  const [theme, setTheme] = useState<Theme>("light");

  // Apply class to <html>
  const applyTheme = useCallback((t: Theme) => {
    const root = document.documentElement;
    if (t === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    setTheme(t);
  }, []);

  // Initial load: read saved override from localStorage
  useEffect(() => {
    const saved = (localStorage.getItem("theme") ?? "auto") as Override;
    setOverrideState(saved);
    applyTheme(resolveTheme(saved));
  }, [applyTheme]);

  // Re-check every 60 s (auto mode only)
  useEffect(() => {
    const tick = () => {
      setOverrideState((prev) => {
        const resolved = resolveTheme(prev);
        applyTheme(resolved);
        return prev;
      });
    };

    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [applyTheme]);

  const setOverride = useCallback(
    (o: Override) => {
      localStorage.setItem("theme", o);
      setOverrideState(o);
      applyTheme(resolveTheme(o));
    },
    [applyTheme]
  );

  return (
    <Ctx.Provider value={{ theme, override, setOverride }}>
      {children}
    </Ctx.Provider>
  );
}
