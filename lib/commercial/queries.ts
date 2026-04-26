/**
 * lib/commercial/queries.ts
 *
 * Data access layer for the commercial tracking module.
 * All queries run with the service_role key (bypasses RLS).
 * Called directly by server components and API route handlers.
 */

import { createClient } from "@supabase/supabase-js";

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommercialSummary = {
  mrr:             number;
  revenue_mtd:     number;
  expenses_mtd:    number;
  profit_mtd:      number;
  active_clients:  number;
  trial_clients:   number;
  churned_clients: number;
  total_clients:   number;
};

export type RevenueEvent = {
  id:          string;
  client_id:   string;
  amount:      number;
  event_type:  string;
  description: string | null;
  event_date:  string;
};

export type CommercialClientRow = {
  id:                  string;
  name:                string;
  contact_name:        string | null;
  contact_email:       string | null;
  status:              string;
  onboarded_at:        string | null;
  notes:               string | null;
  site_id:             string | null;
  site_name:           string | null;
  plan_name:           string | null;
  monthly_fee:         number;
  billing_cycle:       string | null;
  subscription_status: string | null;
  revenue_lifetime:    number;
  revenue_mtd:         number;
  recent_events:       RevenueEvent[];
};

// ── monthStart helper ─────────────────────────────────────────────────────────

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

// ── getCommercialSummary ──────────────────────────────────────────────────────

export async function getCommercialSummary(): Promise<CommercialSummary> {
  const db = serviceDb();
  const monthStart = currentMonthStart();

  const [mrrRes, revenueRes, expensesRes, clientsRes] = await Promise.all([
    db.from("commercial_subscriptions").select("monthly_fee").eq("status", "active"),
    db.from("commercial_revenue_events").select("amount").gte("event_date", monthStart),
    db.from("commercial_expenses").select("amount").gte("expense_date", monthStart),
    db.from("commercial_clients").select("status"),
  ]);

  const mrr          = (mrrRes.data      ?? []).reduce((s, r) => s + Number(r.monthly_fee), 0);
  const revenue_mtd  = (revenueRes.data  ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const expenses_mtd = (expensesRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const clients      = clientsRes.data   ?? [];

  return {
    mrr,
    revenue_mtd,
    expenses_mtd,
    profit_mtd:      revenue_mtd - expenses_mtd,
    active_clients:  clients.filter((c) => c.status === "active").length,
    trial_clients:   clients.filter((c) => c.status === "trial").length,
    churned_clients: clients.filter((c) => c.status === "churned").length,
    total_clients:   clients.length,
  };
}

// ── getCommercialClients ──────────────────────────────────────────────────────

export async function getCommercialClients(): Promise<CommercialClientRow[]> {
  const db = serviceDb();
  const monthStart = currentMonthStart();

  // 1. Client records
  const { data: clients } = await db
    .from("commercial_clients")
    .select("id, name, contact_name, contact_email, status, onboarded_at, notes, site_id")
    .order("created_at", { ascending: false });

  if (!clients || clients.length === 0) return [];

  const clientIds = clients.map((c) => c.id);

  // 2. Linked site names
  const siteIds = clients
    .filter((c) => c.site_id)
    .map((c) => c.site_id as string);

  const siteMap: Record<string, string> = {};
  if (siteIds.length > 0) {
    const { data: sites } = await db
      .from("sites")
      .select("id, name")
      .in("id", siteIds);
    for (const s of sites ?? []) siteMap[s.id] = s.name;
  }

  // 3. Active subscriptions per client
  const { data: subs } = await db
    .from("commercial_subscriptions")
    .select("client_id, plan_name, monthly_fee, billing_cycle, status")
    .in("client_id", clientIds)
    .eq("status", "active");

  const subMap: Record<string, typeof subs extends (infer T)[] | null ? T : never> = {};
  for (const s of subs ?? []) {
    if (!subMap[s.client_id]) subMap[s.client_id] = s;
  }

  // 4. Revenue events (for aggregation + last 6 per client for detail panel)
  const { data: events } = await db
    .from("commercial_revenue_events")
    .select("id, client_id, amount, event_type, description, event_date")
    .in("client_id", clientIds)
    .order("event_date", { ascending: false });

  const recentEventsMap:  Record<string, RevenueEvent[]> = {};
  const revLifetimeMap:   Record<string, number>         = {};
  const revMtdMap:        Record<string, number>         = {};

  for (const e of events ?? []) {
    if (!recentEventsMap[e.client_id]) recentEventsMap[e.client_id] = [];
    if (recentEventsMap[e.client_id].length < 6) recentEventsMap[e.client_id].push(e);
    revLifetimeMap[e.client_id] = (revLifetimeMap[e.client_id] ?? 0) + Number(e.amount);
    if (e.event_date >= monthStart) {
      revMtdMap[e.client_id] = (revMtdMap[e.client_id] ?? 0) + Number(e.amount);
    }
  }

  return clients.map((c) => {
    const sub = subMap[c.id];
    return {
      id:                  c.id,
      name:                c.name,
      contact_name:        c.contact_name,
      contact_email:       c.contact_email,
      status:              c.status,
      onboarded_at:        c.onboarded_at,
      notes:               c.notes,
      site_id:             c.site_id,
      site_name:           c.site_id ? (siteMap[c.site_id] ?? null) : null,
      plan_name:           sub?.plan_name ?? null,
      monthly_fee:         sub ? Number(sub.monthly_fee) : 0,
      billing_cycle:       sub?.billing_cycle ?? null,
      subscription_status: sub?.status ?? null,
      revenue_lifetime:    revLifetimeMap[c.id] ?? 0,
      revenue_mtd:         revMtdMap[c.id] ?? 0,
      recent_events:       recentEventsMap[c.id] ?? [],
    };
  });
}
