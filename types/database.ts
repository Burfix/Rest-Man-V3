/**
 * Supabase database type definitions.
 *
 * In production you can replace this with the auto-generated types from:
 *   npx supabase gen types typescript --project-id your-project-id > types/database.ts
 *
 * This hand-written version mirrors our migration schema exactly.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      reservations: {
        Row: {
          id: string;
          customer_name: string;
          phone_number: string;
          booking_date: string;
          booking_time: string;
          guest_count: number;
          event_name: string | null;
          special_notes: string | null;
          status: string;
          service_charge_applies: boolean;
          escalation_required: boolean;
          source_channel: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_name: string;
          phone_number: string;
          booking_date: string;
          booking_time: string;
          guest_count: number;
          event_name?: string | null;
          special_notes?: string | null;
          status?: string;
          service_charge_applies?: boolean;
          escalation_required?: boolean;
          source_channel?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          customer_name?: string;
          phone_number?: string;
          booking_date?: string;
          booking_time?: string;
          guest_count?: number;
          event_name?: string | null;
          special_notes?: string | null;
          status?: string;
          service_charge_applies?: boolean;
          escalation_required?: boolean;
          source_channel?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      events: {
        Row: {
          id: string;
          name: string;
          event_date: string;
          start_time: string | null;
          end_time: string | null;
          description: string | null;
          is_special_event: boolean;
          booking_enabled: boolean;
          cancelled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          event_date: string;
          start_time?: string | null;
          end_time?: string | null;
          description?: string | null;
          is_special_event?: boolean;
          booking_enabled?: boolean;
          cancelled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          event_date?: string;
          start_time?: string | null;
          end_time?: string | null;
          description?: string | null;
          is_special_event?: boolean;
          booking_enabled?: boolean;
          cancelled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      venue_settings: {
        Row: {
          id: string;
          venue_name: string;
          max_capacity: number;
          max_table_size: number;
          opening_hours_json: Json;
          service_charge_threshold: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          venue_name: string;
          max_capacity: number;
          max_table_size: number;
          opening_hours_json: Json;
          service_charge_threshold: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          venue_name?: string;
          max_capacity?: number;
          max_table_size?: number;
          opening_hours_json?: Json;
          service_charge_threshold?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      conversation_logs: {
        Row: {
          id: string;
          phone_number: string;
          user_message: string;
          assistant_message: string | null;
          extracted_intent: string | null;
          extracted_booking_data_json: Json | null;
          escalation_required: boolean;
          wa_message_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone_number: string;
          user_message: string;
          assistant_message?: string | null;
          extracted_intent?: string | null;
          extracted_booking_data_json?: Json | null;
          escalation_required?: boolean;
          wa_message_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone_number?: string;
          user_message?: string;
          assistant_message?: string | null;
          extracted_intent?: string | null;
          extracted_booking_data_json?: Json | null;
          escalation_required?: boolean;
          wa_message_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };

      equipment: {
        Row: {
          id: string;
          unit_name: string;
          category: string;
          location: string | null;
          status: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          unit_name: string;
          category: string;
          location?: string | null;
          status?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          unit_name?: string;
          category?: string;
          location?: string | null;
          status?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      maintenance_logs: {
        Row: {
          id: string;
          equipment_id: string | null;
          unit_name: string;
          category: string;
          issue_title: string;
          issue_description: string | null;
          priority: string;
          repair_status: string;
          date_reported: string;
          date_resolved: string | null;
          resolved_by: string | null;
          created_at: string;
          updated_at: string;
          // Added by migration 012
          site_id: string | null;
          zone_id: string | null;
          ticket_type: string;
          // Added by migration 014 — maintenance intelligence
          impact_level: string;
          date_acknowledged: string | null;
          date_fixed: string | null;
          reported_by: string | null;
          fixed_by: string | null;
          fixed_by_type: string | null;
          contractor_name: string | null;
          contractor_contact: string | null;
          downtime_minutes: number | null;
          estimated_cost: number | null;
          actual_cost: number | null;
          resolution_notes: string | null;
          root_cause: string | null;
          follow_up_required: boolean;
          follow_up_notes: string | null;
        };
        Insert: {
          id?: string;
          equipment_id?: string | null;
          unit_name: string;
          category?: string;
          issue_title: string;
          issue_description?: string | null;
          priority: string;
          repair_status?: string;
          date_reported?: string;
          date_resolved?: string | null;
          resolved_by?: string | null;
          created_at?: string;
          updated_at?: string;
          site_id?: string | null;
          zone_id?: string | null;
          ticket_type?: string;
          impact_level?: string;
          date_acknowledged?: string | null;
          date_fixed?: string | null;
          reported_by?: string | null;
          fixed_by?: string | null;
          fixed_by_type?: string | null;
          contractor_name?: string | null;
          contractor_contact?: string | null;
          downtime_minutes?: number | null;
          estimated_cost?: number | null;
          actual_cost?: number | null;
          resolution_notes?: string | null;
          root_cause?: string | null;
          follow_up_required?: boolean;
          follow_up_notes?: string | null;
        };
        Update: {
          id?: string;
          equipment_id?: string | null;
          unit_name?: string;
          category?: string;
          issue_title?: string;
          issue_description?: string | null;
          priority?: string;
          repair_status?: string;
          date_reported?: string;
          date_resolved?: string | null;
          resolved_by?: string | null;
          created_at?: string;
          updated_at?: string;
          site_id?: string | null;
          zone_id?: string | null;
          ticket_type?: string;
          impact_level?: string;
          date_acknowledged?: string | null;
          date_fixed?: string | null;
          reported_by?: string | null;
          fixed_by?: string | null;
          fixed_by_type?: string | null;
          contractor_name?: string | null;
          contractor_contact?: string | null;
          downtime_minutes?: number | null;
          estimated_cost?: number | null;
          actual_cost?: number | null;
          resolution_notes?: string | null;
          root_cause?: string | null;
          follow_up_required?: boolean;
          follow_up_notes?: string | null;
        };
        Relationships: [];
      };

      reviews: {
        Row: {
          id: string;
          site_id: string | null;
          review_date: string;
          platform: string;
          rating: number;
          reviewer_name: string | null;
          review_text: string | null;
          sentiment: string | null;
          tags: Json;
          flagged: boolean;
          google_review_id: string | null;
          reviewer_photo: string | null;
          reply_text: string | null;
          reply_time: string | null;
          source: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          site_id?: string | null;
          review_date: string;
          platform: string;
          rating: number;
          reviewer_name?: string | null;
          review_text?: string | null;
          sentiment?: string | null;
          tags?: Json;
          flagged?: boolean;
          google_review_id?: string | null;
          reviewer_photo?: string | null;
          reply_text?: string | null;
          reply_time?: string | null;
          source?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string | null;
          review_date?: string;
          platform?: string;
          rating?: number;
          reviewer_name?: string | null;
          review_text?: string | null;
          sentiment?: string | null;
          tags?: Json;
          flagged?: boolean;
          google_review_id?: string | null;
          reviewer_photo?: string | null;
          reply_text?: string | null;
          reply_time?: string | null;
          source?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      sales_uploads: {
        Row: {
          id: string;
          week_label: string;
          week_start: string;
          week_end: string;
          total_items_sold: number;
          total_sales_value: number;
          uploaded_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          week_label: string;
          week_start: string;
          week_end: string;
          total_items_sold: number;
          total_sales_value: number;
          uploaded_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          week_label?: string;
          week_start?: string;
          week_end?: string;
          total_items_sold?: number;
          total_sales_value?: number;
          uploaded_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };

      sales_items: {
        Row: {
          id: string;
          upload_id: string;
          item_name: string;
          category: string | null;
          quantity_sold: number;
          unit_price: number | null;
          total_value: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          upload_id: string;
          item_name: string;
          category?: string | null;
          quantity_sold: number;
          unit_price?: number | null;
          total_value?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          upload_id?: string;
          item_name?: string;
          category?: string | null;
          quantity_sold?: number;
          unit_price?: number | null;
          total_value?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };

      daily_operations_reports: {
        Row: {
          id: string;
          report_date: string;
          source_file_name: string | null;
          sales_net_vat: number | null;
          margin_percent: number | null;
          cogs_percent: number | null;
          labor_cost_percent: number | null;
          guest_count: number | null;
          check_count: number | null;
          gross_sales_before_discounts: number | null;
          total_discounts: number | null;
          gross_sales_after_discounts: number | null;
          tax_collected: number | null;
          service_charges: number | null;
          non_revenue_total: number | null;
          cost_of_goods_sold: number | null;
          labor_cost: number | null;
          operating_margin: number | null;
          returns_count: number | null;
          returns_amount: number | null;
          voids_count: number | null;
          voids_amount: number | null;
          manager_voids_count: number | null;
          manager_voids_amount: number | null;
          error_corrects_count: number | null;
          error_corrects_amount: number | null;
          cancels_count: number | null;
          cancels_amount: number | null;
          guests_average_spend: number | null;
          checks_average_spend: number | null;
          table_turns_count: number | null;
          table_turns_average_spend: number | null;
          average_dining_time_hours: number | null;
          direct_charged_tips: number | null;
          direct_cash_tips: number | null;
          indirect_tips: number | null;
          total_tips: number | null;
          tips_paid: number | null;
          cash_in: number | null;
          paid_in: number | null;
          paid_out: number | null;
          cash_due: number | null;
          deposits: number | null;
          over_short: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          report_date: string;
          source_file_name?: string | null;
          sales_net_vat?: number | null;
          margin_percent?: number | null;
          cogs_percent?: number | null;
          labor_cost_percent?: number | null;
          guest_count?: number | null;
          check_count?: number | null;
          gross_sales_before_discounts?: number | null;
          total_discounts?: number | null;
          gross_sales_after_discounts?: number | null;
          tax_collected?: number | null;
          service_charges?: number | null;
          non_revenue_total?: number | null;
          cost_of_goods_sold?: number | null;
          labor_cost?: number | null;
          operating_margin?: number | null;
          returns_count?: number | null;
          returns_amount?: number | null;
          voids_count?: number | null;
          voids_amount?: number | null;
          manager_voids_count?: number | null;
          manager_voids_amount?: number | null;
          error_corrects_count?: number | null;
          error_corrects_amount?: number | null;
          cancels_count?: number | null;
          cancels_amount?: number | null;
          guests_average_spend?: number | null;
          checks_average_spend?: number | null;
          table_turns_count?: number | null;
          table_turns_average_spend?: number | null;
          average_dining_time_hours?: number | null;
          direct_charged_tips?: number | null;
          direct_cash_tips?: number | null;
          indirect_tips?: number | null;
          total_tips?: number | null;
          tips_paid?: number | null;
          cash_in?: number | null;
          paid_in?: number | null;
          paid_out?: number | null;
          cash_due?: number | null;
          deposits?: number | null;
          over_short?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          report_date?: string;
          source_file_name?: string | null;
          sales_net_vat?: number | null;
          margin_percent?: number | null;
          cogs_percent?: number | null;
          labor_cost_percent?: number | null;
          guest_count?: number | null;
          check_count?: number | null;
          gross_sales_before_discounts?: number | null;
          total_discounts?: number | null;
          gross_sales_after_discounts?: number | null;
          tax_collected?: number | null;
          service_charges?: number | null;
          non_revenue_total?: number | null;
          cost_of_goods_sold?: number | null;
          labor_cost?: number | null;
          operating_margin?: number | null;
          returns_count?: number | null;
          returns_amount?: number | null;
          voids_count?: number | null;
          voids_amount?: number | null;
          manager_voids_count?: number | null;
          manager_voids_amount?: number | null;
          error_corrects_count?: number | null;
          error_corrects_amount?: number | null;
          cancels_count?: number | null;
          cancels_amount?: number | null;
          guests_average_spend?: number | null;
          checks_average_spend?: number | null;
          table_turns_count?: number | null;
          table_turns_average_spend?: number | null;
          average_dining_time_hours?: number | null;
          direct_charged_tips?: number | null;
          direct_cash_tips?: number | null;
          indirect_tips?: number | null;
          total_tips?: number | null;
          tips_paid?: number | null;
          cash_in?: number | null;
          paid_in?: number | null;
          paid_out?: number | null;
          cash_due?: number | null;
          deposits?: number | null;
          over_short?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      daily_operations_labor: {
        Row: {
          id: string;
          daily_report_id: string;
          job_code_name: string;
          regular_hours: number | null;
          overtime_hours: number | null;
          total_hours: number | null;
          regular_pay: number | null;
          overtime_pay: number | null;
          total_pay: number | null;
          labor_cost_percent: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          daily_report_id: string;
          job_code_name: string;
          regular_hours?: number | null;
          overtime_hours?: number | null;
          total_hours?: number | null;
          regular_pay?: number | null;
          overtime_pay?: number | null;
          total_pay?: number | null;
          labor_cost_percent?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          daily_report_id?: string;
          job_code_name?: string;
          regular_hours?: number | null;
          overtime_hours?: number | null;
          total_hours?: number | null;
          regular_pay?: number | null;
          overtime_pay?: number | null;
          total_pay?: number | null;
          labor_cost_percent?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };

      daily_operations_revenue_centers: {
        Row: {
          id: string;
          daily_report_id: string;
          revenue_center_name: string;
          sales_net_vat: number | null;
          percent_of_total_sales: number | null;
          guests: number | null;
          percent_of_total_guests: number | null;
          average_spend_per_guest: number | null;
          checks: number | null;
          percent_of_total_checks: number | null;
          average_spend_per_check: number | null;
          table_turns: number | null;
          percent_of_total_table_turns: number | null;
          average_spend_per_table_turn: number | null;
          average_turn_time: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          daily_report_id: string;
          revenue_center_name: string;
          sales_net_vat?: number | null;
          percent_of_total_sales?: number | null;
          guests?: number | null;
          percent_of_total_guests?: number | null;
          average_spend_per_guest?: number | null;
          checks?: number | null;
          percent_of_total_checks?: number | null;
          average_spend_per_check?: number | null;
          table_turns?: number | null;
          percent_of_total_table_turns?: number | null;
          average_spend_per_table_turn?: number | null;
          average_turn_time?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          daily_report_id?: string;
          revenue_center_name?: string;
          sales_net_vat?: number | null;
          percent_of_total_sales?: number | null;
          guests?: number | null;
          percent_of_total_guests?: number | null;
          average_spend_per_guest?: number | null;
          checks?: number | null;
          percent_of_total_checks?: number | null;
          average_spend_per_check?: number | null;
          table_turns?: number | null;
          percent_of_total_table_turns?: number | null;
          average_spend_per_table_turn?: number | null;
          average_turn_time?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };

      compliance_items: {
        Row: {
          id: string;
          category: string;
          display_name: string;
          description: string | null;
          status: string;
          last_inspection_date: string | null;
          next_due_date: string | null;
          responsible_party: string | null;
          notes: string | null;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category: string;
          display_name: string;
          description?: string | null;
          status?: string;
          last_inspection_date?: string | null;
          next_due_date?: string | null;
          responsible_party?: string | null;
          notes?: string | null;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          category?: string;
          display_name?: string;
          description?: string | null;
          status?: string;
          last_inspection_date?: string | null;
          next_due_date?: string | null;
          responsible_party?: string | null;
          notes?: string | null;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      compliance_documents: {
        Row: {
          id: string;
          item_id: string;
          file_name: string;
          file_url: string;
          file_size: number | null;
          uploaded_by: string | null;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          file_name: string;
          file_url: string;
          file_size?: number | null;
          uploaded_by?: string | null;
          uploaded_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          file_name?: string;
          file_url?: string;
          file_size?: number | null;
          uploaded_by?: string | null;
          uploaded_at?: string;
        };
        Relationships: [];
      };
      // ── Universal model (migrations 012 & 013) ──────────────────────────
      sites: {
        Row: {
          id: string;
          name: string;
          site_type: string;
          address: string | null;
          city: string | null;
          country: string;
          timezone: string;
          is_active: boolean;
          metadata_json: Record<string, unknown>;
          organisation_id: string | null;
          region_id: string | null;
          store_code: string | null;
          gm_user_id: string | null;
          target_labour_pct: number | null;
          target_margin_pct: number | null;
          target_avg_spend: number | null;
          seating_capacity: number | null;
          settings: Record<string, unknown>;
          google_place_id: string | null;
          allowed_routes: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          site_type?: string;
          address?: string | null;
          city?: string | null;
          country?: string;
          timezone?: string;
          is_active?: boolean;
          metadata_json?: Record<string, unknown>;
          organisation_id?: string | null;
          region_id?: string | null;
          store_code?: string | null;
          gm_user_id?: string | null;
          target_labour_pct?: number | null;
          target_margin_pct?: number | null;
          target_avg_spend?: number | null;
          seating_capacity?: number | null;
          settings?: Record<string, unknown>;
          google_place_id?: string | null;
          allowed_routes?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          site_type?: string;
          address?: string | null;
          city?: string | null;
          country?: string;
          timezone?: string;
          is_active?: boolean;
          metadata_json?: Record<string, unknown>;
          organisation_id?: string | null;
          region_id?: string | null;
          store_code?: string | null;
          gm_user_id?: string | null;
          target_labour_pct?: number | null;
          target_margin_pct?: number | null;
          target_avg_spend?: number | null;
          seating_capacity?: number | null;
          settings?: Record<string, unknown>;
          google_place_id?: string | null;
          allowed_routes?: string[] | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      zones: {
        Row: {
          id: string;
          site_id: string;
          name: string;
          zone_type: string;
          description: string | null;
          display_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          name: string;
          zone_type?: string;
          description?: string | null;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string;
          name?: string;
          zone_type?: string;
          description?: string | null;
          display_order?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [{ foreignKeyName: "zones_site_id_fkey"; columns: ["site_id"]; referencedRelation: "sites"; referencedColumns: ["id"] }];
      };
      contractors: {
        Row: {
          id: string;
          company_name: string;
          contact_name: string | null;
          phone: string | null;
          email: string | null;
          specialisation: string[] | null;
          is_preferred: boolean;
          is_active: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_name: string;
          contact_name?: string | null;
          phone?: string | null;
          email?: string | null;
          specialisation?: string[] | null;
          is_preferred?: boolean;
          is_active?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_name?: string;
          contact_name?: string | null;
          phone?: string | null;
          email?: string | null;
          specialisation?: string[] | null;
          is_preferred?: boolean;
          is_active?: boolean;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      obligations: {
        Row: {
          id: string;
          site_id: string;
          zone_id: string | null;
          asset_id: string | null;
          label: string;
          obligation_type: string;
          compliance_item_id: string | null;
          recurrence: string;
          status: string;
          last_completed_at: string | null;
          next_due_at: string | null;
          responsible_party: string | null;
          priority: string;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          zone_id?: string | null;
          asset_id?: string | null;
          label: string;
          obligation_type?: string;
          compliance_item_id?: string | null;
          recurrence?: string;
          status?: string;
          last_completed_at?: string | null;
          next_due_at?: string | null;
          responsible_party?: string | null;
          priority?: string;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string;
          zone_id?: string | null;
          asset_id?: string | null;
          label?: string;
          obligation_type?: string;
          compliance_item_id?: string | null;
          recurrence?: string;
          status?: string;
          last_completed_at?: string | null;
          next_due_at?: string | null;
          responsible_party?: string | null;
          priority?: string;
          notes?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "obligations_site_id_fkey"; columns: ["site_id"]; referencedRelation: "sites"; referencedColumns: ["id"] },
          { foreignKeyName: "obligations_zone_id_fkey"; columns: ["zone_id"]; referencedRelation: "zones"; referencedColumns: ["id"] },
          { foreignKeyName: "obligations_compliance_item_id_fkey"; columns: ["compliance_item_id"]; referencedRelation: "compliance_items"; referencedColumns: ["id"] }
        ];
      };
      documents: {
        Row: {
          id: string;
          site_id: string;
          document_type: string;
          obligation_id: string | null;
          asset_id: string | null;
          ticket_id: string | null;
          compliance_doc_id: string | null;
          file_name: string;
          file_url: string;
          file_size: number | null;
          uploaded_by: string | null;
          notes: string | null;
          valid_from: string | null;
          valid_until: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          document_type?: string;
          obligation_id?: string | null;
          asset_id?: string | null;
          ticket_id?: string | null;
          compliance_doc_id?: string | null;
          file_name: string;
          file_url: string;
          file_size?: number | null;
          uploaded_by?: string | null;
          notes?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string;
          document_type?: string;
          obligation_id?: string | null;
          asset_id?: string | null;
          ticket_id?: string | null;
          compliance_doc_id?: string | null;
          file_name?: string;
          file_url?: string;
          file_size?: number | null;
          uploaded_by?: string | null;
          notes?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Relationships: [
          { foreignKeyName: "documents_site_id_fkey"; columns: ["site_id"]; referencedRelation: "sites"; referencedColumns: ["id"] }
        ];
      };
      workflow_logs: {
        Row: {
          id: string;
          entity_type: string;
          entity_id: string;
          site_id: string | null;
          action: string;
          from_value: string | null;
          to_value: string | null;
          triggered_by: string | null;
          channel: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          entity_type: string;
          entity_id: string;
          site_id?: string | null;
          action: string;
          from_value?: string | null;
          to_value?: string | null;
          triggered_by?: string | null;
          channel?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          entity_type?: string;
          entity_id?: string;
          site_id?: string | null;
          action?: string;
          from_value?: string | null;
          to_value?: string | null;
          triggered_by?: string | null;
          channel?: string | null;
          notes?: string | null;
        };
        Relationships: [];
      };
      risk_scores: {
        Row: {
          id: string;
          site_id: string;
          zone_id: string | null;
          ticket_score: number;
          obligation_score: number;
          asset_score: number;
          event_conflict_score: number;
          composite_score: number;
          status: string;
          open_ticket_count: number;
          overdue_obligation_count: number;
          oos_asset_count: number;
          active_event_count: number;
          computed_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          zone_id?: string | null;
          ticket_score?: number;
          obligation_score?: number;
          asset_score?: number;
          event_conflict_score?: number;
          composite_score?: number;
          status?: string;
          open_ticket_count?: number;
          overdue_obligation_count?: number;
          oos_asset_count?: number;
          active_event_count?: number;
          computed_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string;
          zone_id?: string | null;
          ticket_score?: number;
          obligation_score?: number;
          asset_score?: number;
          event_conflict_score?: number;
          composite_score?: number;
          status?: string;
          open_ticket_count?: number;
          overdue_obligation_count?: number;
          oos_asset_count?: number;
          active_event_count?: number;
          computed_at?: string;
        };
        Relationships: [
          { foreignKeyName: "risk_scores_site_id_fkey"; columns: ["site_id"]; referencedRelation: "sites"; referencedColumns: ["id"] },
          { foreignKeyName: "risk_scores_zone_id_fkey"; columns: ["zone_id"]; referencedRelation: "zones"; referencedColumns: ["id"] }
        ];
      };
      zone_snapshots: {
        Row: {
          id: string;
          site_id: string;
          zone_id: string | null;
          zone_name: string;
          status: string;
          composite_score: number;
          primary_risk: string | null;
          secondary_risk: string | null;
          ticket_count: number;
          obligation_count: number;
          oos_count: number;
          snapped_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          zone_id?: string | null;
          zone_name: string;
          status: string;
          composite_score?: number;
          primary_risk?: string | null;
          secondary_risk?: string | null;
          ticket_count?: number;
          obligation_count?: number;
          oos_count?: number;
          snapped_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string;
          zone_id?: string | null;
          zone_name?: string;
          status?: string;
          composite_score?: number;
          primary_risk?: string | null;
          secondary_risk?: string | null;
          ticket_count?: number;
          obligation_count?: number;
          oos_count?: number;
          snapped_at?: string;
        };
        Relationships: [
          { foreignKeyName: "zone_snapshots_site_id_fkey"; columns: ["site_id"]; referencedRelation: "sites"; referencedColumns: ["id"] },
          { foreignKeyName: "zone_snapshots_zone_id_fkey"; columns: ["zone_id"]; referencedRelation: "zones"; referencedColumns: ["id"] }
        ];
      };
      asset_service_history: {
        Row: {
          id: string;
          asset_id: string;
          site_id: string;
          service_type: string;
          service_date: string;
          description: string | null;
          performed_by: string | null;
          contractor_id: string | null;
          cost: number | null;
          next_service_due: string | null;
          document_url: string | null;
          equipment_repair_id: string | null;
          maintenance_log_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          asset_id: string;
          site_id: string;
          service_type?: string;
          service_date: string;
          description?: string | null;
          performed_by?: string | null;
          contractor_id?: string | null;
          cost?: number | null;
          next_service_due?: string | null;
          document_url?: string | null;
          equipment_repair_id?: string | null;
          maintenance_log_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          asset_id?: string;
          site_id?: string;
          service_type?: string;
          service_date?: string;
          description?: string | null;
          performed_by?: string | null;
          contractor_id?: string | null;
          cost?: number | null;
          next_service_due?: string | null;
          document_url?: string | null;
          equipment_repair_id?: string | null;
          maintenance_log_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "ash_asset_id_fkey"; columns: ["asset_id"]; referencedRelation: "equipment"; referencedColumns: ["id"] },
          { foreignKeyName: "ash_site_id_fkey"; columns: ["site_id"]; referencedRelation: "sites"; referencedColumns: ["id"] }
        ];
      };
      micros_connections: {
        Row: {
          id: string;
          location_name: string;
          loc_ref: string;
          auth_server_url: string;
          app_server_url: string;
          client_id: string;
          org_identifier: string;
          access_token: string | null;
          token_expires_at: string | null;
          status: string;
          last_sync_at: string | null;
          last_sync_error: string | null;
          last_successful_sync_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          location_name?: string;
          loc_ref?: string;
          auth_server_url: string;
          app_server_url: string;
          client_id: string;
          org_identifier: string;
          access_token?: string | null;
          token_expires_at?: string | null;
          status?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_successful_sync_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          location_name?: string;
          loc_ref?: string;
          auth_server_url?: string;
          app_server_url?: string;
          client_id?: string;
          org_identifier?: string;
          access_token?: string | null;
          token_expires_at?: string | null;
          status?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_successful_sync_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      micros_sync_runs: {
        Row: {
          id: string;
          connection_id: string;
          sync_type: string;
          started_at: string;
          completed_at: string | null;
          status: string;
          records_fetched: number;
          records_inserted: number;
          error_message: string | null;
          metadata: Record<string, unknown>;
        };
        Insert: {
          id?: string;
          connection_id: string;
          sync_type: string;
          started_at?: string;
          completed_at?: string | null;
          status?: string;
          records_fetched?: number;
          records_inserted?: number;
          error_message?: string | null;
          metadata?: Record<string, unknown>;
        };
        Update: {
          id?: string;
          connection_id?: string;
          sync_type?: string;
          started_at?: string;
          completed_at?: string | null;
          status?: string;
          records_fetched?: number;
          records_inserted?: number;
          error_message?: string | null;
          metadata?: Record<string, unknown>;
        };
        Relationships: [
          { foreignKeyName: "msr_connection_id_fkey"; columns: ["connection_id"]; referencedRelation: "micros_connections"; referencedColumns: ["id"] }
        ];
      };
      micros_sales_daily: {
        Row: {
          id: string;
          connection_id: string;
          loc_ref: string;
          business_date: string;
          net_sales: number;
          gross_sales: number;
          tax_collected: number;
          service_charges: number;
          discounts: number;
          voids: number;
          returns: number;
          check_count: number;
          guest_count: number;
          avg_check_value: number;
          avg_guest_spend: number;
          labor_cost: number;
          labor_pct: number;
          synced_at: string;
          raw_response: Record<string, unknown> | null;
        };
        Insert: {
          id?: string;
          connection_id: string;
          loc_ref: string;
          business_date: string;
          net_sales?: number;
          gross_sales?: number;
          tax_collected?: number;
          service_charges?: number;
          discounts?: number;
          voids?: number;
          returns?: number;
          check_count?: number;
          guest_count?: number;
          avg_check_value?: number;
          avg_guest_spend?: number;
          labor_cost?: number;
          labor_pct?: number;
          synced_at?: string;
          raw_response?: Record<string, unknown> | null;
        };
        Update: {
          id?: string;
          connection_id?: string;
          loc_ref?: string;
          business_date?: string;
          net_sales?: number;
          gross_sales?: number;
          tax_collected?: number;
          service_charges?: number;
          discounts?: number;
          voids?: number;
          returns?: number;
          check_count?: number;
          guest_count?: number;
          avg_check_value?: number;
          avg_guest_spend?: number;
          labor_cost?: number;
          labor_pct?: number;
          synced_at?: string;
          raw_response?: Record<string, unknown> | null;
        };
        Relationships: [
          { foreignKeyName: "msd_connection_id_fkey"; columns: ["connection_id"]; referencedRelation: "micros_connections"; referencedColumns: ["id"] }
        ];
      };
      micros_sales_intervals: {
        Row: {
          id: string;
          connection_id: string;
          loc_ref: string;
          business_date: string;
          interval_start: string;
          interval_end: string;
          net_sales: number;
          check_count: number;
          guest_count: number;
          synced_at: string;
        };
        Insert: {
          id?: string;
          connection_id: string;
          loc_ref: string;
          business_date: string;
          interval_start: string;
          interval_end: string;
          net_sales?: number;
          check_count?: number;
          guest_count?: number;
          synced_at?: string;
        };
        Update: {
          id?: string;
          connection_id?: string;
          loc_ref?: string;
          business_date?: string;
          interval_start?: string;
          interval_end?: string;
          net_sales?: number;
          check_count?: number;
          guest_count?: number;
          synced_at?: string;
        };
        Relationships: [
          { foreignKeyName: "msi_connection_id_fkey"; columns: ["connection_id"]; referencedRelation: "micros_connections"; referencedColumns: ["id"] }
        ];
      };
      micros_guest_checks: {
        Row: {
          id: string;
          connection_id: string;
          loc_ref: string;
          check_number: string;
          business_date: string;
          opened_at: string | null;
          closed_at: string | null;
          table_number: string | null;
          server_name: string | null;
          guest_count: number;
          net_total: number;
          gross_total: number;
          discounts: number;
          gratuity: number;
          payment_method: string | null;
          status: string;
          synced_at: string;
        };
        Insert: {
          id?: string;
          connection_id: string;
          loc_ref: string;
          check_number: string;
          business_date: string;
          opened_at?: string | null;
          closed_at?: string | null;
          table_number?: string | null;
          server_name?: string | null;
          guest_count?: number;
          net_total?: number;
          gross_total?: number;
          discounts?: number;
          gratuity?: number;
          payment_method?: string | null;
          status?: string;
          synced_at?: string;
        };
        Update: {
          id?: string;
          connection_id?: string;
          loc_ref?: string;
          check_number?: string;
          business_date?: string;
          opened_at?: string | null;
          closed_at?: string | null;
          table_number?: string | null;
          server_name?: string | null;
          guest_count?: number;
          net_total?: number;
          gross_total?: number;
          discounts?: number;
          gratuity?: number;
          payment_method?: string | null;
          status?: string;
          synced_at?: string;
        };
        Relationships: [
          { foreignKeyName: "mgc_connection_id_fkey"; columns: ["connection_id"]; referencedRelation: "micros_connections"; referencedColumns: ["id"] }
        ];
      };
      micros_labor_daily: {
        Row: {
          id: string;
          connection_id: string;
          loc_ref: string;
          business_date: string;
          job_code: string;
          job_name: string | null;
          employee_count: number;
          regular_hours: number;
          overtime_hours: number;
          total_hours: number;
          labor_cost: number;
          synced_at: string;
        };
        Insert: {
          id?: string;
          connection_id: string;
          loc_ref: string;
          business_date: string;
          job_code?: string;
          job_name?: string | null;
          employee_count?: number;
          regular_hours?: number;
          overtime_hours?: number;
          total_hours?: number;
          labor_cost?: number;
          synced_at?: string;
        };
        Update: {
          id?: string;
          connection_id?: string;
          loc_ref?: string;
          business_date?: string;
          job_code?: string;
          job_name?: string | null;
          employee_count?: number;
          regular_hours?: number;
          overtime_hours?: number;
          total_hours?: number;
          labor_cost?: number;
          synced_at?: string;
        };
        Relationships: [
          { foreignKeyName: "mld_connection_id_fkey"; columns: ["connection_id"]; referencedRelation: "micros_connections"; referencedColumns: ["id"] }
        ];
      };

      actions: {
        Row: {
          id:            string;
          title:         string;
          description:   string | null;
          impact_weight: string;
          status:        string;
          source_type:   string | null;
          source_id:     string | null;
          assigned_to:   string | null;
          site_id:       string | null;
          zone_id:       string | null;
          created_at:    string;
          updated_at:    string;
          started_at:    string | null;
          completed_at:  string | null;
          archived_at:   string | null;
          revenue_before:      number | null;
          revenue_after:       number | null;
          revenue_delta:       number | null;
          revenue_date_before: string | null;
          revenue_date_after:  string | null;
          execution_type:      string | null;
        };
        Insert: {
          id?:           string;
          title:         string;
          description?:  string | null;
          impact_weight?: string;
          status?:       string;
          source_type?:  string | null;
          source_id?:    string | null;
          assigned_to?:  string | null;
          site_id?:      string | null;
          zone_id?:      string | null;
          created_at?:   string;
          updated_at?:   string;
          started_at?:   string | null;
          completed_at?: string | null;
          archived_at?:  string | null;
          revenue_before?:      number | null;
          revenue_after?:       number | null;
          revenue_delta?:       number | null;
          revenue_date_before?: string | null;
          revenue_date_after?:  string | null;
          execution_type?:      string | null;
        };
        Update: {
          id?:           string;
          title?:        string;
          description?:  string | null;
          impact_weight?: string;
          status?:       string;
          source_type?:  string | null;
          source_id?:    string | null;
          assigned_to?:  string | null;
          site_id?:      string | null;
          zone_id?:      string | null;
          created_at?:   string;
          updated_at?:   string;
          started_at?:   string | null;
          completed_at?: string | null;
          archived_at?:  string | null;
          revenue_before?:      number | null;
          revenue_after?:       number | null;
          revenue_delta?:       number | null;
          revenue_date_before?: string | null;
          revenue_date_after?:  string | null;
          execution_type?:      string | null;
        };
        Relationships: [];
      };

      action_daily_stats: {
        Row: {
          id:                     string;
          site_id:                string | null;
          stat_date:              string;
          total_created:          number;
          total_completed:        number;
          total_carried_forward:  number;
          completion_rate_pct:    number;
          avg_resolution_minutes: number | null;
          critical_completed:     number;
          high_completed:         number;
          medium_completed:       number;
          low_completed:          number;
          ops_score:              number | null;
          missed_actions:         number;
          created_at:             string;
        };
        Insert: {
          id?:                     string;
          site_id?:                string | null;
          stat_date:               string;
          total_created?:          number;
          total_completed?:        number;
          total_carried_forward?:  number;
          completion_rate_pct?:    number;
          avg_resolution_minutes?: number | null;
          critical_completed?:     number;
          high_completed?:         number;
          medium_completed?:       number;
          low_completed?:          number;
          ops_score?:              number | null;
          missed_actions?:         number;
          created_at?:             string;
        };
        Update: {
          id?:                     string;
          site_id?:                string | null;
          stat_date?:              string;
          total_created?:          number;
          total_completed?:        number;
          total_carried_forward?:  number;
          completion_rate_pct?:    number;
          avg_resolution_minutes?: number | null;
          critical_completed?:     number;
          high_completed?:         number;
          medium_completed?:       number;
          low_completed?:          number;
          ops_score?:              number | null;
          missed_actions?:         number;
          created_at?:             string;
        };
        Relationships: [];
      };

      store_snapshots: {
        Row: {
          id:                string;
          site_id:           string;
          snapshot_date:     string;
          operating_score:   number | null;
          score_grade:       string | null;
          sales_net_vat:     number | null;
          revenue_target:    number | null;
          revenue_gap_pct:   number | null;
          labour_pct:        number | null;
          compliance_score:  number | null;
          maintenance_score: number | null;
          risk_level:        "green" | "yellow" | "red";
          actions_total:     number;
          actions_completed: number;
          actions_overdue:   number;
          created_at:        string;
        };
        Insert: {
          id?:                string;
          site_id:            string;
          snapshot_date:      string;
          operating_score?:   number | null;
          score_grade?:       string | null;
          sales_net_vat?:     number | null;
          revenue_target?:    number | null;
          revenue_gap_pct?:   number | null;
          labour_pct?:        number | null;
          compliance_score?:  number | null;
          maintenance_score?: number | null;
          risk_level?:        "green" | "yellow" | "red";
          actions_total?:     number;
          actions_completed?: number;
          actions_overdue?:   number;
          created_at?:        string;
        };
        Update: {
          id?:                string;
          site_id?:           string;
          snapshot_date?:     string;
          operating_score?:   number | null;
          score_grade?:       string | null;
          sales_net_vat?:     number | null;
          revenue_target?:    number | null;
          revenue_gap_pct?:   number | null;
          labour_pct?:        number | null;
          compliance_score?:  number | null;
          maintenance_score?: number | null;
          risk_level?:        "green" | "yellow" | "red";
          actions_total?:     number;
          actions_completed?: number;
          actions_overdue?:   number;
          created_at?:        string;
        };
        Relationships: [
          {
            foreignKeyName: "store_snapshots_site_id_fkey";
            columns: ["site_id"];
            referencedRelation: "sites";
            referencedColumns: ["id"];
          }
        ];
      };

      // ── Labour Integration tables ─────────────────────────────────
      labour_job_codes: {
        Row: {
          id: number;
          loc_ref: string;
          num: string;
          name: string;
          mstr_num: string;
          mstr_name: string;
          lbr_cat_num: string;
          lbr_cat_name: string;
          lbr_cat_mstr_num: string;
          lbr_cat_mstr_name: string;
          synced_at: string;
        };
        Insert: {
          id?: number;
          loc_ref: string;
          num: string;
          name?: string;
          mstr_num?: string;
          mstr_name?: string;
          lbr_cat_num?: string;
          lbr_cat_name?: string;
          lbr_cat_mstr_num?: string;
          lbr_cat_mstr_name?: string;
          synced_at?: string;
        };
        Update: {
          loc_ref?: string;
          num?: string;
          name?: string;
          mstr_num?: string;
          mstr_name?: string;
          lbr_cat_num?: string;
          lbr_cat_name?: string;
          lbr_cat_mstr_num?: string;
          lbr_cat_mstr_name?: string;
          synced_at?: string;
        };
        Relationships: [];
      };

      labour_timecards: {
        Row: {
          id: number;
          tc_id: string;
          business_date: string;
          loc_ref: string;
          emp_num: string;
          payroll_id: string;
          ext_payroll_id: string;
          job_code_ref: string;
          jc_num: string;
          rvc_num: string;
          shft_num: string;
          clk_in_lcl: string | null;
          clk_out_lcl: string | null;
          clk_in_utc: string | null;
          clk_out_utc: string | null;
          reg_hrs: number;
          reg_pay: number;
          ovt1_hrs: number;
          ovt1_pay: number;
          ovt2_hrs: number;
          ovt2_pay: number;
          ovt3_hrs: number;
          ovt3_pay: number;
          ovt4_hrs: number;
          ovt4_pay: number;
          prem_hrs: number;
          prem_pay: number;
          total_hours: number;
          total_pay: number;
          gross_rcpts: number;
          chrg_rcpts: number;
          chrg_tips: number;
          drct_tips: number;
          indir_tips: number;
          svc_tips: number;
          tips_pd: number;
          last_updated_utc: string | null;
          added_utc: string | null;
          has_adjustments: boolean;
          adjustments_json: Json | null;
          synced_at: string;
        };
        Insert: {
          id?: number;
          tc_id: string;
          business_date: string;
          loc_ref: string;
          emp_num?: string;
          payroll_id?: string;
          ext_payroll_id?: string;
          job_code_ref?: string;
          jc_num?: string;
          rvc_num?: string;
          shft_num?: string;
          clk_in_lcl?: string | null;
          clk_out_lcl?: string | null;
          clk_in_utc?: string | null;
          clk_out_utc?: string | null;
          reg_hrs?: number;
          reg_pay?: number;
          ovt1_hrs?: number;
          ovt1_pay?: number;
          ovt2_hrs?: number;
          ovt2_pay?: number;
          ovt3_hrs?: number;
          ovt3_pay?: number;
          ovt4_hrs?: number;
          ovt4_pay?: number;
          prem_hrs?: number;
          prem_pay?: number;
          total_hours?: number;
          total_pay?: number;
          gross_rcpts?: number;
          chrg_rcpts?: number;
          chrg_tips?: number;
          drct_tips?: number;
          indir_tips?: number;
          svc_tips?: number;
          tips_pd?: number;
          last_updated_utc?: string | null;
          added_utc?: string | null;
          has_adjustments?: boolean;
          adjustments_json?: Json | null;
          synced_at?: string;
        };
        Update: {
          tc_id?: string;
          business_date?: string;
          loc_ref?: string;
          emp_num?: string;
          payroll_id?: string;
          ext_payroll_id?: string;
          job_code_ref?: string;
          jc_num?: string;
          rvc_num?: string;
          shft_num?: string;
          clk_in_lcl?: string | null;
          clk_out_lcl?: string | null;
          clk_in_utc?: string | null;
          clk_out_utc?: string | null;
          reg_hrs?: number;
          reg_pay?: number;
          ovt1_hrs?: number;
          ovt1_pay?: number;
          ovt2_hrs?: number;
          ovt2_pay?: number;
          ovt3_hrs?: number;
          ovt3_pay?: number;
          ovt4_hrs?: number;
          ovt4_pay?: number;
          prem_hrs?: number;
          prem_pay?: number;
          total_hours?: number;
          total_pay?: number;
          gross_rcpts?: number;
          chrg_rcpts?: number;
          chrg_tips?: number;
          drct_tips?: number;
          indir_tips?: number;
          svc_tips?: number;
          tips_pd?: number;
          last_updated_utc?: string | null;
          added_utc?: string | null;
          has_adjustments?: boolean;
          adjustments_json?: Json | null;
          synced_at?: string;
        };
        Relationships: [];
      };

      labour_daily_summary: {
        Row: {
          id: number;
          loc_ref: string;
          business_date: string;
          total_hours: number;
          total_pay: number;
          reg_hours: number;
          reg_pay: number;
          ovt_hours: number;
          ovt_pay: number;
          prem_hours: number;
          prem_pay: number;
          active_staff_count: number;
          open_timecard_count: number;
          net_sales: number | null;
          labour_pct: number | null;
          by_role_json: Json;
          by_category_json: Json;
          by_rvc_json: Json;
          synced_at: string;
        };
        Insert: {
          id?: number;
          loc_ref: string;
          business_date: string;
          total_hours?: number;
          total_pay?: number;
          reg_hours?: number;
          reg_pay?: number;
          ovt_hours?: number;
          ovt_pay?: number;
          prem_hours?: number;
          prem_pay?: number;
          active_staff_count?: number;
          open_timecard_count?: number;
          net_sales?: number | null;
          labour_pct?: number | null;
          by_role_json?: Json;
          by_category_json?: Json;
          by_rvc_json?: Json;
          synced_at?: string;
        };
        Update: {
          loc_ref?: string;
          business_date?: string;
          total_hours?: number;
          total_pay?: number;
          reg_hours?: number;
          reg_pay?: number;
          ovt_hours?: number;
          ovt_pay?: number;
          prem_hours?: number;
          prem_pay?: number;
          active_staff_count?: number;
          open_timecard_count?: number;
          net_sales?: number | null;
          labour_pct?: number | null;
          by_role_json?: Json;
          by_category_json?: Json;
          by_rvc_json?: Json;
          synced_at?: string;
        };
        Relationships: [];
      };

      labour_sync_state: {
        Row: {
          id: number;
          loc_ref: string;
          last_cur_utc: string | null;
          last_bus_dt: string | null;
          last_sync_at: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: number;
          loc_ref: string;
          last_cur_utc?: string | null;
          last_bus_dt?: string | null;
          last_sync_at?: string | null;
          error_message?: string | null;
        };
        Update: {
          loc_ref?: string;
          last_cur_utc?: string | null;
          last_bus_dt?: string | null;
          last_sync_at?: string | null;
          error_message?: string | null;
        };
        Relationships: [];
      };

      // ── Sync Engine V2 tables ─────────────────────────────────────

      sync_locks: {
        Row: {
          id: string;
          lock_key: string;
          owner_id: string;
          acquired_at: string;
          expires_at: string;
          metadata: Json;
        };
        Insert: {
          id?: string;
          lock_key: string;
          owner_id: string;
          acquired_at?: string;
          expires_at: string;
          metadata?: Json;
        };
        Update: {
          lock_key?: string;
          owner_id?: string;
          acquired_at?: string;
          expires_at?: string;
          metadata?: Json;
        };
        Relationships: [];
      };

      sync_runs: {
        Row: {
          id: string;
          site_id: string;
          sync_type: string;
          source: string;
          status: string;
          trigger: string;
          idempotency_key: string | null;
          started_at: string | null;
          completed_at: string | null;
          duration_ms: number | null;
          records_fetched: number;
          records_written: number;
          records_skipped: number;
          records_errored: number;
          error_message: string | null;
          error_code: string | null;
          checkpoint_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          sync_type: string;
          source?: string;
          status?: string;
          trigger?: string;
          idempotency_key?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          duration_ms?: number | null;
          records_fetched?: number;
          records_written?: number;
          records_skipped?: number;
          records_errored?: number;
          error_message?: string | null;
          error_code?: string | null;
          checkpoint_id?: string | null;
          metadata?: Json;
        };
        Update: {
          site_id?: string;
          sync_type?: string;
          source?: string;
          status?: string;
          trigger?: string;
          idempotency_key?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          duration_ms?: number | null;
          records_fetched?: number;
          records_written?: number;
          records_skipped?: number;
          records_errored?: number;
          error_message?: string | null;
          error_code?: string | null;
          checkpoint_id?: string | null;
          metadata?: Json;
        };
        Relationships: [];
      };

      sync_checkpoints: {
        Row: {
          id: string;
          site_id: string;
          sync_type: string;
          source: string;
          cursor_value: string;
          cursor_type: string;
          run_id: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          sync_type: string;
          source?: string;
          cursor_value: string;
          cursor_type?: string;
          run_id?: string | null;
          metadata?: Json;
        };
        Update: {
          site_id?: string;
          sync_type?: string;
          source?: string;
          cursor_value?: string;
          cursor_type?: string;
          run_id?: string | null;
          metadata?: Json;
        };
        Relationships: [];
      };

      sync_errors: {
        Row: {
          id: string;
          run_id: string;
          site_id: string;
          sync_type: string;
          phase: string;
          error_code: string | null;
          message: string;
          record_key: string | null;
          context: Json;
          retryable: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          site_id: string;
          sync_type: string;
          phase: string;
          error_code?: string | null;
          message: string;
          record_key?: string | null;
          context?: Json;
          retryable?: boolean;
        };
        Update: {
          run_id?: string;
          site_id?: string;
          sync_type?: string;
          phase?: string;
          error_code?: string | null;
          message?: string;
          record_key?: string | null;
          context?: Json;
          retryable?: boolean;
        };
        Relationships: [];
      };

      source_ingestion_fingerprints: {
        Row: {
          id: string;
          site_id: string;
          sync_type: string;
          record_key: string;
          content_hash: string;
          run_id: string | null;
          first_seen_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          sync_type: string;
          record_key: string;
          content_hash: string;
          run_id?: string | null;
          first_seen_at?: string;
          last_seen_at?: string;
        };
        Update: {
          site_id?: string;
          sync_type?: string;
          record_key?: string;
          content_hash?: string;
          run_id?: string | null;
          first_seen_at?: string;
          last_seen_at?: string;
        };
        Relationships: [];
      };

      // ── Admin Dashboard tables ────────────────────────────────────────────

      organisations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          country: string;
          timezone: string;
          currency: string;
          settings: Record<string, unknown>;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          country?: string;
          timezone?: string;
          currency?: string;
          settings?: Record<string, unknown>;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          slug?: string;
          country?: string;
          timezone?: string;
          currency?: string;
          settings?: Record<string, unknown>;
          is_active?: boolean;
        };
        Relationships: [];
      };

      regions: {
        Row: {
          id: string;
          organisation_id: string;
          name: string;
          code: string;
          area_manager_id: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organisation_id: string;
          name: string;
          code: string;
          area_manager_id?: string | null;
          is_active?: boolean;
        };
        Update: {
          organisation_id?: string;
          name?: string;
          code?: string;
          area_manager_id?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };

      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          status: string;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          status?: string;
        };
        Update: {
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          status?: string;
          last_seen_at?: string | null;
        };
        Relationships: [];
      };

      user_roles: {
        Row: {
          id: string;
          user_id: string;
          organisation_id: string | null;
          site_id: string | null;
          region_id: string | null;
          role: string;
          is_active: boolean;
          granted_by: string | null;
          granted_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          organisation_id?: string | null;
          site_id?: string | null;
          region_id?: string | null;
          role: string;
          is_active?: boolean;
          granted_by?: string | null;
        };
        Update: {
          user_id?: string;
          organisation_id?: string | null;
          site_id?: string | null;
          region_id?: string | null;
          role?: string;
          is_active?: boolean;
          granted_by?: string | null;
          revoked_at?: string | null;
        };
        Relationships: [];
      };

      user_site_access: {
        Row: {
          id: string;
          user_id: string;
          site_id: string;
          granted_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          site_id: string;
          granted_by?: string | null;
        };
        Update: {
          user_id?: string;
          site_id?: string;
          granted_by?: string | null;
        };
        Relationships: [];
      };

      access_audit_log: {
        Row: {
          id: string;
          actor_user_id: string | null;
          target_user_id: string | null;
          action: string;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_user_id?: string | null;
          target_user_id?: string | null;
          action: string;
          metadata?: Record<string, unknown>;
        };
        Update: {
          actor_user_id?: string | null;
          target_user_id?: string | null;
          action?: string;
          metadata?: Record<string, unknown>;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
