/**
 * lib/mappers/userMapper.ts
 *
 * Mapping layer for the admin/users domain.
 *
 * Pattern:
 *   - API request body arrives as snake_case (Zod schema keys match DB columns)
 *   - Internal route logic uses camelCase (InviteUserInternal, PatchUserRoleInternal)
 *   - Supabase inserts/upserts use explicit snake_case payloads
 *
 * Never mix schema field names and internal variable names in route logic.
 */

import type { z } from "zod";
import type {
  inviteUserSchema,
  patchUserRoleSchema,
} from "@/lib/validation/schemas";

// ── DTO types (derived from Zod schemas) ─────────────────────────────────────

export type InviteUserDto = z.infer<typeof inviteUserSchema>;
export type PatchUserRoleDto = z.infer<typeof patchUserRoleSchema>;

// ── Internal types (camelCase) ────────────────────────────────────────────────

export interface InviteUserInternal {
  email: string;
  role: InviteUserDto["role"];
  fullName: string;
  siteId: string | null;
  regionId: string | null;
}

export interface PatchUserRoleInternal {
  role: PatchUserRoleDto["role"];
  siteId: string | null;
  siteIds: string[] | undefined;
  regionId: string | null;
}

// ── DTO → Internal (normalize snake_case input to camelCase) ──────────────────

export function inviteUserDtoToInternal(dto: InviteUserDto): InviteUserInternal {
  return {
    email: dto.email,
    role: dto.role,
    fullName: dto.full_name,
    siteId: dto.site_id ?? null,
    regionId: dto.region_id ?? null,
  };
}

export function patchUserRoleDtoToInternal(
  dto: PatchUserRoleDto,
): PatchUserRoleInternal {
  return {
    role: dto.role,
    siteId: dto.site_id ?? null,
    siteIds: dto.site_ids,
    regionId: dto.region_id ?? null,
  };
}

// ── Internal → DB (camelCase → snake_case for Supabase payloads) ──────────────

export function inviteUserInternalToDb(input: InviteUserInternal) {
  return {
    email: input.email,
    role: input.role,
    full_name: input.fullName,
    site_id: input.siteId,
    region_id: input.regionId,
  };
}

export function patchUserRoleInternalToDb(input: PatchUserRoleInternal) {
  return {
    role: input.role,
    site_id: input.siteId,
    region_id: input.regionId,
  };
}
