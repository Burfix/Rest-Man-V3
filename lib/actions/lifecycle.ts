/**
 * Action Lifecycle — Shared types and transition validation.
 *
 * Used by both API routes and frontend components.
 */

// ── Statuses ──────────────────────────────────────────────────────────────────

export type ActionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "escalated"
  | "cancelled";

export const ACTION_STATUSES: ActionStatus[] = [
  "pending", "in_progress", "completed", "escalated", "cancelled",
];

// ── Event types ───────────────────────────────────────────────────────────────

export type ActionEventType =
  | "created"
  | "started"
  | "completed"
  | "escalated"
  | "cancelled"
  | "reopened"
  | "assigned"
  | "note";

// ── Transition map ────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  pending:     ["in_progress", "escalated", "cancelled"],
  in_progress: ["completed", "escalated", "cancelled"],
  completed:   ["pending"],      // reopen
  escalated:   ["in_progress"],  // return from escalation
  cancelled:   ["pending"],      // reopen
};

export function isValidTransition(from: ActionStatus, to: ActionStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getTransitionError(from: ActionStatus, to: ActionStatus): string | null {
  if (from === to) return `Action is already ${from}`;
  if (!isValidTransition(from, to)) {
    const allowed = VALID_TRANSITIONS[from]?.join(", ") ?? "none";
    return `Cannot transition from '${from}' to '${to}'. Allowed: ${allowed}`;
  }
  return null;
}

// ── Map transition to event type ──────────────────────────────────────────────

export function transitionToEventType(from: ActionStatus, to: ActionStatus): ActionEventType {
  if (to === "in_progress" && (from === "completed" || from === "escalated" || from === "cancelled")) {
    return "reopened";
  }
  if (to === "pending" && (from === "completed" || from === "cancelled")) {
    return "reopened";
  }
  switch (to) {
    case "in_progress": return "started";
    case "completed":   return "completed";
    case "escalated":   return "escalated";
    case "cancelled":   return "cancelled";
    default:            return "note";
  }
}

// ── API payload types ─────────────────────────────────────────────────────────

export interface CreateActionPayload {
  title: string;
  direct_instruction?: string;
  category: string;
  severity: string;
  status?: ActionStatus;
  owner?: string;
  source_type?: string;
  expected_impact_value?: number;
  expected_impact_text?: string;
}

export interface ActionResponse {
  id: string;
  title: string;
  status: ActionStatus;
  severity: string;
  category: string;
  owner: string | null;
  started_at: string | null;
  completed_at: string | null;
  escalated_at: string | null;
  created_at: string;
}
