/**
 * app/dashboard/profit/page.tsx
 *
 * Profit Intelligence — the client-facing P&L module.
 *
 * Access: GM, executive, head_office, tenant_owner, area_manager, super_admin.
 * GMs see their own site. Head office / executive see multi-store view.
 */

import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth/get-user-context";
import { getProfitIntelligence, getGroupProfitIntelligence } from "@/lib/profit/engine";
import { ProfitIntelligenceClient } from "@/components/dashboard/profit/ProfitIntelligenceClient";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = [
  "super_admin",
  "executive",
  "head_office",
  "tenant_owner",
  "area_manager",
  "gm",
];

const ORG_ROLES = [
  "super_admin",
  "executive",
  "head_office",
  "tenant_owner",
  "area_manager",
];

export default async function ProfitIntelligencePage() {
  let ctx;
  try {
    ctx = await getUserContext();
  } catch {
    redirect("/login");
  }

  if (!ALLOWED_ROLES.includes(ctx.role ?? "")) {
    redirect("/dashboard");
  }

  if (!ctx.siteId) {
    redirect("/dashboard");
  }

  const isOrgUser = ORG_ROLES.includes(ctx.role ?? "");

  const [initialData, initialGroupData] = await Promise.all([
    getProfitIntelligence(ctx.siteId, "today"),
    isOrgUser && ctx.orgId
      ? getGroupProfitIntelligence(ctx.orgId, "today").catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <ProfitIntelligenceClient
      initialData={initialData}
      initialGroupData={initialGroupData}
      isOrgUser={isOrgUser}
      siteId={ctx.siteId}
      currencySymbol={initialData.currencySymbol}
    />
  );
}
