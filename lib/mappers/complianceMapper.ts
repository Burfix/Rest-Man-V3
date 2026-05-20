/**
 * lib/mappers/complianceMapper.ts
 *
 * Mapping layer for the compliance domain.
 *
 * Schema fields (`display_name`, `next_due_date`, etc.) are snake_case and
 * match DB column names directly. This mapper formalises the boundary so
 * route logic always works with camelCase internal types and produces
 * explicit snake_case DB payloads.
 */

import type { z } from "zod";
import type { createComplianceItemSchema } from "@/lib/validation/schemas";

// ── DTO types ─────────────────────────────────────────────────────────────────

export type CreateComplianceItemDto = z.infer<typeof createComplianceItemSchema>;

// ── Internal type (camelCase) ─────────────────────────────────────────────────

export interface ComplianceItemInternal {
  displayName: string;
  category: string | null | undefined;
  description: string | null | undefined;
  lastInspectionDate: string | null | undefined;
  nextDueDate: string | null | undefined;
  responsibleParty: string | null | undefined;
  notes: string | null | undefined;
}

// ── DTO → Internal ─────────────────────────────────────────────────────────────

export function complianceItemDtoToInternal(
  dto: CreateComplianceItemDto,
): ComplianceItemInternal {
  return {
    displayName: dto.display_name,
    category: dto.category,
    description: dto.description,
    lastInspectionDate: dto.last_inspection_date,
    nextDueDate: dto.next_due_date,
    responsibleParty: dto.responsible_party,
    notes: dto.notes,
  };
}

// ── Internal → DB ─────────────────────────────────────────────────────────────

export function complianceItemInternalToDb(input: ComplianceItemInternal) {
  return {
    display_name: input.displayName.trim(),
    category: input.category ?? null,
    description: input.description?.trim() || null,
    last_inspection_date: input.lastInspectionDate ?? null,
    next_due_date: input.nextDueDate ?? null,
    responsible_party: input.responsibleParty?.trim() || null,
    notes: input.notes?.trim() || null,
  };
}
