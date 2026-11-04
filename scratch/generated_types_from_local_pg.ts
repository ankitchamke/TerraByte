
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "equipment": {
                  Row: {
                    "created_at": string,"demo_code": string | null,"farmer_id": string,"id": string,"make": string,"model": string,"operating_hours": number,"photo_url": string | null,"serial_number": string,"status": Database["public"]['Enums']["equipment_status"],"type": Database["public"]['Enums']["equipment_type"],"updated_at": string,"year": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"demo_code"?: string | null,"farmer_id": string,"id"?: string,"make": string,"model": string,"operating_hours"?: number,"photo_url"?: string | null,"serial_number": string,"status"?: Database["public"]['Enums']["equipment_status"],"type": Database["public"]['Enums']["equipment_type"],"updated_at"?: string,"year"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"demo_code"?: string | null,"farmer_id"?: string,"id"?: string,"make"?: string,"model"?: string,"operating_hours"?: number,"photo_url"?: string | null,"serial_number"?: string,"status"?: Database["public"]['Enums']["equipment_status"],"type"?: Database["public"]['Enums']["equipment_type"],"updated_at"?: string,"year"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "equipment_farmer_id_fkey"
      columns: ["farmer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"id": string,"is_read": boolean,"link_target": string | null,"notification_text": string,"recipient_role": Database["public"]['Enums']["user_role"],"recipient_user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_read"?: boolean,"link_target"?: string | null,"notification_text": string,"recipient_role": Database["public"]['Enums']["user_role"],"recipient_user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_read"?: boolean,"link_target"?: string | null,"notification_text"?: string,"recipient_role"?: Database["public"]['Enums']["user_role"],"recipient_user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_recipient_user_id_fkey"
      columns: ["recipient_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "auth_user_id": string | null,"clerk_user_id": string | null,"created_at": string,"demo_code": string | null,"email": string | null,"full_name": string,"id": string,"phone": string | null,"role": Database["public"]['Enums']["user_role"],"updated_at": string,"village": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_user_id"?: string | null,"clerk_user_id"?: string | null,"created_at"?: string,"demo_code"?: string | null,"email"?: string | null,"full_name": string,"id"?: string,"phone"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string,"village"?: string | null
                  }
                  Update: {
                    "auth_user_id"?: string | null,"clerk_user_id"?: string | null,"created_at"?: string,"demo_code"?: string | null,"email"?: string | null,"full_name"?: string,"id"?: string,"phone"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string,"village"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"quote_items": {
                  Row: {
                    "catalog_part_id": string | null,"created_at": string,"id": string,"part_name": string,"part_source": string,"part_spec": string | null,"quantity": number,"quote_id": string,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "catalog_part_id"?: string | null,"created_at"?: string,"id"?: string,"part_name": string,"part_source"?: string,"part_spec"?: string | null,"quantity"?: number,"quote_id": string,"unit_price"?: number
                  }
                  Update: {
                    "catalog_part_id"?: string | null,"created_at"?: string,"id"?: string,"part_name"?: string,"part_source"?: string,"part_spec"?: string | null,"quantity"?: number,"quote_id"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_items_catalog_part_id_fkey"
      columns: ["catalog_part_id"]
isOneToOne: false
      referencedRelation: "service_centre_parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_items_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "created_at": string,"estimated_completion": string,"id": string,"labour_amount": number,"labour_description": string,"repair_request_id": string,"sent_at": string,"status": Database["public"]['Enums']["quote_status"],"tax_percent": number,"technician_id": string,"updated_at": string,"version": number,"warranty_terms": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"estimated_completion": string,"id"?: string,"labour_amount"?: number,"labour_description": string,"repair_request_id": string,"sent_at"?: string,"status"?: Database["public"]['Enums']["quote_status"],"tax_percent"?: number,"technician_id": string,"updated_at"?: string,"version"?: number,"warranty_terms"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"estimated_completion"?: string,"id"?: string,"labour_amount"?: number,"labour_description"?: string,"repair_request_id"?: string,"sent_at"?: string,"status"?: Database["public"]['Enums']["quote_status"],"tax_percent"?: number,"technician_id"?: string,"updated_at"?: string,"version"?: number,"warranty_terms"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_repair_request_id_fkey"
      columns: ["repair_request_id"]
isOneToOne: false
      referencedRelation: "repair_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_technician_id_fkey"
      columns: ["technician_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"repair_dispatch_locations": {
                  Row: {
                    "accuracy": number | null,"captured_at": string,"created_at": string,"id": string,"latitude": number,"longitude": number,"repair_request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accuracy"?: number | null,"captured_at"?: string,"created_at"?: string,"id"?: string,"latitude": number,"longitude": number,"repair_request_id": string
                  }
                  Update: {
                    "accuracy"?: number | null,"captured_at"?: string,"created_at"?: string,"id"?: string,"latitude"?: number,"longitude"?: number,"repair_request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "repair_dispatch_locations_repair_request_id_fkey"
      columns: ["repair_request_id"]
isOneToOne: true
      referencedRelation: "repair_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"repair_messages": {
                  Row: {
                    "created_at": string,"id": string,"is_read": boolean,"message_text": string,"recipient_id": string,"repair_request_id": string,"sender_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_read"?: boolean,"message_text": string,"recipient_id": string,"repair_request_id": string,"sender_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_read"?: boolean,"message_text"?: string,"recipient_id"?: string,"repair_request_id"?: string,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "repair_messages_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "repair_messages_repair_request_id_fkey"
      columns: ["repair_request_id"]
isOneToOne: false
      referencedRelation: "repair_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "repair_messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"repair_notes": {
                  Row: {
                    "author_id": string,"created_at": string,"id": string,"note_text": string,"repair_request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"created_at"?: string,"id"?: string,"note_text": string,"repair_request_id": string
                  }
                  Update: {
                    "author_id"?: string,"created_at"?: string,"id"?: string,"note_text"?: string,"repair_request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "repair_notes_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "repair_notes_repair_request_id_fkey"
      columns: ["repair_request_id"]
isOneToOne: false
      referencedRelation: "repair_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"repair_requests": {
                  Row: {
                    "assessment": NonNullable<Json>,"cancellation_admin_response": string | null,"cancellation_note": string | null,"cancellation_previous_status": Database["public"]['Enums']["repair_status"] | null,"cancellation_reason": string | null,"cancellation_requested_at": string | null,"cancellation_requested_by": string | null,"clarification_note": string | null,"completion_details": Json | null,"created_at": string,"declined_by": (string)[],"description": string,"equipment_id": string,"farmer_id": string,"field_landmark": string | null,"id": string,"is_machine_stopped": boolean,"is_testing": boolean,"job_number": string,"location": string,"parts_hold": Json | null,"photos": (string)[],"preferred_time_slot": string | null,"service_type": string,"status": Database["public"]['Enums']["repair_status"],"status_since": string,"symptoms": (string)[],"technician_id": string | null,"updated_at": string,"urgency_level": string,"verified_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assessment"?: NonNullable<Json>,"cancellation_admin_response"?: string | null,"cancellation_note"?: string | null,"cancellation_previous_status"?: Database["public"]['Enums']["repair_status"] | null,"cancellation_reason"?: string | null,"cancellation_requested_at"?: string | null,"cancellation_requested_by"?: string | null,"clarification_note"?: string | null,"completion_details"?: Json | null,"created_at"?: string,"declined_by"?: (string)[],"description"?: string,"equipment_id": string,"farmer_id": string,"field_landmark"?: string | null,"id"?: string,"is_machine_stopped"?: boolean,"is_testing"?: boolean,"job_number": string,"location": string,"parts_hold"?: Json | null,"photos"?: (string)[],"preferred_time_slot"?: string | null,"service_type"?: string,"status"?: Database["public"]['Enums']["repair_status"],"status_since"?: string,"symptoms"?: (string)[],"technician_id"?: string | null,"updated_at"?: string,"urgency_level"?: string,"verified_at"?: string | null
                  }
                  Update: {
                    "assessment"?: NonNullable<Json>,"cancellation_admin_response"?: string | null,"cancellation_note"?: string | null,"cancellation_previous_status"?: Database["public"]['Enums']["repair_status"] | null,"cancellation_reason"?: string | null,"cancellation_requested_at"?: string | null,"cancellation_requested_by"?: string | null,"clarification_note"?: string | null,"completion_details"?: Json | null,"created_at"?: string,"declined_by"?: (string)[],"description"?: string,"equipment_id"?: string,"farmer_id"?: string,"field_landmark"?: string | null,"id"?: string,"is_machine_stopped"?: boolean,"is_testing"?: boolean,"job_number"?: string,"location"?: string,"parts_hold"?: Json | null,"photos"?: (string)[],"preferred_time_slot"?: string | null,"service_type"?: string,"status"?: Database["public"]['Enums']["repair_status"],"status_since"?: string,"symptoms"?: (string)[],"technician_id"?: string | null,"updated_at"?: string,"urgency_level"?: string,"verified_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "repair_requests_cancellation_requested_by_fkey"
      columns: ["cancellation_requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "repair_requests_equipment_id_fkey"
      columns: ["equipment_id"]
isOneToOne: false
      referencedRelation: "equipment"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "repair_requests_farmer_id_fkey"
      columns: ["farmer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "repair_requests_technician_id_fkey"
      columns: ["technician_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"repair_timeline": {
                  Row: {
                    "created_at": string,"created_by_id": string | null,"created_by_role": string,"id": string,"note": string | null,"repair_request_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by_id"?: string | null,"created_by_role": string,"id"?: string,"note"?: string | null,"repair_request_id": string,"status": string
                  }
                  Update: {
                    "created_at"?: string,"created_by_id"?: string | null,"created_by_role"?: string,"id"?: string,"note"?: string | null,"repair_request_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "repair_timeline_created_by_id_fkey"
      columns: ["created_by_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "repair_timeline_repair_request_id_fkey"
      columns: ["repair_request_id"]
isOneToOne: false
      referencedRelation: "repair_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"service_centre_part_requests": {
                  Row: {
                    "created_at": string,"estimated_arrival_at": string | null,"eta_updated_at": string | null,"eta_updated_by": string | null,"handed_off_at": string | null,"handed_off_by": string | null,"id": string,"notes": string | null,"part_id": string,"quantity": number,"repair_request_id": string,"requested_by": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"estimated_arrival_at"?: string | null,"eta_updated_at"?: string | null,"eta_updated_by"?: string | null,"handed_off_at"?: string | null,"handed_off_by"?: string | null,"id"?: string,"notes"?: string | null,"part_id": string,"quantity"?: number,"repair_request_id": string,"requested_by": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"estimated_arrival_at"?: string | null,"eta_updated_at"?: string | null,"eta_updated_by"?: string | null,"handed_off_at"?: string | null,"handed_off_by"?: string | null,"id"?: string,"notes"?: string | null,"part_id"?: string,"quantity"?: number,"repair_request_id"?: string,"requested_by"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_centre_part_requests_eta_updated_by_fkey"
      columns: ["eta_updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_requests_handed_off_by_fkey"
      columns: ["handed_off_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_requests_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "service_centre_parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_requests_repair_request_id_fkey"
      columns: ["repair_request_id"]
isOneToOne: false
      referencedRelation: "repair_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_requests_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"service_centre_part_sales": {
                  Row: {
                    "created_at": string,"id": string,"movement_audit_id": string | null,"notes": string | null,"part_id": string,"part_request_id": string | null,"quantity": number,"quote_id": string,"quote_item_id": string | null,"recorded_by": string,"repair_request_id": string,"sold_at": string,"total_amount": number,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"movement_audit_id"?: string | null,"notes"?: string | null,"part_id": string,"part_request_id"?: string | null,"quantity": number,"quote_id": string,"quote_item_id"?: string | null,"recorded_by": string,"repair_request_id": string,"sold_at"?: string,"total_amount": number,"unit_price": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"movement_audit_id"?: string | null,"notes"?: string | null,"part_id"?: string,"part_request_id"?: string | null,"quantity"?: number,"quote_id"?: string,"quote_item_id"?: string | null,"recorded_by"?: string,"repair_request_id"?: string,"sold_at"?: string,"total_amount"?: number,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_centre_part_sales_movement_audit_id_fkey"
      columns: ["movement_audit_id"]
isOneToOne: false
      referencedRelation: "service_centre_stock_audit"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_sales_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "service_centre_parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_sales_part_request_id_fkey"
      columns: ["part_request_id"]
isOneToOne: true
      referencedRelation: "service_centre_part_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_sales_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_sales_quote_item_id_fkey"
      columns: ["quote_item_id"]
isOneToOne: false
      referencedRelation: "quote_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_sales_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_part_sales_repair_request_id_fkey"
      columns: ["repair_request_id"]
isOneToOne: false
      referencedRelation: "repair_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"service_centre_parts": {
                  Row: {
                    "category": string,"compatible_models": (string)[],"created_at": string,"id": string,"location": string | null,"name": string,"part_number": string,"service_centre_id": string | null,"spec": string | null,"stock_quantity": number,"unit_price": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string,"compatible_models"?: (string)[],"created_at"?: string,"id"?: string,"location"?: string | null,"name": string,"part_number": string,"service_centre_id"?: string | null,"spec"?: string | null,"stock_quantity"?: number,"unit_price"?: number,"updated_at"?: string
                  }
                  Update: {
                    "category"?: string,"compatible_models"?: (string)[],"created_at"?: string,"id"?: string,"location"?: string | null,"name"?: string,"part_number"?: string,"service_centre_id"?: string | null,"spec"?: string | null,"stock_quantity"?: number,"unit_price"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_centre_parts_service_centre_id_fkey"
      columns: ["service_centre_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"service_centre_stock_audit": {
                  Row: {
                    "change_quantity": number,"changed_by": string,"created_at": string,"id": string,"movement_type": string,"new_stock": number,"notes": string | null,"part_id": string,"part_request_id": string | null,"previous_stock": number,"quote_id": string | null,"quote_item_id": string | null,"reason": string,"repair_request_id": string | null,"total_value": number | null,"unit_price": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "change_quantity": number,"changed_by": string,"created_at"?: string,"id"?: string,"movement_type"?: string,"new_stock": number,"notes"?: string | null,"part_id": string,"part_request_id"?: string | null,"previous_stock": number,"quote_id"?: string | null,"quote_item_id"?: string | null,"reason": string,"repair_request_id"?: string | null,"total_value"?: number | null,"unit_price"?: number | null
                  }
                  Update: {
                    "change_quantity"?: number,"changed_by"?: string,"created_at"?: string,"id"?: string,"movement_type"?: string,"new_stock"?: number,"notes"?: string | null,"part_id"?: string,"part_request_id"?: string | null,"previous_stock"?: number,"quote_id"?: string | null,"quote_item_id"?: string | null,"reason"?: string,"repair_request_id"?: string | null,"total_value"?: number | null,"unit_price"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_centre_stock_audit_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_stock_audit_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "service_centre_parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_stock_audit_part_request_id_fkey"
      columns: ["part_request_id"]
isOneToOne: false
      referencedRelation: "service_centre_part_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_stock_audit_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_stock_audit_quote_item_id_fkey"
      columns: ["quote_item_id"]
isOneToOne: false
      referencedRelation: "quote_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_centre_stock_audit_repair_request_id_fkey"
      columns: ["repair_request_id"]
isOneToOne: false
      referencedRelation: "repair_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"service_history": {
                  Row: {
                    "created_at": string,"demo_code": string | null,"downtime_hours": number,"equipment_id": string,"id": string,"invoice_reference": string,"issue_description": string,"labour_cost": number,"maintenance_advice": string | null,"operating_hours": number,"parts_replaced": (string)[],"repair_request_id": string | null,"service_date": string,"service_type": string,"technician_name": string,"technician_notes": string | null,"total_cost": number,"workshop_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"demo_code"?: string | null,"downtime_hours"?: number,"equipment_id": string,"id"?: string,"invoice_reference": string,"issue_description": string,"labour_cost"?: number,"maintenance_advice"?: string | null,"operating_hours"?: number,"parts_replaced"?: (string)[],"repair_request_id"?: string | null,"service_date"?: string,"service_type": string,"technician_name": string,"technician_notes"?: string | null,"total_cost"?: number,"workshop_name": string
                  }
                  Update: {
                    "created_at"?: string,"demo_code"?: string | null,"downtime_hours"?: number,"equipment_id"?: string,"id"?: string,"invoice_reference"?: string,"issue_description"?: string,"labour_cost"?: number,"maintenance_advice"?: string | null,"operating_hours"?: number,"parts_replaced"?: (string)[],"repair_request_id"?: string | null,"service_date"?: string,"service_type"?: string,"technician_name"?: string,"technician_notes"?: string | null,"total_cost"?: number,"workshop_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_history_equipment_id_fkey"
      columns: ["equipment_id"]
isOneToOne: false
      referencedRelation: "equipment"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_history_repair_request_id_fkey"
      columns: ["repair_request_id"]
isOneToOne: false
      referencedRelation: "repair_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"technician_profiles": {
                  Row: {
                    "brands": (string)[],"created_at": string,"distance_km": number,"eta_minutes": number,"id": string,"is_available": boolean,"is_doorstep_capable": boolean,"is_verified": boolean,"jobs_completed": number,"max_travel_radius_km": number,"phone": string | null,"profile_id": string,"rating": number,"skills": (string)[],"updated_at": string,"workshop_latitude": number | null,"workshop_longitude": number | null,"workshop_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "brands"?: (string)[],"created_at"?: string,"distance_km"?: number,"eta_minutes"?: number,"id"?: string,"is_available"?: boolean,"is_doorstep_capable"?: boolean,"is_verified"?: boolean,"jobs_completed"?: number,"max_travel_radius_km"?: number,"phone"?: string | null,"profile_id": string,"rating"?: number,"skills"?: (string)[],"updated_at"?: string,"workshop_latitude"?: number | null,"workshop_longitude"?: number | null,"workshop_name": string
                  }
                  Update: {
                    "brands"?: (string)[],"created_at"?: string,"distance_km"?: number,"eta_minutes"?: number,"id"?: string,"is_available"?: boolean,"is_doorstep_capable"?: boolean,"is_verified"?: boolean,"jobs_completed"?: number,"max_travel_radius_km"?: number,"phone"?: string | null,"profile_id"?: string,"rating"?: number,"skills"?: (string)[],"updated_at"?: string,"workshop_latitude"?: number | null,"workshop_longitude"?: number | null,"workshop_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "technician_profiles_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "adjust_service_centre_part_stock":
{ Args: { "p_change_quantity": number,"p_part_id": string,"p_reason": string }; Returns: Json
                           },
"check_table_rls":
{ Args: Record<PropertyKey, never>; Returns: {
              "policy_count": number,"rls_enabled": boolean,"table_name": string
            }[]
                           },
"confirm_service_centre_part_handoff":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"create_quote_atomic":
{ Args: { "p_estimated_completion": string,"p_items": Json,"p_labour_amount": number,"p_labour_description": string,"p_repair_request_id": string,"p_tax_percent": number,"p_warranty_terms": string }; Returns: Json
                           },
"current_clerk_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"current_profile_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"current_user_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["user_role"]
                           },
"delete_user_account":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_storage_buckets":
{ Args: Record<PropertyKey, never>; Returns: {
              "file_size_limit": number,"id": string,"name": string,"public": boolean
            }[]
                           },
"receive_service_centre_stock":
{ Args: { "p_part_id": string,"p_quantity": number,"p_reason": string }; Returns: Json
                           },
"request_service_centre_part":
{ Args: { "p_notes"?: string,"p_part_id": string,"p_quantity"?: number,"p_repair_request_id": string }; Returns: Json
                           },
"reset_demo_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"return_service_centre_part":
{ Args: { "p_part_id": string,"p_quantity": number,"p_reason": string,"p_repair_request_id": string }; Returns: Json
                           },
"revise_quote_atomic":
{ Args: { "p_estimated_completion": string,"p_items": Json,"p_labour_amount": number,"p_labour_description": string,"p_previous_quote_id": string,"p_repair_request_id": string,"p_tax_percent": number,"p_technician_explanation": string,"p_warranty_terms": string }; Returns: Json
                           },
"update_service_centre_part_request_eta":
{ Args: { "p_estimated_arrival_at": string,"p_notes"?: string,"p_request_id": string }; Returns: Json
                           }
          }
          Enums: {
            "equipment_status": "Operational"|"In Repair"|"Needs Attention","equipment_type": "Tractor"|"Harvester"|"Power Tiller"|"Pump"|"Sprayer","quote_status": "PENDING"|"APPROVED"|"REVISED"|"REJECTED","repair_status": "REQUESTED"|"ACCEPTED"|"QUOTE_PENDING"|"QUOTE_REVISED"|"IN_PROGRESS"|"WAITING_FOR_PARTS"|"COMPLETED"|"CANCELLATION_REQUESTED"|"CANCELLED","user_role": "farmer"|"technician"|"admin"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "equipment_status": ["Operational", "In Repair", "Needs Attention"],"equipment_type": ["Tractor", "Harvester", "Power Tiller", "Pump", "Sprayer"],"quote_status": ["PENDING", "APPROVED", "REVISED", "REJECTED"],"repair_status": ["REQUESTED", "ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED", "IN_PROGRESS", "WAITING_FOR_PARTS", "COMPLETED", "CANCELLATION_REQUESTED", "CANCELLED"],"user_role": ["farmer", "technician", "admin"]
          }
        }
} as const
