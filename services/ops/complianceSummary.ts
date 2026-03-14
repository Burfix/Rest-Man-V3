/**
 * Compliance Hub — service layer
 *
 * Reads compliance_items and compliance_documents from Supabase, computes
 * live status from next_due_date (overriding the stored status column), and
 * returns structured summaries for both the full compliance page and the
 * main dashboard widget.
 *
 * Status logic (applied at query time so it is always up-to-date):
 *   expired   — next_due_date < today
 *   due_soon  — next_due_date <= today + DUE_SOON_DAYS
 *   compliant — next_due_date > today + DUE_SOON_DAYS
 *   unknown   — next_due_date is null
 */

import { createServerClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/utils";
import type { ComplianceItem, ComplianceSummary, ComplianceDocument, ComplianceStatus } from "@/types";

/** Days ahead that counts as "due soon" */
const DUE_SOON_DAYS = 30;

// ── Status computation ────────────────────────────────────────────────────────

export function computeStatus(nextDueDate: string | null): ComplianceStatus {
  if (!nextDueDate) return "unknown";
  const today = todayISO();
  const due = nextDueDate;
  if (due < today) return "expired";
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + DUE_SOON_DAYS);
  const thresholdISO = threshold.toISOString().slice(0, 10);
  if (due <= thresholdISO) return "due_soon";
  return "compliant";
}

/** Days until the due date (negative = overdue) */
export function daysUntilDue(nextDueDate: string | null): number | null {
  if (!nextDueDate) return null;
  const today = new Date(todayISO());
  const due = new Date(nextDueDate);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Fetch all compliance items with their associated documents */
export async function getAllComplianceItems(): Promise<ComplianceItem[]> {
  const supabase = createServerClient();

  const [itemsResult, docsResult] = await Promise.all([
    (supabase as any)
      .from("compliance_items")
      .select("*")
      .order("display_name", { ascending: true }),
    (supabase as any)
      .from("compliance_documents")
      .select("*")
      .order("uploaded_at", { ascending: false }),
  ]);

  if (itemsResult.error) {
    throw new Error(`[Compliance] Items: ${itemsResult.error.message}`);
  }

  const items = (itemsResult.data ?? []) as ComplianceItem[];
  const docs = (docsResult.data ?? []) as ComplianceDocument[];

  // Group documents by item_id
  const docsByItem: Record<string, ComplianceDocument[]> = {};
  for (const doc of docs) {
    if (!docsByItem[doc.item_id]) docsByItem[doc.item_id] = [];
    docsByItem[doc.item_id].push(doc);
  }

  // Recompute live status and attach documents
  return items.map((item) => ({
    ...item,
    status: computeStatus(item.next_due_date),
    documents: docsByItem[item.id] ?? [],
  }));
}

/** Build the aggregate compliance summary used on the dashboard */
export async function getComplianceSummary(): Promise<ComplianceSummary> {
  const items = await getAllComplianceItems();

  const summary: ComplianceSummary = {
    total: items.length,
    compliant: 0,
    due_soon: 0,
    expired: 0,
    unknown: 0,
    compliance_pct: 0,
    critical_items: [],
    due_soon_items: [],
  };

  for (const item of items) {
    summary[item.status]++;
    if (item.status === "expired") summary.critical_items.push(item);
    if (item.status === "due_soon") summary.due_soon_items.push(item);
  }

  // Sort due_soon by nearest deadline first
  summary.due_soon_items.sort((a, b) => {
    if (!a.next_due_date) return 1;
    if (!b.next_due_date) return -1;
    return a.next_due_date.localeCompare(b.next_due_date);
  });

  const rated = summary.total - summary.unknown;
  summary.compliance_pct = rated > 0
    ? Math.round((summary.compliant / rated) * 100)
    : 0;

  return summary;
}

/** Fetch a single compliance item with its documents */
export async function getComplianceItem(id: string): Promise<ComplianceItem | null> {
  const supabase = createServerClient();

  const [itemResult, docsResult] = await Promise.all([
    (supabase as any)
      .from("compliance_items")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
    (supabase as any)
      .from("compliance_documents")
      .select("*")
      .eq("item_id", id)
      .order("uploaded_at", { ascending: false }),
  ]);

  if (itemResult.error) throw new Error(itemResult.error.message);
  if (!itemResult.data) return null;

  const item = itemResult.data as ComplianceItem;
  return {
    ...item,
    status: computeStatus(item.next_due_date),
    documents: (docsResult.data ?? []) as ComplianceDocument[],
  };
}
