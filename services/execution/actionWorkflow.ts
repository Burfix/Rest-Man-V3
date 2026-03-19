/**
 * Execution Engine — Action Workflow
 *
 * Manages the full lifecycle of an Action:
 *   create → assign → start → complete → reopen → escalate
 *
 * Every state transition:
 *   1. Updates the action record
 *   2. Inserts an action_event row (timeline)
 *   3. Writes to the audit log
 *
 * All functions use the service-role client so they can be
 * called from API routes and server actions without RLS conflicts.
 */

import { createClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit/auditLog";
import type {
  Action,
  ActionEvent,
  ActionStatus,
  ActionEventType,
} from "@/lib/ontology/entities";

// Service-role client
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CreateActionInput {
  siteId:          string;
  alertId?:        string;
  title:           string;
  description?:    string;
  actionType:      string;
  impactWeight?:   number;    // 1–5, default 3
  assignedTo?:     string;    // user_id
  dueAt?:          string;    // ISO timestamp
  expectedOutcome?: string;
  actorUserId?:    string;
  actorLabel?:     string;
}

export interface TransitionInput {
  actionId:    string;
  actorUserId?: string;
  actorLabel?: string;
  notes?:      string;
}

export interface AssignInput extends TransitionInput {
  assignedTo: string;
  dueAt?:     string;
}

export interface EscalateInput extends TransitionInput {
  escalateTo:   string;    // user_id of escalation target
  reason?:      string;
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createAction(input: CreateActionInput): Promise<Action> {
  const { data, error } = await db
    .from("actions")
    .insert({
      site_id:          input.siteId,
      alert_id:         input.alertId ?? null,
      title:            input.title,
      description:      input.description ?? null,
      action_type:      input.actionType,
      impact_weight:    input.impactWeight ?? 3,
      assigned_to:      input.assignedTo ?? null,
      due_at:           input.dueAt ?? null,
      status:           "pending",
      expected_outcome: input.expectedOutcome ?? null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`[Workflow] createAction: ${error?.message}`);

  await addEvent(data.id, "created", input.actorUserId, input.actorLabel, "Action created");
  await writeAuditLog({
    entityType: "action",
    entityId:   data.id,
    operation:  "create",
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel ?? "system",
    siteId:     input.siteId,
    afterState: { title: data.title, status: "pending" },
  });

  return data as Action;
}

// ── Assign ────────────────────────────────────────────────────────────────────

export async function assignAction(input: AssignInput): Promise<Action> {
  const before = await getAction(input.actionId);

  const { data, error } = await db
    .from("actions")
    .update({
      assigned_to: input.assignedTo,
      due_at:      input.dueAt ?? before.due_at,
      status:      before.status === "pending" ? "in_progress" : before.status,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", input.actionId)
    .select()
    .single();

  if (error || !data) throw new Error(`[Workflow] assignAction: ${error?.message}`);

  await addEvent(
    input.actionId,
    "assigned",
    input.actorUserId,
    input.actorLabel,
    input.notes ?? `Assigned to ${input.assignedTo}`
  );

  await writeAuditLog({
    entityType: "action",
    entityId:   input.actionId,
    operation:  "assign",
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel ?? "system",
    siteId:     before.site_id,
    beforeState: { assigned_to: before.assigned_to, status: before.status },
    afterState:  { assigned_to: input.assignedTo,   status: data.status  },
    diff:        { assigned_to: input.assignedTo },
  });

  return data as Action;
}

// ── Start ─────────────────────────────────────────────────────────────────────

export async function startAction(input: TransitionInput): Promise<Action> {
  return updateStatus(input, "in_progress", "started");
}

// ── Complete ──────────────────────────────────────────────────────────────────

export async function completeAction(input: TransitionInput): Promise<Action> {
  const before = await getAction(input.actionId);

  const { data, error } = await db
    .from("actions")
    .update({
      status:       "completed",
      completed_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    })
    .eq("id", input.actionId)
    .select()
    .single();

  if (error || !data) throw new Error(`[Workflow] completeAction: ${error?.message}`);

  await addEvent(input.actionId, "completed", input.actorUserId, input.actorLabel, input.notes);

  await writeAuditLog({
    entityType:  "action",
    entityId:    input.actionId,
    operation:   "complete",
    actorUserId: input.actorUserId,
    actorLabel:  input.actorLabel ?? "system",
    siteId:      before.site_id,
    beforeState: { status: before.status },
    afterState:  { status: "completed", completed_at: data.completed_at },
    diff:        { status: "completed" },
    notes:       input.notes,
  });

  return data as Action;
}

// ── Reopen ────────────────────────────────────────────────────────────────────

export async function reopenAction(input: TransitionInput): Promise<Action> {
  const before = await getAction(input.actionId);
  const result = await updateStatus(input, "in_progress", "reopened");

  await writeAuditLog({
    entityType:  "action",
    entityId:    input.actionId,
    operation:   "reopen",
    actorUserId: input.actorUserId,
    actorLabel:  input.actorLabel ?? "system",
    siteId:      before.site_id,
    beforeState: { status: before.status },
    afterState:  { status: "in_progress" },
    notes:       input.notes,
  });

  return result;
}

// ── Escalate ──────────────────────────────────────────────────────────────────

export async function escalateAction(input: EscalateInput): Promise<Action> {
  const before = await getAction(input.actionId);

  const { data, error } = await db
    .from("actions")
    .update({
      status:      "escalated",
      assigned_to: input.escalateTo,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", input.actionId)
    .select()
    .single();

  if (error || !data) throw new Error(`[Workflow] escalateAction: ${error?.message}`);

  await addEvent(
    input.actionId,
    "escalated",
    input.actorUserId,
    input.actorLabel,
    input.reason ?? input.notes
  );

  await writeAuditLog({
    entityType:  "action",
    entityId:    input.actionId,
    operation:   "escalate",
    actorUserId: input.actorUserId,
    actorLabel:  input.actorLabel ?? "system",
    siteId:      before.site_id,
    beforeState: { status: before.status, assigned_to: before.assigned_to },
    afterState:  { status: "escalated",   assigned_to: input.escalateTo },
    notes:       input.reason,
  });

  return data as Action;
}

// ── Get action events (timeline) ──────────────────────────────────────────────

export async function getActionTimeline(actionId: string): Promise<ActionEvent[]> {
  const { data, error } = await db
    .from("action_events")
    .select("*")
    .eq("action_id", actionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`[Workflow] getActionTimeline: ${error.message}`);
  return (data ?? []) as ActionEvent[];
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function getAction(actionId: string): Promise<Action> {
  const { data, error } = await db
    .from("actions")
    .select("*")
    .eq("id", actionId)
    .single();
  if (error || !data) throw new Error(`[Workflow] Action not found: ${actionId}`);
  return data as Action;
}

async function updateStatus(
  input:      TransitionInput,
  newStatus:  ActionStatus,
  eventType:  ActionEventType
): Promise<Action> {
  const { data, error } = await db
    .from("actions")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", input.actionId)
    .select()
    .single();

  if (error || !data) throw new Error(`[Workflow] updateStatus(${newStatus}): ${error?.message}`);
  await addEvent(input.actionId, eventType, input.actorUserId, input.actorLabel, input.notes);
  return data as Action;
}

async function addEvent(
  actionId:    string,
  eventType:   ActionEventType,
  actorUserId: string | undefined,
  actorLabel:  string | undefined,
  notes?:      string | null
): Promise<void> {
  await db.from("action_events").insert({
    action_id:   actionId,
    event_type:  eventType,
    actor:       actorUserId ?? null,
    actor_label: actorLabel ?? null,
    notes:       notes ?? null,
  });
}
