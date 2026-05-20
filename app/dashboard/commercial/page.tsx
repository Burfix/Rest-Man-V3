/**
 * /dashboard/commercial
 *
 * Commercial tracking dashboard — clients, subscriptions, revenue, expenses.
 * Server component: fetches data and passes to the interactive client layer.
 *
 * Auth: super_admin | executive | head_office | tenant_owner only.
 */

import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth/get-user-context";
import { getCommercialSummary, getCommercialClients } from "@/lib/commercial/queries";
import CommercialClient from "@/components/dashboard/commercial/CommercialClient";

export const dynamic = "force-dynamic";

const ALLOWED = ["super_admin", "executive", "head_office", "tenant_owner"];

export default async function CommercialPage() {
  let ctx;
  try {
    ctx = await getUserContext();
  } catch {
    redirect("/login");
  }

  if (!ALLOWED.includes(ctx.role ?? "")) {
    redirect("/dashboard");
  }

  const [summary, clients] = await Promise.all([
    getCommercialSummary(),
    getCommercialClients(),
  ]);

  return <CommercialClient summary={summary} clients={clients} />;
}
