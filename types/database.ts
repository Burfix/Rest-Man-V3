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
        };
        Relationships: [];
      };

      reviews: {
        Row: {
          id: string;
          review_date: string;
          platform: string;
          rating: number;
          reviewer_name: string | null;
          review_text: string | null;
          sentiment: string | null;
          tags: Json;
          flagged: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          review_date: string;
          platform: string;
          rating: number;
          reviewer_name?: string | null;
          review_text?: string | null;
          sentiment?: string | null;
          tags?: Json;
          flagged?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          review_date?: string;
          platform?: string;
          rating?: number;
          reviewer_name?: string | null;
          review_text?: string | null;
          sentiment?: string | null;
          tags?: Json;
          flagged?: boolean;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
