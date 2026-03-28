"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewData {
  totalStores: number;
  activeStores: number;
  totalUsers: number;
  activeRoles: number;
  auditEntries: number;
  roleCounts: Record<string, number>;
}

interface Store {
  id: string;
  name: string;
  store_code: string;
  address: string | null;
  city: string | null;
  timezone: string;
  is_active: boolean;
  seating_capacity: number | null;
  target_avg_spend: number | null;
  target_labour_pct: number | null;
  target_margin_pct: number | null;
  organisation_id: string | null;
  region_id: string | null;
  created_at: string;
}

interface UserEntry {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  last_seen_at: string | null;
  roles: { role: string; site_id: string | null; region_id: string | null; is_active: boolean; granted_at: string }[];
  site_ids: string[];
}

interface AuditEntry {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

type Tab = "overview" | "stores" | "team" | "roles" | "audit";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "stores",   label: "Stores",   icon: "🏪" },
  { id: "team",     label: "Team",     icon: "👥" },
  { id: "roles",    label: "Roles & Access", icon: "🔐" },
  { id: "audit",    label: "Audit Log", icon: "📜" },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  executive: "Executive",
  head_office: "Head Office",
  area_manager: "Area Manager",
  gm: "General Manager",
  supervisor: "Supervisor",
  contractor: "Contractor",
  auditor: "Auditor",
  viewer: "Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin:  "bg-red-500/20 text-red-300 border-red-500/30",
  executive:    "bg-purple-500/20 text-purple-300 border-purple-500/30",
  head_office:  "bg-blue-500/20 text-blue-300 border-blue-500/30",
  area_manager: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  gm:           "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  supervisor:   "bg-amber-500/20 text-amber-300 border-amber-500/30",
  contractor:   "bg-orange-500/20 text-orange-300 border-orange-500/30",
  auditor:      "bg-stone-500/20 text-stone-300 border-stone-500/30",
  viewer:       "bg-stone-500/20 text-stone-400 border-stone-500/30",
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-400",
  invited: "bg-amber-400",
  deactivated: "bg-red-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const s = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (s < 60)   return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── RoleBadge ─────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", ROLE_COLORS[role] ?? "bg-stone-700 text-stone-300")}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: OverviewData | null }) {
  if (!data) return <LoadingSkeleton />;

  const stats = [
    { label: "Total Stores", value: data.totalStores, icon: "🏪" },
    { label: "Active Stores", value: data.activeStores, icon: "✅" },
    { label: "Team Members", value: data.totalUsers, icon: "👥" },
    { label: "Active Roles", value: data.activeRoles, icon: "🔐" },
    { label: "Audit Events", value: data.auditEntries, icon: "📜" },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-stone-800 bg-stone-900/60 p-4">
            <div className="text-lg">{s.icon}</div>
            <div className="mt-1 text-2xl font-bold text-stone-100">{s.value}</div>
            <div className="mt-0.5 text-[11px] font-medium text-stone-500 uppercase tracking-wide">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Role distribution */}
      <div className="rounded-xl border border-stone-800 bg-stone-900/60 p-5">
        <h3 className="text-sm font-semibold text-stone-300 mb-3">Role Distribution</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.roleCounts).map(([role, count]) => (
            <div key={role} className="flex items-center gap-2">
              <RoleBadge role={role} />
              <span className="text-xs text-stone-400">×{count}</span>
            </div>
          ))}
          {Object.keys(data.roleCounts).length === 0 && (
            <p className="text-xs text-stone-500">No roles assigned yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Stores Tab ────────────────────────────────────────────────────────────────

function StoresTab({ stores, onRefresh }: { stores: Store[] | null; onRefresh: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", store_code: "", address: "", city: "", seating_capacity: "", target_avg_spend: "" });

  if (!stores) return <LoadingSkeleton />;

  const handleCreate = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/admin/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          store_code: form.store_code,
          address: form.address || null,
          city: form.city || null,
          seating_capacity: form.seating_capacity ? Number(form.seating_capacity) : null,
          target_avg_spend: form.target_avg_spend ? Number(form.target_avg_spend) : null,
        }),
      });
      setShowNew(false);
      setForm({ name: "", store_code: "", address: "", city: "", seating_capacity: "", target_avg_spend: "" });
      onRefresh();
    } catch { /* toast */ } finally { setSaving(false); }
  };

  const toggleActive = async (store: Store) => {
    await apiFetch(`/api/admin/stores/${store.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !store.is_active }),
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">{stores.length} store{stores.length !== 1 ? "s" : ""}</p>
        <button
          onClick={() => setShowNew(!showNew)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
        >
          + Add Store
        </button>
      </div>

      {showNew && (
        <div className="rounded-xl border border-emerald-800/50 bg-stone-900/80 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-stone-200">New Store</h4>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Store Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" />
            <input placeholder="Store Code" value={form.store_code} onChange={(e) => setForm({ ...form, store_code: e.target.value })} className="input-field" />
            <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input-field" />
            <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="input-field" />
            <input placeholder="Seats" type="number" value={form.seating_capacity} onChange={(e) => setForm({ ...form, seating_capacity: e.target.value })} className="input-field" />
            <input placeholder="Avg Spend (R)" type="number" value={form.target_avg_spend} onChange={(e) => setForm({ ...form, target_avg_spend: e.target.value })} className="input-field" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving || !form.name || !form.store_code} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors">
              {saving ? "Creating…" : "Create"}
            </button>
            <button onClick={() => setShowNew(false)} className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-400 hover:bg-stone-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
        {stores.map((store) => (
          <div key={store.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-800/40 transition-colors">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", store.is_active ? "bg-emerald-400" : "bg-red-400")} />
                <span className="text-sm font-medium text-stone-200">{store.name}</span>
                <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] font-mono text-stone-400">{store.store_code}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-stone-500">
                {store.city && <span>{store.city}</span>}
                {store.seating_capacity && <span>{store.seating_capacity} seats</span>}
                {store.target_avg_spend && <span>R{store.target_avg_spend} avg</span>}
              </div>
            </div>
            <button
              onClick={() => toggleActive(store)}
              className={cn("rounded px-2 py-1 text-[10px] font-semibold transition-colors", store.is_active ? "bg-red-500/20 text-red-300 hover:bg-red-500/30" : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30")}
            >
              {store.is_active ? "Deactivate" : "Activate"}
            </button>
          </div>
        ))}
        {stores.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-stone-500">No stores configured</p>
        )}
      </div>
    </div>
  );
}

// ── Team Tab ──────────────────────────────────────────────────────────────────

function TeamTab({
  users,
  stores,
  onRefresh,
}: {
  users: UserEntry[] | null;
  stores: Store[] | null;
  onRefresh: () => void;
}) {
  const [showInvite, setShowInvite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", role: "gm", site_id: "" });

  if (!users) return <LoadingSkeleton />;

  const handleInvite = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          full_name: form.full_name,
          role: form.role,
          site_id: form.site_id || null,
        }),
      });
      setShowInvite(false);
      setForm({ email: "", full_name: "", role: "gm", site_id: "" });
      onRefresh();
    } catch { /* toast */ } finally { setSaving(false); }
  };

  const storeMap = new Map((stores ?? []).map((s) => [s.id, s.name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">{users.length} team member{users.length !== 1 ? "s" : ""}</p>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
        >
          + Invite User
        </button>
      </div>

      {showInvite && (
        <div className="rounded-xl border border-blue-800/50 bg-stone-900/80 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-stone-200">Invite Team Member</h4>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-field" />
            <input placeholder="Full Name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input-field" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field">
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })} className="input-field">
              <option value="">All Sites</option>
              {(stores ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleInvite} disabled={saving || !form.email || !form.full_name} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors">
              {saving ? "Inviting…" : "Send Invite"}
            </button>
            <button onClick={() => setShowInvite(false)} className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-400 hover:bg-stone-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
        {users.map((u) => {
          const primaryRole = u.roles.find((r) => r.is_active);
          return (
            <div key={u.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-800/40 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[u.status] ?? "bg-stone-500")} />
                  <span className="text-sm font-medium text-stone-200">{u.full_name ?? u.email}</span>
                  {u.full_name && <span className="text-[11px] text-stone-500">{u.email}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {primaryRole && <RoleBadge role={primaryRole.role} />}
                  {u.site_ids.length > 0 && (
                    <span className="text-[10px] text-stone-500">
                      {u.site_ids.map((sid) => storeMap.get(sid) ?? sid.slice(0, 8)).join(", ")}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", u.status === "active" ? "bg-emerald-500/20 text-emerald-300" : u.status === "invited" ? "bg-amber-500/20 text-amber-300" : "bg-red-500/20 text-red-300")}>
                  {u.status}
                </span>
                {u.last_seen_at && (
                  <p className="mt-0.5 text-[10px] text-stone-600">Seen {timeAgo(u.last_seen_at)}</p>
                )}
              </div>
            </div>
          );
        })}
        {users.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-stone-500">No team members yet</p>
        )}
      </div>
    </div>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

const ROLE_DESCRIPTIONS: Record<string, string> = {
  super_admin:  "Full system access · manage everything including org settings & users",
  executive:    "Read-only all stores · financial dashboards · compliance visibility",
  head_office:  "All stores read/write · store settings · integrations · no user management",
  area_manager: "Region-scoped · manage assigned stores · full operational access",
  gm:           "Single-store · full operational access · no admin settings",
  supervisor:   "Single-store · limited ops · create actions & maintenance",
  contractor:   "Maintenance tickets only · assigned store",
  auditor:      "Read-only all stores · compliance & audit log access",
  viewer:       "Single-store read-only · compliance view",
};

function RolesTab({ users }: { users: UserEntry[] | null }) {
  const allRoles = Object.keys(ROLE_LABELS);
  const roleMemberCounts: Record<string, number> = {};
  for (const u of users ?? []) {
    const active = u.roles.find((r) => r.is_active);
    if (active) roleMemberCounts[active.role] = (roleMemberCounts[active.role] ?? 0) + 1;
  }

  return (
    <div className="space-y-3">
      {allRoles.map((role) => (
        <div key={role} className="rounded-xl border border-stone-800 bg-stone-900/60 p-4 flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RoleBadge role={role} />
              <span className="text-xs text-stone-500">{roleMemberCounts[role] ?? 0} member{(roleMemberCounts[role] ?? 0) !== 1 ? "s" : ""}</span>
            </div>
            <p className="text-[11px] text-stone-500 max-w-lg">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Audit Tab ─────────────────────────────────────────────────────────────────

function AuditTab({ entries, users }: { entries: AuditEntry[] | null; users: UserEntry[] | null }) {
  if (!entries) return <LoadingSkeleton />;

  const nameMap = new Map((users ?? []).map((u) => [u.id, u.full_name ?? u.email]));

  const formatAction = (action: string) => {
    const labels: Record<string, string> = {
      "user.invited": "Invited user",
      "role.changed": "Changed role",
      "access.granted": "Granted access",
      "store.created": "Created store",
      "store.updated": "Updated store",
    };
    return labels[action] ?? action;
  };

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="text-center text-xs text-stone-500 py-8">No audit events recorded yet</p>
      ) : (
        <div className="divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
          {entries.map((e) => (
            <div key={e.id} className="px-4 py-3 hover:bg-stone-800/40 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] font-mono text-stone-400">{formatAction(e.action)}</span>
                  {e.actor_user_id && (
                    <span className="text-[11px] text-stone-400">by {nameMap.get(e.actor_user_id) ?? e.actor_user_id.slice(0, 8)}</span>
                  )}
                  {e.target_user_id && (
                    <span className="text-[11px] text-stone-500">→ {nameMap.get(e.target_user_id) ?? e.target_user_id.slice(0, 8)}</span>
                  )}
                </div>
                <span className="text-[10px] text-stone-600">{timeAgo(e.created_at)}</span>
              </div>
              {Object.keys(e.metadata).length > 0 && (
                <p className="mt-1 text-[10px] text-stone-600 font-mono truncate max-w-xl">{JSON.stringify(e.metadata)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Loading ───────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-stone-800 bg-stone-900/60 h-16 animate-pulse" />
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [users, setUsers] = useState<UserEntry[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await apiFetch("/api/admin/overview"));
    } catch (e: any) { setError(e.message); }
  }, []);

  const loadStores = useCallback(async () => {
    try {
      const res = await apiFetch<{ stores: Store[] }>("/api/admin/stores");
      setStores(res.stores);
    } catch (e: any) { setError(e.message); }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const res = await apiFetch<{ users: UserEntry[] }>("/api/admin/users");
      setUsers(res.users);
    } catch (e: any) { setError(e.message); }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const res = await apiFetch<{ entries: AuditEntry[] }>("/api/admin/audit");
      setAudit(res.entries);
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => {
    loadOverview();
    loadStores();
    loadUsers();
  }, [loadOverview, loadStores, loadUsers]);

  useEffect(() => {
    if (tab === "audit" && !audit) loadAudit();
  }, [tab, audit, loadAudit]);

  const handleRefresh = () => {
    loadOverview();
    loadStores();
    loadUsers();
    if (tab === "audit") loadAudit();
  };

  return (
    <div className="min-h-screen space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Admin Control Center</h1>
          <p className="mt-0.5 text-xs text-stone-500">Manage organisations, stores, team, and access</p>
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-lg border border-stone-700 bg-stone-800/60 px-3 py-1.5 text-xs font-medium text-stone-400 hover:bg-stone-700 hover:text-stone-200 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/30 px-4 py-2 text-xs text-red-300">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-stone-800 bg-stone-900/60 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              tab === t.id
                ? "bg-stone-800 text-stone-100 shadow-sm"
                : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/40",
            )}
          >
            <span className="text-sm">{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "overview" && <OverviewTab data={overview} />}
      {tab === "stores" && <StoresTab stores={stores} onRefresh={handleRefresh} />}
      {tab === "team" && <TeamTab users={users} stores={stores} onRefresh={handleRefresh} />}
      {tab === "roles" && <RolesTab users={users} />}
      {tab === "audit" && <AuditTab entries={audit} users={users} />}
    </div>
  );
}
