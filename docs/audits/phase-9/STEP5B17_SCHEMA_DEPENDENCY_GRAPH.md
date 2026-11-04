# TerraByte — Step 5B.17: Complete Schema Dependency Graph
**Document Version:** `1.0 (Architecture & Dependency Graph)`  
**Date:** `2026-11-04`  
**Total Public Tables:** `16 Core Application Tables`  
**Security Schema:** `app_security (Isolated Profile Separation)`  
**Enum Types:** `7 Distinct Domain Enums`  
**Production Gate Status:** **`UNAUTHORIZED / BLOCKED — NO PRODUCTION WRITE OPERATIONS AUTHORIZED`**

---

## 1. Executive Summary

This document establishes the definitive structural dependency graph of the TerraByte application database. Understanding this entity hierarchy is mandatory to construct a clean, deterministic initialization sequence without encountering foreign key errors, circular references, or missing enum types.

---

## 2. Multi-Level Entity Dependency Graph

```mermaid
flowchart TD
    subgraph Level0["Level 0: External Supabase Foundation"]
        AuthUsers["auth.users<br>(GoTrue Managed Auth)"]
        StorageBuckets["storage.buckets<br>(avatars, repair-images)"]
    end

    subgraph Level1["Level 1: Core Personas & Parts Master"]
        Profiles["public.profiles<br>(PK: id -> auth.users)"]
        Parts["public.service_centre_parts<br>(FK: service_centre_id -> profiles)"]
    end

    subgraph Level2["Level 2: Roles, Contacts & Assets"]
        TechProfiles["public.technician_profiles<br>(FK: profile_id -> profiles)"]
        Equipment["public.equipment<br>(FK: farmer_id -> profiles)"]
        Contacts["public.profile_contacts<br>(FK: profile_id -> profiles)"]
        Secrets["public.profile_auth_secrets<br>(FK: profile_id -> profiles)"]
    end

    subgraph Level3["Level 3: Repair Lifecycle Core"]
        Repairs["public.repair_requests<br>(FK: farmer_id, tech_id, equipment_id)"]
        Locations["public.repair_dispatch_locations<br>(FK: repair_request_id -> repairs)"]
        Messages["public.repair_messages<br>(FK: repair_request_id, sender_id)"]
        Notes["public.repair_notes<br>(FK: repair_request_id, author_id)"]
        Timeline["public.repair_timeline<br>(FK: repair_request_id, created_by_id)"]
    end

    subgraph Level4["Level 4: Requisitions & Quotes"]
        PartRequests["public.service_centre_part_requests<br>(FK: repair_id, part_id, requested_by)"]
        Quotes["public.quotes<br>(FK: repair_request_id, technician_id)"]
        QuoteItems["public.quote_items<br>(FK: quote_id, catalog_part_id -> parts)"]
    end

    subgraph Level5["Level 5: Stock Ledger, Sales & History"]
        StockAudit["public.service_centre_stock_audit<br>(FK: part_id, repair_id, quote_id)"]
        PartSales["public.service_centre_part_sales<br>(FK: part_id, quote_item_id, audit_id)"]
        History["public.service_history<br>(FK: equipment_id, repair_request_id)"]
        Notifications["public.notifications<br>(FK: recipient_user_id -> profiles)"]
    end

    AuthUsers --> Profiles
    Profiles --> TechProfiles
    Profiles --> Equipment
    Profiles --> Parts
    Profiles --> Contacts
    Profiles --> Secrets

    Profiles --> Repairs
    Equipment --> Repairs
    Repairs --> Locations
    Repairs --> Messages
    Repairs --> Notes
    Repairs --> Timeline

    Repairs --> PartRequests
    Parts --> PartRequests
    Repairs --> Quotes
    Quotes --> QuoteItems
    Parts --> QuoteItems

    Parts --> StockAudit
    Repairs --> StockAudit
    PartRequests --> StockAudit
    StockAudit --> PartSales
    QuoteItems --> PartSales
    Repairs --> History
    Equipment --> History
    Profiles --> Notifications

    style Level0 fill:#f5f5f5,stroke:#9e9e9e,stroke-width:2px
    style Level1 fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Level2 fill:#ede7f6,stroke:#512da8,stroke-width:2px
    style Level3 fill:#fff8e1,stroke:#f57f17,stroke-width:2px
    style Level4 fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style Level5 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

---

## 3. Domain Enums Inventory

Before any table referencing domain types can be instantiated, the following 7 PostgreSQL enum types must exist:

| Enum Name | Defined Values | Consuming Tables & Columns |
| :--- | :--- | :--- |
| `public.user_role` | `'farmer'`, `'technician'`, `'admin'`, `'service_centre'` | `profiles.role` |
| `public.equipment_type` | `'tractor'`, `'harvester'`, `'implement'`, `'pump'`, `'other'` | `equipment.type` |
| `public.equipment_status` | `'operational'`, `'in_repair'`, `'decommissioned'` | `equipment.status` |
| `public.repair_status` | `'PENDING_REVIEW'`, `'ASSIGNED'`, `'IN_PROGRESS'`, `'PARTS_PENDING'`, `'QUOTE_PENDING'`, `'APPROVED_IN_PROGRESS'`, `'COMPLETED'`, `'CANCELLED'`, `'CANCELLATION_REQUESTED'` | `repair_requests.status`, `repair_timeline.status` |
| `public.quote_status` | `'PENDING_APPROVAL'`, `'APPROVED'`, `'REJECTED'`, `'SUPERSEDED'` | `quotes.status` |
| `public.part_request_status` | `'REQUESTED'`, `'SOURCING'`, `'IN_TRANSIT'`, `'AVAILABLE'`, `'HANDED_OFF'`, `'REJECTED'`, `'CANCELLED'` | `service_centre_part_requests.status` |
| `public.stock_movement_type` | `'RECEIVED'`, `'ISSUED_TO_REPAIR'`, `'RETURNED'`, `'SALE'`, `'INVENTORY_ADJUSTMENT'` | `service_centre_stock_audit.movement_type` |

---

## 4. Foreign Key Constraints & Cascade Semantics

| Dependent Table | Foreign Key Column | Target Table & Column | On Delete Action | Critical Invariant |
| :--- | :--- | :--- | :---: | :--- |
| `public.profiles` | `id` | `auth.users(id)` | `CASCADE` | Every profile is bound 1:1 to an authentic Supabase Auth identity. |
| `public.technician_profiles` | `profile_id` | `public.profiles(id)` | `CASCADE` | Technician details are deleted if parent profile is purged. |
| `public.equipment` | `farmer_id` | `public.profiles(id)` | `CASCADE` | Equipment is owned strictly by a farmer profile. |
| `public.repair_requests` | `farmer_id` | `public.profiles(id)` | `RESTRICT` | Cannot delete farmer while active repair tickets exist. |
| `public.repair_requests` | `technician_id` | `public.profiles(id)` | `SET NULL` | Unassigns technician if tech profile is decommissioned. |
| `public.repair_requests` | `equipment_id` | `public.equipment(id)` | `RESTRICT` | Equipment record cannot be purged during active repair. |
| `public.service_centre_parts`| `service_centre_id` | `public.profiles(id)` | `RESTRICT` | Stock belongs to an authenticated service centre admin profile. |
| `public.quote_items` | `catalog_part_id` | `public.service_centre_parts(id)`| `SET NULL` | Linked catalog reference for stock deduction and sales auditing. |
| `public.service_centre_part_sales`| `quote_item_id` | `public.quote_items(id)` | `RESTRICT` | Financial sales records are immutable audit lines. |

---

## 5. Security & Isolation Layer

### 5.1 Schema `app_security`
- Created by Phase 11 / Profile Security Architecture (`20261104100000`).
- Encapsulates sensitive contact checks:
  `app_security.can_view_profile(p_target_id uuid)`
- Enforces that farmers cannot view technician personal details unless assigned to an active repair, and unassigned technicians cannot view farmer contacts.

### 5.2 RLS Helper Routines (in `public`)
- `public.current_profile_id()`: Resolves authenticated caller profile UUID.
- `public.current_user_role()`: Resolves authenticated caller role.
- `public.check_table_rls()`: Validates that RLS is enabled across all tables.

---

## 6. Audit Verdict

- **Dependency Graph Hierarchy:** **`VERIFIED (Level 0 through Level 5)`**
- **Enum Prerequisites:** **`VERIFIED (7 Enums Mapped)`**
- **Circular Dependencies:** **`NONE (Strict Acyclic Directed Graph)`**

Production gate status remains strictly: **`UNAUTHORIZED / BLOCKED — NO PRODUCTION WRITE OPERATIONS AUTHORIZED`**.
