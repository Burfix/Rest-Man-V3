"use client";

/**
 * AdoptionTrackerMount
 *
 * Mounts the adoption tracking hook inside the dashboard layout.
 * This is a zero-UI component — it renders nothing visible.
 * It lives at the layout level so it fires on every page navigation.
 */

import { useAdoptionTracker } from "@/lib/adoption/client-tracker";

export default function AdoptionTrackerMount() {
  useAdoptionTracker();
  return null;
}
