export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = "farmer" | "technician" | "admin";
export type EquipmentType = "Tractor" | "Harvester" | "Power Tiller" | "Pump" | "Sprayer";
export type EquipmentStatus = "Operational" | "In Repair" | "Needs Attention";
export type RepairStatus =
  | "REQUESTED"
  | "ACCEPTED"
  | "QUOTE_PENDING"
  | "QUOTE_REVISED"
  | "IN_PROGRESS"
  | "WAITING_FOR_PARTS"
  | "COMPLETED"
  | "CANCELLED";
export type QuoteStatus = "PENDING" | "APPROVED" | "REVISED" | "REJECTED";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          auth_user_id: string | null;
          role: UserRole;
          full_name: string;
          phone: string | null;
          village: string | null;
          demo_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id?: string | null;
          role?: UserRole;
          full_name: string;
          phone?: string | null;
          village?: string | null;
          demo_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string | null;
          role?: UserRole;
          full_name?: string;
          phone?: string | null;
          village?: string | null;
          demo_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      technician_profiles: {
        Row: {
          id: string;
          profile_id: string;
          workshop_name: string;
          brands: string[];
          skills: string[];
          is_verified: boolean;
          distance_km: number;
          eta_minutes: number;
          is_available: boolean;
          rating: number;
          jobs_completed: number;
          phone: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          workshop_name: string;
          brands?: string[];
          skills?: string[];
          is_verified?: boolean;
          distance_km?: number;
          eta_minutes?: number;
          is_available?: boolean;
          rating?: number;
          jobs_completed?: number;
          phone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          workshop_name?: string;
          brands?: string[];
          skills?: string[];
          is_verified?: boolean;
          distance_km?: number;
          eta_minutes?: number;
          is_available?: boolean;
          rating?: number;
          jobs_completed?: number;
          phone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "technician_profiles_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      equipment: {
        Row: {
          id: string;
          farmer_id: string;
          type: EquipmentType;
          make: string;
          model: string;
          year: number | null;
          serial_number: string;
          operating_hours: number;
          photo_url: string | null;
          status: EquipmentStatus;
          demo_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          farmer_id: string;
          type: EquipmentType;
          make: string;
          model: string;
          year?: number | null;
          serial_number: string;
          operating_hours?: number;
          photo_url?: string | null;
          status?: EquipmentStatus;
          demo_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          farmer_id?: string;
          type?: EquipmentType;
          make?: string;
          model?: string;
          year?: number | null;
          serial_number?: string;
          operating_hours?: number;
          photo_url?: string | null;
          status?: EquipmentStatus;
          demo_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "equipment_farmer_id_fkey";
            columns: ["farmer_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_requests: {
        Row: {
          id: string;
          job_number: string;
          equipment_id: string;
          farmer_id: string;
          technician_id: string | null;
          status: RepairStatus;
          is_testing: boolean;
          symptoms: string[];
          description: string;
          photos: string[];
          location: string;
          assessment: Json;
          status_since: string;
          declined_by: string[];
          clarification_note: string | null;
          parts_hold: Json | null;
          completion_details: Json | null;
          verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          job_number: string;
          equipment_id: string;
          farmer_id: string;
          technician_id?: string | null;
          status?: RepairStatus;
          is_testing?: boolean;
          symptoms?: string[];
          description?: string;
          photos?: string[];
          location: string;
          assessment?: Json;
          status_since?: string;
          declined_by?: string[];
          clarification_note?: string | null;
          parts_hold?: Json | null;
          completion_details?: Json | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          job_number?: string;
          equipment_id?: string;
          farmer_id?: string;
          technician_id?: string | null;
          status?: RepairStatus;
          is_testing?: boolean;
          symptoms?: string[];
          description?: string;
          photos?: string[];
          location?: string;
          assessment?: Json;
          status_since?: string;
          declined_by?: string[];
          clarification_note?: string | null;
          parts_hold?: Json | null;
          completion_details?: Json | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repair_requests_equipment_id_fkey";
            columns: ["equipment_id"];
            referencedRelation: "equipment";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_requests_farmer_id_fkey";
            columns: ["farmer_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_requests_technician_id_fkey";
            columns: ["technician_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: {
          id: string;
          repair_request_id: string;
          technician_id: string;
          labour_description: string;
          labour_amount: number;
          tax_percent: number;
          estimated_completion: string;
          warranty_terms: string | null;
          version: number;
          status: QuoteStatus;
          sent_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          repair_request_id: string;
          technician_id: string;
          labour_description: string;
          labour_amount?: number;
          tax_percent?: number;
          estimated_completion: string;
          warranty_terms?: string | null;
          version?: number;
          status?: QuoteStatus;
          sent_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          repair_request_id?: string;
          technician_id?: string;
          labour_description?: string;
          labour_amount?: number;
          tax_percent?: number;
          estimated_completion?: string;
          warranty_terms?: string | null;
          version?: number;
          status?: QuoteStatus;
          sent_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_repair_request_id_fkey";
            columns: ["repair_request_id"];
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_technician_id_fkey";
            columns: ["technician_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_items: {
        Row: {
          id: string;
          quote_id: string;
          part_name: string;
          part_spec: string | null;
          quantity: number;
          unit_price: number;
          part_source: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          quote_id: string;
          part_name: string;
          part_spec?: string | null;
          quantity?: number;
          unit_price?: number;
          part_source?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          quote_id?: string;
          part_name?: string;
          part_spec?: string | null;
          quantity?: number;
          unit_price?: number;
          part_source?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey";
            columns: ["quote_id"];
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
        ];
      };
      service_history: {
        Row: {
          id: string;
          equipment_id: string;
          repair_request_id: string | null;
          service_date: string;
          operating_hours: number;
          service_type: string;
          issue_description: string;
          parts_replaced: string[];
          labour_cost: number;
          total_cost: number;
          technician_name: string;
          workshop_name: string;
          technician_notes: string | null;
          maintenance_advice: string | null;
          downtime_hours: number;
          invoice_reference: string;
          demo_code: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          equipment_id: string;
          repair_request_id?: string | null;
          service_date?: string;
          operating_hours?: number;
          service_type: string;
          issue_description: string;
          parts_replaced?: string[];
          labour_cost?: number;
          total_cost?: number;
          technician_name: string;
          workshop_name: string;
          technician_notes?: string | null;
          maintenance_advice?: string | null;
          downtime_hours?: number;
          invoice_reference: string;
          demo_code?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          equipment_id?: string;
          repair_request_id?: string | null;
          service_date?: string;
          operating_hours?: number;
          service_type?: string;
          issue_description?: string;
          parts_replaced?: string[];
          labour_cost?: number;
          total_cost?: number;
          technician_name?: string;
          workshop_name?: string;
          technician_notes?: string | null;
          maintenance_advice?: string | null;
          downtime_hours?: number;
          invoice_reference?: string;
          demo_code?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_history_equipment_id_fkey";
            columns: ["equipment_id"];
            referencedRelation: "equipment";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_history_repair_request_id_fkey";
            columns: ["repair_request_id"];
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_timeline: {
        Row: {
          id: string;
          repair_request_id: string;
          status: string;
          note: string | null;
          created_by_role: string;
          created_by_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          repair_request_id: string;
          status: string;
          note?: string | null;
          created_by_role: string;
          created_by_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          repair_request_id?: string;
          status?: string;
          note?: string | null;
          created_by_role?: string;
          created_by_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repair_timeline_created_by_id_fkey";
            columns: ["created_by_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_timeline_repair_request_id_fkey";
            columns: ["repair_request_id"];
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_notes: {
        Row: {
          id: string;
          repair_request_id: string;
          author_id: string;
          note_text: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          repair_request_id: string;
          author_id: string;
          note_text: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          repair_request_id?: string;
          author_id?: string;
          note_text?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repair_notes_author_id_fkey";
            columns: ["author_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_notes_repair_request_id_fkey";
            columns: ["repair_request_id"];
            referencedRelation: "repair_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          recipient_role: UserRole;
          recipient_user_id: string | null;
          notification_text: string;
          link_target: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          recipient_role: UserRole;
          recipient_user_id?: string | null;
          notification_text: string;
          link_target?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          recipient_role?: UserRole;
          recipient_user_id?: string | null;
          notification_text?: string;
          link_target?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_user_id_fkey";
            columns: ["recipient_user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_profile_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: UserRole;
      };
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_technician: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_farmer: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      equipment_type: EquipmentType;
      equipment_status: EquipmentStatus;
      repair_status: RepairStatus;
      quote_status: QuoteStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
