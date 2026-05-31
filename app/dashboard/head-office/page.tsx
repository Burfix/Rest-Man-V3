/**
 * Head Office Control Tower
 *
 * Auth-only server shell. All data fetching and rendering is handled
 * by HeadOfficeClient, which calls /api/head-office/summary on mount.
 */

import { getUserContext } from "@/lib/auth/get-user-context";
import { redirect }       from "next/navigation";
import HeadOfficeClient   from "@/components/dashboard/head-office/HeadOfficeClient";
import { ELEVATED_ROLES } from "@/lib/rbac/roles";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export default async function HeadOfficePage() {
  let ctx;
  try {
    ctx = await getUserContext();
  } catch {
    redirect("/login");
  }

  if (!ELEVATED_ROLES.has(ctx.role)) {
    redirect("/dashboard");
  }

  return <HeadOfficeClient />;
}
