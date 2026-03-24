/* ── Action system types ───────────────────────────────────────────────────── */

export type ActionStatus     = "pending" | "in_progress" | "completed";
export type ActionPriority   = "critical" | "high" | "medium" | "low";
export type ExecutionType    = "call" | "message" | "staffing" | "compliance" | "order" | "inspect";

export type ActionCategory =
  | "revenue"
  | "labour"
  | "food_cost"
  | "stock"
  | "maintenance"
  | "compliance"
  | "daily_ops"
  | "service"
  | "general";

export interface Action {
  id:               string;
  title:            string;
  description:      string | null;
  impact_weight:    ActionPriority;
  category:         ActionCategory | null;
  status:           ActionStatus;
  assigned_to:      string | null;
  assignee_role:    string | null;
  due_at:           string | null;
  expected_impact:  string | null;
  why_it_matters:   string | null;
  source_type:      string | null;
  source_module:    string | null;
  source_id:        string | null;
  execution_type:   ExecutionType | null;
  site_id:          string | null;
  zone_id:          string | null;
  created_at:       string;
  updated_at:       string;
  started_at:       string | null;
  completed_at:     string | null;
  archived_at:      string | null;
  completion_note:  string | null;
  revenue_before:   number | null;
  revenue_after:    number | null;
  revenue_delta:    number | null;
}

export interface ActionCreateInput {
  title:           string;
  description?:    string;
  impact_weight?:  ActionPriority;
  category?:       ActionCategory;
  assigned_to?:    string;
  assignee_role?:  string;
  due_at?:         string;
  expected_impact?: string;
  why_it_matters?:  string;
  source_type?:    string;
  source_module?:  string;
  source_id?:      string;
  execution_type?: ExecutionType;
}

export interface ActionStats {
  total:            number;
  pending:          number;
  inProgress:       number;
  completed:        number;
  overdue:          number;
  urgentOpen:       number;
  completedToday:   number;
  completionRate:   number;
  avgResolutionMin: number | null;
}

export const CATEGORY_CONFIG: Record<ActionCategory, { label: string; icon: string; color: string }> = {
  revenue:     { label: "Revenue",     icon: "💰", color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-200 dark:ring-emerald-800" },
  labour:      { label: "Labour",      icon: "👥", color: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 ring-blue-200 dark:ring-blue-800" },
  food_cost:   { label: "Food Cost",   icon: "🍽️", color: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 ring-orange-200 dark:ring-orange-800" },
  stock:       { label: "Stock",       icon: "📦", color: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 ring-amber-200 dark:ring-amber-800" },
  maintenance: { label: "Maintenance", icon: "🔧", color: "text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/30 ring-slate-200 dark:ring-slate-800" },
  compliance:  { label: "Compliance",  icon: "📋", color: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-800" },
  daily_ops:   { label: "Daily Ops",   icon: "📊", color: "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 ring-violet-200 dark:ring-violet-800" },
  service:     { label: "Service",     icon: "🛎️", color: "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30 ring-sky-200 dark:ring-sky-800" },
  general:     { label: "General",     icon: "📌", color: "text-stone-600 dark:text-stone-400 bg-stone-50 dark:bg-stone-800 ring-stone-200 dark:ring-stone-700" },
};
