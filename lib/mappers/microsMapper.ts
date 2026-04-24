/**
 * lib/mappers/microsMapper.ts
 *
 * Mapping layer for the MICROS connections domain.
 *
 * Schema fields use snake_case (`auth_server_url`, `org_identifier`, etc.).
 * Internal route logic uses camelCase. DB payloads use explicit snake_case.
 */

import type { z } from "zod";
import type { microsSettingsSchema } from "@/lib/validation/schemas";

// ── DTO type ──────────────────────────────────────────────────────────────────

export type MicrosSettingsDto = z.infer<typeof microsSettingsSchema>;

// ── Internal type ─────────────────────────────────────────────────────────────

export interface MicrosSettingsInternal {
  id: string | undefined;
  locationName: string | null | undefined;
  locRef: string | null | undefined;
  authServerUrl: string;
  appServerUrl: string;
  clientId: string;
  orgIdentifier: string;
}

// ── DTO → Internal ─────────────────────────────────────────────────────────────

export function microsSettingsDtoToInternal(
  dto: MicrosSettingsDto,
): MicrosSettingsInternal {
  return {
    id: dto.id,
    locationName: dto.location_name,
    locRef: dto.loc_ref,
    authServerUrl: dto.auth_server_url,
    appServerUrl: dto.app_server_url,
    clientId: dto.client_id,
    orgIdentifier: dto.org_identifier,
  };
}

// ── Internal → DB ─────────────────────────────────────────────────────────────

export function microsSettingsInternalToDb(input: MicrosSettingsInternal) {
  return {
    location_name: (input.locationName ?? "Pilot Store").trim(),
    loc_ref: (input.locRef ?? "").trim(),
    auth_server_url: input.authServerUrl.trim().replace(/\/$/, ""),
    app_server_url: input.appServerUrl.trim().replace(/\/$/, ""),
    client_id: input.clientId.trim(),
    org_identifier: input.orgIdentifier.trim(),
    status: "awaiting_setup" as const,
  };
}
