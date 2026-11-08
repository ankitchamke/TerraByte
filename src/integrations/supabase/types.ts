export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      equipment: {
        Row: {
          created_at: string;
          demo_code: string | null;
          farmer_id: string;
          id: string;
          make: string;
          model: string;
          operating_hours: number;
          photo_url: string | null;
          serial_number: string;
          status: Database["public"]["Enums"]["equipment_status"];
          type: Database["public"]["Enums"]["equipment_type"];
          updated_at: string;
          year: number | null;
        };
        Insert: {
          created_at?: string;
          demo_code?: string | null;
          farmer_id: string;
          id?: string;
          make: string;
          model: string;
          operating_hours?: number;
          photo_url?: string | null;
          serial_number: string;
          status?: Database["public"]["Enums"]["equipment_status"];
          type: Database["public"]["Enums"]["equipment_type"];
          updated_at?: string;
          year?: number | null;
        };
        Update: {
          created_at?: string;
          demo_code?: string | null;
          farmer_id?: string;
          id?: string;
          make?: string;
          model?: string;
          operating_hours?: number;
          photo_url?: string | null;
          serial_number?: string;
          status?: Database["public"]["Enums"]["equipment_status"];
          type?: Database["public"]["Enums"]["equipment_type"];
          updated_at?: string;
          year?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "equipment_farmer_id_fkey";
            columns: ["farmer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          created_at: string;
          id: string;
          is_read: boolean;
          link_target: string | null;
          notification_text: string;
          recipient_role: Database["public"]["Enums"]["user_role"];
          recipient_user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_read?: boolean;
          link_target?: string | null;
          notification_text: string;
          recipient_role: Database["public"]["Enums"]["user_role"];
          recipient_user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_read?: boolean;
          link_target?: string | null;
          notification_text?: string;
          recipient_role?: Database["public"]["Enums"]["user_role"];
          recipient_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_user_id_fkey";
            columns: ["recipient_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          auth_user_id: string | null;
          clerk_user_id: string | null;
          created_at: string;
          demo_code: string | null;
          email: string | null;
          full_name: string;
          id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
          village: string | null;
        };
        Insert: {
          auth_user_id?: string | null;
          clerk_user_id?: string | null;
          created_at?: string;
          demo_code?: string | null;
          email?: string | null;
          full_name: string;
          id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
          village?: string | null;
        };
        Update: {
          auth_user_id?: string | null;
          clerk_user_id?: string | null;
          created_at?: string;
          demo_code?: string | null;
          email?: string | null;
          full_name?: string;
          id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
          village?: string | null;
        };
        Relationships: [];
      };
      profile_contacts: {
        Row: {
          phone: string | null;
          profile_id: string;
          updated_at: string;
          village: string | null;
        };
        Insert: {
          phone?: string | null;
          profile_id: string;
          updated_at?: string;
          village?: string | null;
        };
        Update: {
          phone?: string | null;
          profile_id?: string;
          updated_at?: string;
          village?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profile_contacts_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_auth_secrets: {
        Row: {
          auth_user_id: string | null;
          clerk_user_id: string | null;
          created_at: string;
          demo_code: string | null;
          email: string | null;
          profile_id: string;
          updated_at: string;
        };
        Insert: {
          auth_user_id?: string | null;
          clerk_user_id?: string | null;
          created_at?: string;
          demo_code?: string | null;
          email?: string | null;
          profile_id: string;
          updated_at?: string;
        };
        Update: {
          auth_user_id?: string | null;
          clerk_user_id?: string | null;
          created_at?: string;
          demo_code?: string | null;
          email?: string | null;
          profile_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_auth_secrets_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_items: {
        Row: {
          catalog_part_id: string | null;
          created_at: string;
          id: string;
          part_name: string;
          part_source: string;
          part_spec: string | null;
          quantity: number;
          quote_id: string;
          unit_price: number;
        };
        Insert: {
          catalog_part_id?: string | null;
          created_at?: string;
          id?: string;
          part_name: string;
          part_source?: string;
          part_spec?: string | null;
          quantity?: number;
          quote_id: string;
          unit_price?: number;
        };
        Update: {
          catalog_part_id?: string | null;
          created_at?: string;
          id?: string;
          part_name?: string;
          part_source?: string;
          part_spec?: string | null;
          quantity?: number;
          quote_id?: string;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: {
          created_at: string;
          estimated_completion: string;
          id: string;
          labour_amount: number;
          labour_description: string;
          repair_request_id: string;
          sent_at: string;
          status: Database["public"]["Enums"]["quote_status"];
          tax_percent: number;
          technician_id: string;
          updated_at: string;
          version: number;
          warranty_terms: string | null;
        };
        Insert: {
          created_at?: string;
          estimated_completion: string;
          id?: string;
          labour_amount?: number;
          labour_description: string;
          repair_request_id: string;
          sent_at?: string;
          status?: Database["public"]["Enums"]["quote_status"];
          tax_percent?: number;
          technician_id: string;
          updated_at?: string;
          version?: number;
          warranty_terms?: string | null;
        };
        Update: {
          created_at?: string;
          estimated_completion?: string;
          id?: string;
          labour_amount?: number;
          labour_description?: string;
          repair_request_id?: string;
          sent_at?: string;
          status?: Database["public"]["Enums"]["quote_status"];
          tax_percent?: number;
          technician_id?: string;
          updated_at?: string;
          version?: number;
          warranty_terms?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_repair_request_id_fkey";
            columns: ["repair_request_id"];
            isOneToOne: false;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_technician_id_fkey";
            columns: ["technician_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_messages: {
        Row: {
          created_at: string;
          id: string;
          is_read: boolean;
          message_text: string;
          recipient_id: string;
          repair_request_id: string;
          sender_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_read?: boolean;
          message_text: string;
          recipient_id: string;
          repair_request_id: string;
          sender_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_read?: boolean;
          message_text?: string;
          recipient_id?: string;
          repair_request_id?: string;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repair_messages_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_messages_repair_request_id_fkey";
            columns: ["repair_request_id"];
            isOneToOne: false;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_notes: {
        Row: {
          author_id: string;
          created_at: string;
          id: string;
          note_text: string;
          repair_request_id: string;
        };
        Insert: {
          author_id: string;
          created_at?: string;
          id?: string;
          note_text: string;
          repair_request_id: string;
        };
        Update: {
          author_id?: string;
          created_at?: string;
          id?: string;
          note_text?: string;
          repair_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repair_notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_notes_repair_request_id_fkey";
            columns: ["repair_request_id"];
            isOneToOne: false;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_dispatch_locations: {
        Row: {
          accuracy: number | null;
          captured_at: string;
          created_at: string;
          id: string;
          latitude: number;
          longitude: number;
          repair_request_id: string;
        };
        Insert: {
          accuracy?: number | null;
          captured_at?: string;
          created_at?: string;
          id?: string;
          latitude: number;
          longitude: number;
          repair_request_id: string;
        };
        Update: {
          accuracy?: number | null;
          captured_at?: string;
          created_at?: string;
          id?: string;
          latitude?: number;
          longitude?: number;
          repair_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repair_dispatch_locations_repair_request_id_fkey";
            columns: ["repair_request_id"];
            isOneToOne: true;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_requests: {
        Row: {
          assessment: Json;
          cancellation_admin_response: string | null;
          cancellation_note: string | null;
          cancellation_previous_status: Database["public"]["Enums"]["repair_status"] | null;
          cancellation_reason: string | null;
          cancellation_requested_at: string | null;
          cancellation_requested_by: string | null;
          clarification_note: string | null;
          completion_details: Json | null;
          created_at: string;
          declined_by: string[];
          description: string;
          equipment_id: string;
          farmer_id: string;
          id: string;
          is_testing: boolean;
          job_number: string;
          location: string;
          parts_hold: Json | null;
          photos: string[];
          status: Database["public"]["Enums"]["repair_status"];
          status_since: string;
          symptoms: string[];
          technician_id: string | null;
          updated_at: string;
          verified_at: string | null;
          facility_id: string | null;
          load_test_passed: boolean | null;
          load_test_notes: string | null;
          load_tested_at: string | null;
          load_tested_by: string | null;
          payment_cleared_at: string | null;
          payment_cleared_by: string | null;
          payment_method: string | null;
          payment_reference: string | null;
          handover_status: "PENDING" | "AUTHORIZED" | "RELEASED";
          handover_authorized_at: string | null;
          handover_authorized_by: string | null;
          handover_released_at: string | null;
          handover_released_by: string | null;
          handover_notes: string | null;
          farmer_collection_confirmed: boolean;
          farmer_collection_confirmed_at: string | null;
          delivery_mode: "DOORSTEP" | "WORKSHOP_DROPOFF";
          is_immobile: boolean;
          drop_off_receipt_number: string | null;
          dropped_off_at: string | null;
          dropped_off_by: string | null;
        };
        Insert: {
          assessment?: Json;
          cancellation_admin_response?: string | null;
          cancellation_note?: string | null;
          cancellation_previous_status?: Database["public"]["Enums"]["repair_status"] | null;
          cancellation_reason?: string | null;
          cancellation_requested_at?: string | null;
          cancellation_requested_by?: string | null;
          clarification_note?: string | null;
          completion_details?: Json | null;
          created_at?: string;
          declined_by?: string[];
          description?: string;
          equipment_id: string;
          farmer_id: string;
          id?: string;
          is_testing?: boolean;
          job_number: string;
          location: string;
          parts_hold?: Json | null;
          photos?: string[];
          status?: Database["public"]["Enums"]["repair_status"];
          status_since?: string;
          symptoms?: string[];
          technician_id?: string | null;
          updated_at?: string;
          verified_at?: string | null;
          facility_id?: string | null;
          load_test_passed?: boolean | null;
          load_test_notes?: string | null;
          load_tested_at?: string | null;
          load_tested_by?: string | null;
          payment_cleared_at?: string | null;
          payment_cleared_by?: string | null;
          payment_method?: string | null;
          payment_reference?: string | null;
          handover_status?: "PENDING" | "AUTHORIZED" | "RELEASED";
          handover_authorized_at?: string | null;
          handover_authorized_by?: string | null;
          handover_released_at?: string | null;
          handover_released_by?: string | null;
          handover_notes?: string | null;
          farmer_collection_confirmed?: boolean;
          farmer_collection_confirmed_at?: string | null;
          delivery_mode?: "DOORSTEP" | "WORKSHOP_DROPOFF";
          is_immobile?: boolean;
          drop_off_receipt_number?: string | null;
          dropped_off_at?: string | null;
          dropped_off_by?: string | null;
        };
        Update: {
          assessment?: Json;
          cancellation_admin_response?: string | null;
          cancellation_note?: string | null;
          cancellation_previous_status?: Database["public"]["Enums"]["repair_status"] | null;
          cancellation_reason?: string | null;
          cancellation_requested_at?: string | null;
          cancellation_requested_by?: string | null;
          clarification_note?: string | null;
          completion_details?: Json | null;
          created_at?: string;
          declined_by?: string[];
          description?: string;
          equipment_id?: string;
          farmer_id?: string;
          id?: string;
          is_testing?: boolean;
          job_number?: string;
          location?: string;
          parts_hold?: Json | null;
          photos?: string[];
          status?: Database["public"]["Enums"]["repair_status"];
          status_since?: string;
          symptoms?: string[];
          technician_id?: string | null;
          updated_at?: string;
          verified_at?: string | null;
          facility_id?: string | null;
          load_test_passed?: boolean | null;
          load_test_notes?: string | null;
          load_tested_at?: string | null;
          load_tested_by?: string | null;
          payment_cleared_at?: string | null;
          payment_cleared_by?: string | null;
          payment_method?: string | null;
          payment_reference?: string | null;
          handover_status?: "PENDING" | "AUTHORIZED" | "RELEASED";
          handover_authorized_at?: string | null;
          handover_authorized_by?: string | null;
          handover_released_at?: string | null;
          handover_released_by?: string | null;
          handover_notes?: string | null;
          farmer_collection_confirmed?: boolean;
          farmer_collection_confirmed_at?: string | null;
          delivery_mode?: "DOORSTEP" | "WORKSHOP_DROPOFF";
          is_immobile?: boolean;
          drop_off_receipt_number?: string | null;
          dropped_off_at?: string | null;
          dropped_off_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "repair_requests_equipment_id_fkey";
            columns: ["equipment_id"];
            isOneToOne: false;
            referencedRelation: "equipment";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_requests_farmer_id_fkey";
            columns: ["farmer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_requests_technician_id_fkey";
            columns: ["technician_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_timeline: {
        Row: {
          created_at: string;
          created_by_id: string | null;
          created_by_role: string;
          id: string;
          note: string | null;
          repair_request_id: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          created_by_id?: string | null;
          created_by_role: string;
          id?: string;
          note?: string | null;
          repair_request_id: string;
          status: string;
        };
        Update: {
          created_at?: string;
          created_by_id?: string | null;
          created_by_role?: string;
          id?: string;
          note?: string | null;
          repair_request_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repair_timeline_created_by_id_fkey";
            columns: ["created_by_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_timeline_repair_request_id_fkey";
            columns: ["repair_request_id"];
            isOneToOne: false;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      service_history: {
        Row: {
          created_at: string;
          demo_code: string | null;
          downtime_hours: number;
          equipment_id: string;
          id: string;
          invoice_reference: string;
          issue_description: string;
          labour_cost: number;
          maintenance_advice: string | null;
          operating_hours: number;
          parts_replaced: string[];
          repair_request_id: string | null;
          service_date: string;
          service_type: string;
          technician_name: string;
          technician_notes: string | null;
          total_cost: number;
          workshop_name: string;
        };
        Insert: {
          created_at?: string;
          demo_code?: string | null;
          downtime_hours?: number;
          equipment_id: string;
          id?: string;
          invoice_reference: string;
          issue_description: string;
          labour_cost?: number;
          maintenance_advice?: string | null;
          operating_hours?: number;
          parts_replaced?: string[];
          repair_request_id?: string | null;
          service_date?: string;
          service_type: string;
          technician_name: string;
          technician_notes?: string | null;
          total_cost?: number;
          workshop_name: string;
        };
        Update: {
          created_at?: string;
          demo_code?: string | null;
          downtime_hours?: number;
          equipment_id?: string;
          id?: string;
          invoice_reference?: string;
          issue_description?: string;
          labour_cost?: number;
          maintenance_advice?: string | null;
          operating_hours?: number;
          parts_replaced?: string[];
          repair_request_id?: string | null;
          service_date?: string;
          service_type?: string;
          technician_name?: string;
          technician_notes?: string | null;
          total_cost?: number;
          workshop_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_history_equipment_id_fkey";
            columns: ["equipment_id"];
            isOneToOne: false;
            referencedRelation: "equipment";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_history_repair_request_id_fkey";
            columns: ["repair_request_id"];
            isOneToOne: false;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      technician_profiles: {
        Row: {
          brands: string[];
          created_at: string;
          distance_km: number;
          eta_minutes: number;
          id: string;
          is_available: boolean;
          is_verified: boolean;
          jobs_completed: number;
          phone: string | null;
          profile_id: string;
          rating: number | null;
          skills: string[];
          updated_at: string;
          workshop_name: string;
          kyc_verified: boolean;
          kyc_verified_at: string | null;
          kyc_verified_by: string | null;
          kyc_document_type: string | null;
          kyc_masked_id: string | null;
          kyc_remarks: string | null;
          ai_suggested_skills: Json | null;
          verified_skills: Json | null;
          review_count: number | null;
          primary_facility_id: string | null;
        };
        Insert: {
          brands?: string[];
          created_at?: string;
          distance_km?: number;
          eta_minutes?: number;
          id?: string;
          is_available?: boolean;
          is_verified?: boolean;
          jobs_completed?: number;
          phone?: string | null;
          profile_id: string;
          rating?: number | null;
          skills?: string[];
          updated_at?: string;
          workshop_name: string;
          kyc_verified?: boolean;
          kyc_verified_at?: string | null;
          kyc_verified_by?: string | null;
          kyc_document_type?: string | null;
          kyc_masked_id?: string | null;
          kyc_remarks?: string | null;
          ai_suggested_skills?: Json | null;
          verified_skills?: Json | null;
          review_count?: number | null;
          primary_facility_id?: string | null;
        };
        Update: {
          brands?: string[];
          created_at?: string;
          distance_km?: number;
          eta_minutes?: number;
          id?: string;
          is_available?: boolean;
          is_verified?: boolean;
          jobs_completed?: number;
          phone?: string | null;
          profile_id?: string;
          rating?: number | null;
          skills?: string[];
          updated_at?: string;
          workshop_name?: string;
          kyc_verified?: boolean;
          kyc_verified_at?: string | null;
          kyc_verified_by?: string | null;
          kyc_document_type?: string | null;
          kyc_masked_id?: string | null;
          kyc_remarks?: string | null;
          ai_suggested_skills?: Json | null;
          verified_skills?: Json | null;
          review_count?: number | null;
          primary_facility_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "technician_profiles_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_facilities: {
        Row: {
          id: string;
          name: string;
          owner_profile_id: string;
          phone: string;
          email: string | null;
          address: string;
          village: string;
          tahsil: string;
          latitude: number;
          longitude: number;
          max_equipment_capacity: number;
          drop_off_approved: boolean;
          drop_off_approved_at: string | null;
          drop_off_approved_by: string | null;
          is_active: boolean;
          operating_hours: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_profile_id: string;
          phone: string;
          email?: string | null;
          address: string;
          village: string;
          tahsil: string;
          latitude: number;
          longitude: number;
          max_equipment_capacity?: number;
          drop_off_approved?: boolean;
          drop_off_approved_at?: string | null;
          drop_off_approved_by?: string | null;
          is_active?: boolean;
          operating_hours?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          owner_profile_id?: string;
          phone?: string;
          email?: string | null;
          address?: string;
          village?: string;
          tahsil?: string;
          latitude?: number;
          longitude?: number;
          max_equipment_capacity?: number;
          drop_off_approved?: boolean;
          drop_off_approved_at?: string | null;
          drop_off_approved_by?: string | null;
          is_active?: boolean;
          operating_hours?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repair_facilities_owner_profile_id_fkey";
            columns: ["owner_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      facility_memberships: {
        Row: {
          id: string;
          facility_id: string;
          technician_profile_id: string;
          role: "OWNER" | "MANAGER" | "TECHNICIAN";
          status: "ACTIVE" | "INVITED" | "SUSPENDED" | "RESIGNED";
          joined_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          facility_id: string;
          technician_profile_id: string;
          role?: "OWNER" | "MANAGER" | "TECHNICIAN";
          status?: "ACTIVE" | "INVITED" | "SUSPENDED" | "RESIGNED";
          joined_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          facility_id?: string;
          technician_profile_id?: string;
          role?: "OWNER" | "MANAGER" | "TECHNICIAN";
          status?: "ACTIVE" | "INVITED" | "SUSPENDED" | "RESIGNED";
          joined_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "facility_memberships_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "repair_facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "facility_memberships_technician_profile_id_fkey";
            columns: ["technician_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      facility_bay_reservations: {
        Row: {
          id: string;
          facility_id: string;
          repair_request_id: string;
          farmer_profile_id: string;
          status: "RESERVED" | "CLAIMED" | "EXPIRED" | "RELEASED" | "CANCELLED";
          reserved_at: string;
          expires_at: string;
          renewal_count: number;
          renewed_at: string | null;
          renewed_by: string | null;
          renewal_notes: string | null;
          claimed_at: string | null;
          released_at: string | null;
          priority_original_reserved_at: string;
          notes?: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          facility_id: string;
          repair_request_id: string;
          farmer_profile_id: string;
          status?: "RESERVED" | "CLAIMED" | "EXPIRED" | "RELEASED" | "CANCELLED";
          reserved_at?: string;
          expires_at: string;
          renewal_count?: number;
          renewed_at?: string | null;
          renewed_by?: string | null;
          renewal_notes?: string | null;
          claimed_at?: string | null;
          released_at?: string | null;
          priority_original_reserved_at?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          facility_id?: string;
          repair_request_id?: string;
          farmer_profile_id?: string;
          status?: "RESERVED" | "CLAIMED" | "EXPIRED" | "RELEASED" | "CANCELLED";
          reserved_at?: string;
          expires_at?: string;
          renewal_count?: number;
          renewed_at?: string | null;
          renewed_by?: string | null;
          renewal_notes?: string | null;
          claimed_at?: string | null;
          released_at?: string | null;
          priority_original_reserved_at?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "facility_bay_reservations_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "repair_facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "facility_bay_reservations_farmer_profile_id_fkey";
            columns: ["farmer_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "facility_bay_reservations_repair_request_id_fkey";
            columns: ["repair_request_id"];
            isOneToOne: false;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      technician_reviews: {
        Row: {
          id: string;
          repair_id: string;
          service_history_id: string;
          farmer_profile_id: string;
          technician_profile_id: string;
          facility_id: string | null;
          rating: number;
          comment: string | null;
          timeliness_rating: number | null;
          quality_rating: number | null;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          repair_id: string;
          service_history_id: string;
          farmer_profile_id: string;
          technician_profile_id: string;
          facility_id?: string | null;
          rating: number;
          comment?: string | null;
          timeliness_rating?: number | null;
          quality_rating?: number | null;
          is_published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          repair_id?: string;
          service_history_id?: string;
          farmer_profile_id?: string;
          technician_profile_id?: string;
          facility_id?: string | null;
          rating?: number;
          comment?: string | null;
          timeliness_rating?: number | null;
          quality_rating?: number | null;
          is_published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "technician_reviews_repair_id_fkey";
            columns: ["repair_id"];
            isOneToOne: true;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_reviews_service_history_id_fkey";
            columns: ["service_history_id"];
            isOneToOne: false;
            referencedRelation: "service_history";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_reviews_farmer_profile_id_fkey";
            columns: ["farmer_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_reviews_technician_profile_id_fkey";
            columns: ["technician_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_reviews_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "repair_facilities";
            referencedColumns: ["id"];
          },
        ];
      };
      service_centre_parts: {
        Row: {
          category: string;
          compatible_models: string[];
          created_at: string;
          id: string;
          location: string | null;
          name: string;
          part_number: string;
          service_centre_id: string | null;
          spec: string | null;
          stock_quantity: number;
          unit_price: number;
          updated_at: string;
        };
        Insert: {
          category?: string;
          compatible_models?: string[];
          created_at?: string;
          id?: string;
          location?: string | null;
          name: string;
          part_number: string;
          service_centre_id?: string | null;
          spec?: string | null;
          stock_quantity?: number;
          unit_price?: number;
          updated_at?: string;
        };
        Update: {
          category?: string;
          compatible_models?: string[];
          created_at?: string;
          id?: string;
          location?: string | null;
          name?: string;
          part_number?: string;
          service_centre_id?: string | null;
          spec?: string | null;
          stock_quantity?: number;
          unit_price?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      service_centre_part_requests: {
        Row: {
          created_at: string;
          estimated_arrival_at: string | null;
          eta_updated_by: string | null;
          eta_updated_at: string | null;
          handed_off_at: string | null;
          handed_off_by: string | null;
          id: string;
          notes: string | null;
          part_id: string;
          quantity: number;
          repair_request_id: string;
          requested_by: string;
          status: "PENDING" | "HANDED_OFF" | "CANCELLED";
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          estimated_arrival_at?: string | null;
          eta_updated_by?: string | null;
          eta_updated_at?: string | null;
          handed_off_at?: string | null;
          handed_off_by?: string | null;
          id?: string;
          notes?: string | null;
          part_id: string;
          quantity?: number;
          repair_request_id: string;
          requested_by: string;
          status?: "PENDING" | "HANDED_OFF" | "CANCELLED";
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          estimated_arrival_at?: string | null;
          eta_updated_by?: string | null;
          eta_updated_at?: string | null;
          handed_off_at?: string | null;
          handed_off_by?: string | null;
          id?: string;
          notes?: string | null;
          part_id?: string;
          quantity?: number;
          repair_request_id?: string;
          requested_by?: string;
          status?: "PENDING" | "HANDED_OFF" | "CANCELLED";
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_centre_part_requests_part_id_fkey";
            columns: ["part_id"];
            isOneToOne: false;
            referencedRelation: "service_centre_parts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_centre_part_requests_repair_request_id_fkey";
            columns: ["repair_request_id"];
            isOneToOne: false;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_centre_part_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_centre_part_requests_handed_off_by_fkey";
            columns: ["handed_off_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      service_centre_stock_audit: {
        Row: {
          change_quantity: number;
          changed_by: string;
          created_at: string;
          id: string;
          movement_type: "RECEIVED" | "ISSUED_TO_REPAIR" | "RETURNED" | "ADJUSTMENT";
          new_stock: number;
          notes: string | null;
          part_id: string;
          part_request_id: string | null;
          previous_stock: number;
          quote_id: string | null;
          quote_item_id: string | null;
          reason: string;
          repair_request_id: string | null;
          total_value: number | null;
          unit_price: number | null;
        };
        Insert: {
          change_quantity: number;
          changed_by: string;
          created_at?: string;
          id?: string;
          movement_type?: "RECEIVED" | "ISSUED_TO_REPAIR" | "RETURNED" | "ADJUSTMENT";
          new_stock: number;
          notes?: string | null;
          part_id: string;
          part_request_id?: string | null;
          previous_stock: number;
          quote_id?: string | null;
          quote_item_id?: string | null;
          reason: string;
          repair_request_id?: string | null;
          total_value?: number | null;
          unit_price?: number | null;
        };
        Update: {
          change_quantity?: number;
          changed_by?: string;
          created_at?: string;
          id?: string;
          movement_type?: "RECEIVED" | "ISSUED_TO_REPAIR" | "RETURNED" | "ADJUSTMENT";
          new_stock?: number;
          notes?: string | null;
          part_id?: string;
          part_request_id?: string | null;
          previous_stock?: number;
          quote_id?: string | null;
          quote_item_id?: string | null;
          reason?: string;
          repair_request_id?: string | null;
          total_value?: number | null;
          unit_price?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "service_centre_stock_audit_part_id_fkey";
            columns: ["part_id"];
            isOneToOne: false;
            referencedRelation: "service_centre_parts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_centre_stock_audit_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      service_centre_part_sales: {
        Row: {
          created_at: string;
          id: string;
          movement_audit_id: string | null;
          notes: string | null;
          part_id: string;
          part_request_id: string | null;
          quantity: number;
          quote_id: string;
          quote_item_id: string | null;
          recorded_by: string;
          repair_request_id: string;
          sold_at: string;
          total_amount: number;
          unit_price: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          movement_audit_id?: string | null;
          notes?: string | null;
          part_id: string;
          part_request_id?: string | null;
          quantity: number;
          quote_id: string;
          quote_item_id?: string | null;
          recorded_by: string;
          repair_request_id: string;
          sold_at?: string;
          total_amount: number;
          unit_price: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          movement_audit_id?: string | null;
          notes?: string | null;
          part_id?: string;
          part_request_id?: string | null;
          quantity?: number;
          quote_id?: string;
          quote_item_id?: string | null;
          recorded_by?: string;
          repair_request_id?: string;
          sold_at?: string;
          total_amount?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "service_centre_part_sales_part_id_fkey";
            columns: ["part_id"];
            isOneToOne: false;
            referencedRelation: "service_centre_parts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_centre_part_sales_repair_request_id_fkey";
            columns: ["repair_request_id"];
            isOneToOne: false;
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_centre_part_sales_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_centre_part_sales_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      check_table_rls: {
        Args: never;
        Returns: {
          policy_count: number;
          rls_enabled: boolean;
          table_name: string;
        }[];
      };
      current_clerk_id: { Args: never; Returns: string };
      current_profile_id: { Args: never; Returns: string };
      current_user_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      get_session_profile: {
        Args: Record<PropertyKey, never>;
        Returns: {
          created_at: string;
          full_name: string;
          id: string;
          is_verified: boolean;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
          village: string | null;
        }[];
      };
      admin_provision_staff: {
        Args: {
          p_email: string;
          p_full_name: string;
          p_phone?: string | null;
          p_role: Database["public"]["Enums"]["user_role"];
          p_village?: string | null;
          p_workshop_name?: string | null;
        };
        Returns: string;
      };
      delete_user_account: {
        Args: never;
        Returns: Json;
      };
      get_storage_buckets: {
        Args: never;
        Returns: {
          file_size_limit: number;
          id: string;
          name: string;
          public: boolean;
        }[];
      };
      reset_demo_data: {
        Args: never;
        Returns: Json;
      };
      confirm_service_centre_part_handoff: {
        Args: {
          p_request_id: string;
        };
        Returns: Json;
      };
      receive_service_centre_stock: {
        Args: {
          p_part_id: string;
          p_quantity: number;
          p_reason: string;
        };
        Returns: Json;
      };
      return_service_centre_part: {
        Args: {
          p_repair_request_id: string;
          p_part_id: string;
          p_quantity: number;
          p_reason: string;
        };
        Returns: Json;
      };
      adjust_service_centre_part_stock: {
        Args: {
          p_part_id: string;
          p_change_quantity: number;
          p_reason: string;
        };
        Returns: Json;
      };
      request_service_centre_part: {
        Args: {
          p_repair_request_id: string;
          p_part_id: string;
          p_quantity?: number;
          p_notes?: string;
        };
        Returns: Json;
      };
      update_service_centre_part_request_eta: {
        Args: {
          p_request_id: string;
          p_estimated_arrival_at: string | null;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      create_quote_atomic: {
        Args: {
          p_repair_request_id: string;
          p_labour_description: string;
          p_labour_amount: number;
          p_tax_percent: number;
          p_estimated_completion: string;
          p_warranty_terms?: string | null;
          p_items: Json;
        };
        Returns: Json;
      };
      revise_quote_atomic: {
        Args: {
          p_previous_quote_id: string;
          p_repair_request_id: string;
          p_labour_description: string;
          p_labour_amount: number;
          p_tax_percent: number;
          p_estimated_completion: string;
          p_warranty_terms?: string | null;
          p_technician_explanation?: string | null;
          p_items: Json;
        };
        Returns: Json;
      };
      claim_repair_visual_diagnostic: {
        Args: {
          p_repair_request_id: string;
          p_force_rescan?: boolean;
        };
        Returns: Json;
      };
      save_repair_visual_diagnostic: {
        Args: {
          p_repair_request_id: string;
          p_claim_token: string;
          p_executed_by_profile_id: string;
          p_diagnostic_payload: Json;
        };
        Returns: Json;
      };
      finalize_repair_visual_diagnostic_failure: {
        Args: {
          p_repair_request_id: string;
          p_claim_token: string;
          p_error_code: string;
          p_error_message: string;
          p_is_terminal: boolean;
        };
        Returns: Json;
      };
      revoke_repair_visual_consent: {
        Args: {
          p_repair_request_id: string;
        };
        Returns: Json;
      };
      grant_repair_visual_consent: {
        Args: {
          p_repair_request_id: string;
        };
        Returns: Json;
      };
      admin_repair_corrupted_diagnostic: {
        Args: {
          p_repair_request_id: string;
          p_target_status?: string;
        };
        Returns: Json;
      };
      admin_set_technician_verification: {
        Args: {
          p_technician_profile_id: string;
          p_is_verified: boolean;
        };
        Returns: Json;
      };
      get_technician_workshop_profile: {
        Args: {
          p_profile_id?: string | null;
        };
        Returns: Json;
      };
      get_technician_private_profile: {
        Args: {
          p_technician_profile_id: string;
        };
        Returns: Json;
      };
      verify_technician_kyc: {
        Args: {
          p_technician_profile_id: string;
          p_document_type: string;
          p_masked_id: string;
          p_remarks: string;
        };
        Returns: Json;
      };
      approve_technician_skill: {
        Args: {
          p_technician_profile_id: string;
          p_skill: string;
        };
        Returns: Json;
      };
      dismiss_technician_skill: {
        Args: {
          p_technician_profile_id: string;
          p_skill: string;
        };
        Returns: Json;
      };
      transfer_facility_ownership: {
        Args: {
          p_facility_id: string;
          p_new_owner_profile_id: string;
        };
        Returns: Json;
      };
      invite_technician_to_facility: {
        Args: {
          p_facility_id: string;
          p_technician_phone: string;
          p_role: string;
        };
        Returns: Json;
      };
      accept_facility_invitation: {
        Args: {
          p_membership_id: string;
        };
        Returns: Json;
      };
      reject_facility_invitation: {
        Args: {
          p_membership_id: string;
        };
        Returns: Json;
      };
      revoke_facility_invitation: {
        Args: {
          p_membership_id: string;
        };
        Returns: Json;
      };
      remove_facility_member: {
        Args: {
          p_facility_id: string;
          p_technician_profile_id: string;
        };
        Returns: Json;
      };
      get_facility_management_profile: {
        Args: {
          p_facility_id: string;
        };
        Returns: Json;
      };
      get_facility_handover_location: {
        Args: {
          p_repair_request_id: string;
        };
        Returns: Json;
      };
      record_load_test_signoff: {
        Args: {
          p_repair_request_id: string;
          p_passed: boolean;
          p_notes: string;
        };
        Returns: Json;
      };
      record_offline_payment_clearance: {
        Args: {
          p_repair_request_id: string;
          p_payment_method: string;
          p_payment_reference: string;
        };
        Returns: Json;
      };
      authorize_equipment_handover: {
        Args: {
          p_repair_request_id: string;
          p_authorization_notes: string;
        };
        Returns: Json;
      };
      execute_equipment_handover_release: {
        Args: {
          p_repair_request_id: string;
          p_release_notes: string;
        };
        Returns: Json;
      };
      confirm_farmer_equipment_collection: {
        Args: {
          p_repair_request_id: string;
        };
        Returns: Json;
      };
      get_facility_capacity_breakdown: {
        Args: {
          p_facility_id: string;
        };
        Returns: Json;
      };
      reserve_workshop_bay: {
        Args: {
          p_repair_request_id: string;
          p_facility_id: string;
          p_expiry_interval?: string;
        };
        Returns: Json;
      };
      renew_workshop_bay_reservation: {
        Args: {
          p_reservation_id: string;
          p_extension_interval?: string;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      release_workshop_bay_reservation: {
        Args: {
          p_repair_request_id: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      execute_workshop_dropoff_checkin: {
        Args: {
          p_repair_request_id: string;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      release_cancelled_workshop_equipment: {
        Args: {
          p_repair_request_id: string;
          p_notes?: string | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      equipment_status: "Operational" | "In Repair" | "Needs Attention";
      equipment_type: "Tractor" | "Harvester" | "Power Tiller" | "Pump" | "Sprayer";
      quote_status: "PENDING" | "APPROVED" | "REVISED" | "REJECTED";
      repair_status:
        | "REQUESTED"
        | "ACCEPTED"
        | "QUOTE_PENDING"
        | "QUOTE_REVISED"
        | "IN_PROGRESS"
        | "WAITING_FOR_PARTS"
        | "COMPLETED"
        | "CANCELLATION_REQUESTED"
        | "CANCELLED";
      user_role: "farmer" | "technician" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      equipment_status: ["Operational", "In Repair", "Needs Attention"],
      equipment_type: ["Tractor", "Harvester", "Power Tiller", "Pump", "Sprayer"],
      quote_status: ["PENDING", "APPROVED", "REVISED", "REJECTED"],
      repair_status: [
        "REQUESTED",
        "ACCEPTED",
        "QUOTE_PENDING",
        "QUOTE_REVISED",
        "IN_PROGRESS",
        "WAITING_FOR_PARTS",
        "COMPLETED",
        "CANCELLATION_REQUESTED",
        "CANCELLED",
      ],
      user_role: ["farmer", "technician", "admin"],
    },
  },
} as const;
