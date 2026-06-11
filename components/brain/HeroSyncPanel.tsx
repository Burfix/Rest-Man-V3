"use client";

import { useRouter } from "next/navigation";
import type { CommandCenterSyncResponse } from "@/lib/command-center/types";
import SyncNowButton from "./SyncNowButton";

type Props = {
  siteId: string;
  freshnessMinutes?: number;
  servicePeriod: string;
  saTimeStr: string;
};

export default function HeroSyncPanel({
  siteId,
  freshnessMinutes,
  servicePeriod,
  saTimeStr,
}: Props) {
  const router = useRouter();

  function handleSyncComplete(response: CommandCenterSyncResponse) {
    if (response.state) {
      window.dispatchEvent(
        new CustomEvent<CommandCenterSyncResponse>("commandcenter:stateupdate", {
          detail: response,
        }),
      );
      return;
    }

    router.refresh();
  }

  return (
    <div className="px-5 py-3 flex flex-col justify-center gap-1.5">
      <span className="text-[10px] font-mono font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
        {servicePeriod} · {saTimeStr}
      </span>
      <SyncNowButton
        siteId={siteId}
        freshnessMinutes={freshnessMinutes}
        onSyncComplete={handleSyncComplete}
      />
    </div>
  );
}
