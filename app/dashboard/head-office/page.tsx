/**
 * Head Office Control Tower
 *
 * Auth-only server shell. All data fetching and rendering is handled
 * by HeadOfficeClient, which calls /api/head-office/summary on mount.
 */

import { getUserContext } from "@/lib/auth/get-user-context";
import { redirect }       from "next/navigation";
import HeadOfficeClient   from "@/components/dashboard/head-office/HeadOfficeClient";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

const ELEVATED = ["super_admin", "executive", "head_office", "area_manager", "tenant_owner"];

export default async function HeadOfficePage() {
  let ctx;
  try {
    ctx = await getUserContext();
  } catch {
    redirect("/login");
  }

  if (!ELEVATED.includes(ctx.role ?? "")) {
    redirect("/dashboard");
  }

  return <HeadOfficeClient />;
}
