/**
 * Actions service — centralised action CRUD + analytics
 */

import { createServerClient } from "@/lib/supabase/server";
import type { Action, ActionCreateInput, ActionStats } from "@/types/actions";

const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";

/* ── Read ─────────────────────────────────────────────────────────────────── */

export async function getActiveActions(): Promise<Action[]> {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("actions")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Action[];
}

export async function getActionById(id: string): Promise<Action | null> {
  const sb = createServerClient();
  const { data, error } = await sb.from("actions").select("*").eq("id", id).single();
  if (error) return null;
  return data as Action;
}

export async function getOverdueActions(): Promise<Action[]> {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("actions")
    .select("*")
    .is("archived_at", null)
    .neq("status", "completed")
    .not("due_at", "is", null)
    .lt("due_at", new Date().toISOString())
    .order("due_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Action[];
}

export async function getUrgentOpenActions(): Promise<Action[]> {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("actions")
    .select("*")
    .is("archived_at", null)
    .neq("status", "completed")
    .in("impact_weight", ["critical", "high"])
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Action[];
}

/* ── Stats ────────────────────────────────────────────────────────────────── */

export async function getActionStats(): Promise<ActionStats> {
  const sb = createServerClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [activeRes, overdueRes, todayCompletedRes, weekRes] = await Promise.all([
    sb.from("actions").select("id, status, impact_weight, due_at").is("archived_at", null),
    sb.from("actions").select("id")
      .is("archived_at", null)
      .neq("status", "completed")
      .not("due_at", "is", null)
      .lt("due_at", new Date().toISOString()),
    sb.from("actions").select("id")
      .not("completed_at", "is", null)
      .gte("completed_at", todayStart.toISOString()),
    sb.from("actions").select("created_at, completed_at")
      .not("completed_at", "is", null)
      .gte("completed_at", new Date(Date.now() - 7 * 86400000).toISOString()),
  ]);

  const active = (activeRes.data ?? []) as Array<{ id: string; status: string; impact_weight: string; due_at: string | null }>;
  const pending    = active.filter(a => a.status === "pending").length;
  const inProgress = active.filter(a => a.status === "in_progress").length;
  const completed  = active.filter(a => a.status === "completed").length;
  const urgentOpen = active.filter(a => a.status !== "completed" && ["critical", "high"].includes(a.impact_weight)).length;
  const overdue    = overdueRes.data?.length ?? 0;
  const completedToday = todayCompletedRes.data?.length ?? 0;
  const total = active.length;

  let avgResolutionMin: number | null = null;
  const weekData = (weekRes.data ?? []) as Array<{ created_at: string; completed_at: string }>;
  if (weekData.length > 0) {
    const totalMs = weekData.reduce((s, a) =>
      s + (new Date(a.completed_at).getTime() - new Date(a.created_at).getTime()), 0);
    avgResolutionMin = Math.round(totalMs / weekData.length / 60_000);
  }

  return {
    total,
    pending,
    inProgress,
    completed,
    overdue,
    urgentOpen,
    completedToday,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    avgResolutionMin,
  };
}

/* ── Write ────────────────────────────────────────────────────────────────── */

export async function createAction(input: ActionCreateInput): Promise<Action> {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("actions")
    .insert({
      title:           input.title.trim(),
      description:     input.description?.trim() || null,
      impact_weight:   input.impact_weight || "medium",
      category:        input.category || null,
      assigned_to:     input.assigned_to?.trim() || null,
      assignee_role:   input.assignee_role?.trim() || null,
      due_at:          input.due_at || null,
      expected_impact: input.expected_impact?.trim() || null,
      why_it_matters:  input.why_it_matters?.trim() || null,
      source_type:     input.source_type || null,
      source_module:   input.source_module || null,
      source_id:       input.source_id || null,
      execution_type:  input.execution_type || null,
      site_id:         DEFAULT_SITE_ID,
      status:          "pending",
    })
    .select()
    .single();

  if (error) throw error;
  return data as Action;
}

export async function completeAction(id: string, note?: string): Promise<Action> {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("actions")
    .update({
      status:          "completed",
      completed_at:    new Date().toISOString(),
      completion_note: note?.trim() || null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Action;
}

export async function startAction(id: string): Promise<Action> {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("actions")
    .update({
      status:     "in_progress",
      started_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Action;
}

export async function assignAction(id: string, name: string, role?: string): Promise<Action> {
  const sb = createServerClient();
  const update: Record<string, string | null> = { assigned_to: name.trim() };
  if (role) update.assignee_role = role.trim();

  const { data, error } = await sb
    .from("actions")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Action;
}

export async function dismissAction(id: string, note?: string): Promise<Action> {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("actions")
    .update({
      archived_at:     new Date().toISOString(),
      completion_note: note?.trim() || "Dismissed",
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Action;
}

/* ── Auto-generate actions from module alerts ─────────────────────────────── */

export async function generateStockActions(): Promise<Action[]> {
  const sb = createServerClient();

  // Find critical stock items
  const { data: items } = await sb
    .from("inventory_items")
    .select("id, name, current_stock, avg_daily_usage, minimum_threshold, supplier_name")
    .gt("avg_daily_usage", 0);

  if (!items || items.length === 0) return [];

  const created: Action[] = [];

  for (const item of items) {
    const daysRemaining = item.current_stock / item.avg_daily_usage;
    const belowMinimum = item.current_stock <= (item.minimum_threshold ?? 0);

    if (daysRemaining > 3 && !belowMinimum) continue;

    const isCritical = daysRemaining <= 2 || item.current_stock <= 0;
    const title = isCritical
      ? `URGENT: Order ${item.name} — ${daysRemaining <= 0 ? "out of stock" : `${daysRemaining.toFixed(1)} days left`}`
      : `Order ${item.name} — ${daysRemaining.toFixed(1)} days remaining`;

    // Check if similar action already exists (not completed)
    const { data: existing } = await sb
      .from("actions")
      .select("id")
      .is("archived_at", null)
      .neq("status", "completed")
      .eq("category", "stock")
      .ilike("title", `%${item.name}%`)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const action = await createAction({
      title,
      description: `${item.name} stock is low. Current: ${item.current_stock} units. Daily usage: ${item.avg_daily_usage}. Supplier: ${item.supplier_name ?? "Unknown"}.`,
      impact_weight: isCritical ? "critical" : "high",
      category: "stock",
      source_module: "inventory",
      expected_impact: isCritical
        ? "Risk of stockout impacting service and menu availability"
        : "Prevents potential stockout before next delivery window",
      why_it_matters: `${item.name} has ${daysRemaining.toFixed(1)} days of stock remaining at current usage rates`,
      execution_type: "order",
    });

    created.push(action);
  }

  return created;
}
