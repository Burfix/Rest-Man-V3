/**
 * RecommendedActions — Reuses WhatToDoNow structure for GM Co-Pilot.
 *
 * Consistency with Command Center. Same execution-first format.
 */

"use client";

import WhatToDoNow from "@/components/operating-brain/WhatToDoNow";
import type { OperatingDecision } from "@/services/decision-engine";

type Props = {
  decisions: OperatingDecision[];
};

export default function RecommendedActions({ decisions }: Props) {
  return <WhatToDoNow decisions={decisions} />;
}
