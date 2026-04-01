"use client";

import { useRouter } from "next/navigation";

export default function SyncNowButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.refresh()}
      className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em] text-stone-600 dark:text-stone-500 border border-[#e2e2e0] dark:border-[#2a2a2a] px-2 py-0.5 hover:text-[#0a0a0a] dark:hover:text-stone-300 hover:border-stone-400 dark:hover:border-stone-600 transition-colors w-fit"
    >
      SYNC NOW
    </button>
  );
}
