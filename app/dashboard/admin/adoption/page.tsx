import { getUserContext } from "@/lib/auth/get-user-context";
import { redirect } from "next/navigation";
import { computePlatformAnalytics } from "@/lib/adoption/scores";
import PlatformAdoptionClient from "@/components/admin/adoption/PlatformAdoptionClient";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Platform Adoption — ForgeStack",
};

export default async function PlatformAdoptionPage() {
  // ── Super-admin gate (server-side) ─────────────────────────────────────────
  const ctx = await getUserContext();
  if (ctx.role !== "super_admin") {
    redirect("/dashboard");
  }

  // ── Data fetch ─────────────────────────────────────────────────────────────
  let analytics = null;
  let fetchError: string | null = null;

  try {
    analytics = await computePlatformAnalytics();
  } catch (err) {
    fetchError = String(err);
  }

  return (
    <PlatformAdoptionClient
      initialData={analytics}
      fetchError={fetchError}
    />
  );
}
