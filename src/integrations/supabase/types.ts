export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      equipment: {
        Row: {
          created_at: string
          demo_code: string | null
          farmer_id: string
          id: string
          make: string
          model: string
          operating_hours: number
          photo_url: string | null
          serial_number: string
          status: Database["public"]["Enums"]["equipment_status"]
          type: Database["public"]["Enums"]["equipment_type"]
          updated_at: string
          year: number | null
        }
        Insert: {
          created_at?: string
          demo_code?: string | null
          farmer_id: string
          id?: string
          make: string
          model: string
          operating_hours?: number
          photo_url?: string | null
          serial_number: string
          status?: Database["public"]["Enums"]["equipment_status"]
          type: Database["public"]["Enums"]["equipment_type"]
          updated_at?: string
          year?: number | null
        }
        Update: {
          created_at?: string
          demo_code?: string | null
          farmer_id?: string
          id?: string
          make?: string
          model?: string
          operating_hours?: number
          photo_url?: string | null
          serial_number?: string
          status?: Database["public"]["Enums"]["equipment_status"]
          type?: Database["public"]["Enums"]["equipment_type"]
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_farmer_id_fkey"
            columns: ["farmer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          link_target: string | null
          notification_text: string
          recipient_role: Database["public"]["Enums"]["user_role"]
          recipient_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          link_target?: string | null
          notification_text: string
          recipient_role: Database["public"]["Enums"]["user_role"]
          recipient_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          link_target?: string | null
          notification_text?: string
          recipient_role?: Database["public"]["Enums"]["user_role"]
          recipient_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string | null
          clerk_user_id: string | null
          created_at: string
          demo_code: string | null
          email: string | null
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          village: string | null
        }
        Insert: {
          auth_user_id?: string | null
          clerk_user_id?: string | null
          created_at?: string
          demo_code?: string | null
          email?: string | null
          full_name: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          village?: string | null
        }
        Update: {
          auth_user_id?: string | null
          clerk_user_id?: string | null
          created_at?: string
          demo_code?: string | null
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          village?: string | null
        }
        Relationships: []
      }
      quote_items: {
        Row: {
          created_at: string
          id: string
          part_name: string
          part_source: string
          part_spec: string | null
          quantity: number
          quote_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          part_name: string
          part_source?: string
          part_spec?: string | null
          quantity?: number
          quote_id: string
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          part_name?: string
          part_source?: string
          part_spec?: string | null
          quantity?: number
          quote_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          estimated_completion: string
          id: string
          labour_amount: number
          labour_description: string
          repair_request_id: string
          sent_at: string
          status: Database["public"]["Enums"]["quote_status"]
          tax_percent: number
          technician_id: string
          updated_at: string
          version: number
          warranty_terms: string | null
        }
        Insert: {
          created_at?: string
          estimated_completion: string
          id?: string
          labour_amount?: number
          labour_description: string
          repair_request_id: string
          sent_at?: string
          status?: Database["public"]["Enums"]["quote_status"]
          tax_percent?: number
          technician_id: string
          updated_at?: string
          version?: number
          warranty_terms?: string | null
        }
        Update: {
          created_at?: string
          estimated_completion?: string
          id?: string
          labour_amount?: number
          labour_description?: string
          repair_request_id?: string
          sent_at?: string
          status?: Database["public"]["Enums"]["quote_status"]
          tax_percent?: number
          technician_id?: string
          updated_at?: string
          version?: number
          warranty_terms?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_repair_request_id_fkey"
            columns: ["repair_request_id"]
            isOneToOne: false
            referencedRelation: "repair_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_messages: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message_text: string
          recipient_id: string
          repair_request_id: string
          sender_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message_text: string
          recipient_id: string
          repair_request_id: string
          sender_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message_text?: string
          recipient_id?: string
          repair_request_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_messages_repair_request_id_fkey"
            columns: ["repair_request_id"]
            isOneToOne: false
            referencedRelation: "repair_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_notes: {
        Row: {
          author_id: string
          created_at: string
          id: string
          note_text: string
          repair_request_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          note_text: string
          repair_request_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          note_text?: string
          repair_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_notes_repair_request_id_fkey"
            columns: ["repair_request_id"]
            isOneToOne: false
            referencedRelation: "repair_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_requests: {
        Row: {
          assessment: Json
          cancellation_admin_response: string | null
          cancellation_note: string | null
          cancellation_previous_status: Database["public"]["Enums"]["repair_status"] | null
          cancellation_reason: string | null
          cancellation_requested_at: string | null
          cancellation_requested_by: string | null
          clarification_note: string | null
          completion_details: Json | null
          created_at: string
          declined_by: string[]
          description: string
          equipment_id: string
          farmer_id: string
          id: string
          is_testing: boolean
          job_number: string
          location: string
          parts_hold: Json | null
          photos: string[]
          status: Database["public"]["Enums"]["repair_status"]
          status_since: string
          symptoms: string[]
          technician_id: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          assessment?: Json
          cancellation_admin_response?: string | null
          cancellation_note?: string | null
          cancellation_previous_status?: Database["public"]["Enums"]["repair_status"] | null
          cancellation_reason?: string | null
          cancellation_requested_at?: string | null
          cancellation_requested_by?: string | null
          clarification_note?: string | null
          completion_details?: Json | null
          created_at?: string
          declined_by?: string[]
          description?: string
          equipment_id: string
          farmer_id: string
          id?: string
          is_testing?: boolean
          job_number: string
          location: string
          parts_hold?: Json | null
          photos?: string[]
          status?: Database["public"]["Enums"]["repair_status"]
          status_since?: string
          symptoms?: string[]
          technician_id?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          assessment?: Json
          cancellation_admin_response?: string | null
          cancellation_note?: string | null
          cancellation_previous_status?: Database["public"]["Enums"]["repair_status"] | null
          cancellation_reason?: string | null
          cancellation_requested_at?: string | null
          cancellation_requested_by?: string | null
          clarification_note?: string | null
          completion_details?: Json | null
          created_at?: string
          declined_by?: string[]
          description?: string
          equipment_id?: string
          farmer_id?: string
          id?: string
          is_testing?: boolean
          job_number?: string
          location?: string
          parts_hold?: Json | null
          photos?: string[]
          status?: Database["public"]["Enums"]["repair_status"]
          status_since?: string
          symptoms?: string[]
          technician_id?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_requests_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_requests_farmer_id_fkey"
            columns: ["farmer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_requests_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_timeline: {
        Row: {
          created_at: string
          created_by_id: string | null
          created_by_role: string
          id: string
          note: string | null
          repair_request_id: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by_id?: string | null
          created_by_role: string
          id?: string
          note?: string | null
          repair_request_id: string
          status: string
        }
        Update: {
          created_at?: string
          created_by_id?: string | null
          created_by_role?: string
          id?: string
          note?: string | null
          repair_request_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_timeline_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_timeline_repair_request_id_fkey"
            columns: ["repair_request_id"]
            isOneToOne: false
            referencedRelation: "repair_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      service_history: {
        Row: {
          created_at: string
          demo_code: string | null
          downtime_hours: number
          equipment_id: string
          id: string
          invoice_reference: string
          issue_description: string
          labour_cost: number
          maintenance_advice: string | null
          operating_hours: number
          parts_replaced: string[]
          repair_request_id: string | null
          service_date: string
          service_type: string
          technician_name: string
          technician_notes: string | null
          total_cost: number
          workshop_name: string
        }
        Insert: {
          created_at?: string
          demo_code?: string | null
          downtime_hours?: number
          equipment_id: string
          id?: string
          invoice_reference: string
          issue_description: string
          labour_cost?: number
          maintenance_advice?: string | null
          operating_hours?: number
          parts_replaced?: string[]
          repair_request_id?: string | null
          service_date?: string
          service_type: string
          technician_name: string
          technician_notes?: string | null
          total_cost?: number
          workshop_name: string
        }
        Update: {
          created_at?: string
          demo_code?: string | null
          downtime_hours?: number
          equipment_id?: string
          id?: string
          invoice_reference?: string
          issue_description?: string
          labour_cost?: number
          maintenance_advice?: string | null
          operating_hours?: number
          parts_replaced?: string[]
          repair_request_id?: string | null
          service_date?: string
          service_type?: string
          technician_name?: string
          technician_notes?: string | null
          total_cost?: number
          workshop_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_history_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_history_repair_request_id_fkey"
            columns: ["repair_request_id"]
            isOneToOne: false
            referencedRelation: "repair_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      technician_profiles: {
        Row: {
          brands: string[]
          created_at: string
          distance_km: number
          eta_minutes: number
          id: string
          is_available: boolean
          is_verified: boolean
          jobs_completed: number
          phone: string | null
          profile_id: string
          rating: number
          skills: string[]
          updated_at: string
          workshop_name: string
        }
        Insert: {
          brands?: string[]
          created_at?: string
          distance_km?: number
          eta_minutes?: number
          id?: string
          is_available?: boolean
          is_verified?: boolean
          jobs_completed?: number
          phone?: string | null
          profile_id: string
          rating?: number
          skills?: string[]
          updated_at?: string
          workshop_name: string
        }
        Update: {
          brands?: string[]
          created_at?: string
          distance_km?: number
          eta_minutes?: number
          id?: string
          is_available?: boolean
          is_verified?: boolean
          jobs_completed?: number
          phone?: string | null
          profile_id?: string
          rating?: number
          skills?: string[]
          updated_at?: string
          workshop_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "technician_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_table_rls: {
        Args: never
        Returns: {
          policy_count: number
          rls_enabled: boolean
          table_name: string
        }[]
      }
      current_clerk_id: { Args: never; Returns: string }
      current_profile_id: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_storage_buckets: {
        Args: never
        Returns: {
          file_size_limit: number
          id: string
          name: string
          public: boolean
        }[]
      }
    }
    Enums: {
      equipment_status: "Operational" | "In Repair" | "Needs Attention"
      equipment_type:
        | "Tractor"
        | "Harvester"
        | "Power Tiller"
        | "Pump"
        | "Sprayer"
      quote_status: "PENDING" | "APPROVED" | "REVISED" | "REJECTED"
      repair_status:
        | "REQUESTED"
        | "ACCEPTED"
        | "QUOTE_PENDING"
        | "QUOTE_REVISED"
        | "IN_PROGRESS"
        | "WAITING_FOR_PARTS"
        | "COMPLETED"
        | "CANCELLATION_REQUESTED"
        | "CANCELLED"
      user_role: "farmer" | "technician" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      equipment_status: ["Operational", "In Repair", "Needs Attention"],
      equipment_type: [
        "Tractor",
        "Harvester",
        "Power Tiller",
        "Pump",
        "Sprayer",
      ],
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
} as const
