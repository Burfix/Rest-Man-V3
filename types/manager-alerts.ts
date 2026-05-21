/**
 * types/manager-alerts.ts
 *
 * TypeScript types for the Manager Alert Engine.
 * Mirrors the DB schema in migrations 093 & 094.
 */

// ── Alert type / severity / source / status ───────────────────────────────────

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertType =
  | "labour"
  | "revenue"
  | "compliance"
  | "maintenance"
  | "incident"
  | "inventory"
  | "sync"
  | "custom";

export type AlertSource =
  | "manual"
  | "system"
  | "incident"
  | "compliance"
  | "labour"
  | "revenue"
  | "maintenance";

export type AlertStatus = "pending" | "sent" | "failed" | "acknowledged";

// ── Manager contact ───────────────────────────────────────────────────────────

export interface AlertPreferences {
  labour?:      boolean;
  revenue?:     boolean;
  compliance?:  boolean;
  maintenance?: boolean;
  incident?:    boolean;
  inventory?:   boolean;
  sync?:        boolean;
  quiet_hours?: {
    start: string; // "HH:MM" in tz
    end:   string;
    tz:    string; // IANA timezone, e.g. "Africa/Johannesburg"
  };
}

export interface ManagerContact {
  id:                string;
  site_id:           string;
  name:              string;
  role:              string;
  /** E.164 format, e.g. +27821234567 */
  phone_whatsapp:    string;
  is_active:         boolean;
  alert_preferences: AlertPreferences;
  created_at:        string;
  updated_at:        string;
}

export type CreateManagerContactInput = Omit<ManagerContact, "id" | "created_at" | "updated_at">;

// ── Manager alert ─────────────────────────────────────────────────────────────

export interface ManagerAlert {
  id:                   string;
  site_id:              string;
  manager_id:           string;
  alert_type:           AlertType;
  severity:             AlertSeverity;
  source:               AlertSource;
  title:                string;
  message:              string;
  incident_id:          string | null;
  status:               AlertStatus;
  whatsapp_message_id:  string | null;
  sent_at:              string | null;
  failed_reason:        string | null;
  retry_count:          number;
  acknowledged_at:      string | null;
  acknowledged_by:      string | null;
  created_by:           string | null;
  created_at:           string;
  updated_at:           string;
}

export type CreateManagerAlertInput = {
  site_id:      string;
  manager_id:   string;
  alert_type:   AlertType;
  severity:     AlertSeverity;
  source:       AlertSource;
  title:        string;
  message:      string;
  incident_id?: string | null;
  created_by?:  string | null;
};

/** Alert row joined with manager contact name/phone for display */
export interface ManagerAlertWithContact extends ManagerAlert {
  manager_name:  string;
  manager_role:  string;
  manager_phone: string;
}

// ── API payloads ──────────────────────────────────────────────────────────────

export interface CreateAlertApiPayload {
  site_id:      string;
  manager_id:   string;
  alert_type:   AlertType;
  severity:     AlertSeverity;
  source:       AlertSource;
  title:        string;
  message:      string;
  incident_id?: string;
  /** If true, immediately attempt WhatsApp delivery after creating the row */
  send_now?:    boolean;
}

export interface AlertListFilters {
  site_id?:    string;
  status?:     AlertStatus;
  severity?:   AlertSeverity;
  alert_type?: AlertType;
  manager_id?: string;
  limit?:      number;
  offset?:     number;
}
