import { createServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/get-user-context";
import { redirect } from "next/navigation";
import { DailyOpsBoard } from "@/components/dashboard/daily-ops/DailyOpsBoard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DailyOpsPage() {
  let ctx;
  try {
    ctx = await getUserContext();
  } catch {
    redirect("/login");
  }

  const supabase = createServerClient() as any;
  // Use site timezone (Africa/Johannesburg = UTC+2) so the date matches what
  // staff see on the clock, not the Vercel server's UTC time.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

  // Auto-generate today's tasks if not yet created
  const { count } = await supabase
    .from("daily_ops_tasks")
    .select("id", { count: "exact", head: true })
    .eq("site_id", ctx.siteId)
    .eq("task_date", today);

  if ((count ?? 0) === 0) {
    // Get templates
    const { data: siteTemplates } = await supabase
      .from("daily_ops_task_templates")
      .select("*")
      .eq("site_id", ctx.siteId)
      .eq("is_active", true)
      .order("sort_order");

    const { data: globalTemplates } = await supabase
      .from("daily_ops_task_templates")
      .select("*")
      .is("site_id", null)
      .eq("is_active", true)
      .order("sort_order");

    const templates = (siteTemplates && siteTemplates.length > 0) ? siteTemplates : (globalTemplates ?? []);

    if (templates.length > 0) {
      await supabase.from("daily_ops_tasks").insert(
        templates.map((t: any) => ({
          site_id: ctx.siteId,
          template_id: t.id,
          task_date: today,
          action_name: t.action_name,
          department: t.department,
          priority: t.default_priority,
          due_time: t.default_due_time,
          sla_description: t.sla_description,
          sort_order: t.sort_order,
          status: "not_started",
          created_by: ctx.userId,
        }))
      );
    }
  }

  // Fetch today's tasks
  const { data: tasks } = await supabase
    .from("daily_ops_tasks")
    .select("*")
    .eq("site_id", ctx.siteId)
    .eq("task_date", today)
    .order("sort_order");

  // Fetch team members for assignment
  const { data: team } = await supabase
    .from("profiles")
    .select("id, full_name, email");

  return (
    <div className="space-y-6">
      <DailyOpsBoard
        initialTasks={(tasks ?? []) as any}
        team={(team ?? []).map((p: any) => ({ id: p.id, name: p.full_name || p.email }))}
        date={today}
      />
    </div>
  );
}
