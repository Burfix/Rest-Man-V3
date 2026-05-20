"use client";

/**
 * AutoRefresh — silently calls router.refresh() on a fixed interval
 * so that server-component data (sales, labour, etc.) stays current
 * while the user is on the dashboard.
 *
 * Default: every 5 minutes. Override via the `intervalMs` prop.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface AutoRefreshProps {
  intervalMs?: number;
}

export default function AutoRefresh({ intervalMs = 5 * 60 * 1000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
