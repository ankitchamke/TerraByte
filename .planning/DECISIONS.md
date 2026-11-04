# TerraByte — Architecture Decision Records (ADRs) & Open Questions

## Overview

This document records the architectural decision records (ADRs) governing TerraByte, capturing context, rationale, and consequences for approved product architecture. It also catalogs open architectural questions requiring stakeholder decision.

> [!IMPORTANT]
> **Product-Level Decision vs. Database Implementation Distinction**:  
> The 8 approved ADRs below represent confirmed **product-level behaviors, operational policies, and functional scope boundaries**.  
> Approval of these product decisions does **NOT** automatically approve or finalize specific database schemas, table definitions, RPC signatures, RLS policies, or Supabase migration scripts for future phases (Phases 12–15). All database implementation designs remain proposed engineering drafts subject to explicit technical review and approval prior to implementation in their respective future phases.

---

## Approved Architecture Decision Records

### ADR-001: Shared Workshops & Facility Membership Architecture
- **Status**: **Approved (Implementation Scheduled for Phase 13)**
- **Context**: Previously, technician records treated workshops as unstructured text, and the Nagpur Service Centre acted as the sole implicit facility. Real-world agrarian repair in Vidarbha involves independent local physical workshops with owners, managers, and multiple employed mechanics.
- **Decision**: 
  1. Introduce an independent `public.repair_facilities` table representing physical repair workshops across Vidarbha.
  2. Separate facility ownership from technician membership. The owner/manager (`owner_profile_id`) manages the facility profile, operating hours, and technician team.
  3. Technicians belong to a workshop via `public.facility_memberships` with explicit roles: `OWNER`, `MANAGER`, and `TECHNICIAN` (`status = 'ACTIVE'`). A technician does **not** automatically become a workshop administrator.
  4. Public drop-off certification (`drop_off_approved`) is controlled exclusively by Service Centre administrators. Workshop owners cannot self-certify their facility for public farmer drop-offs.
  5. **Registered Workshop Location Rule**: The technician's physical operational base is their registered workshop location (`repair_facilities.latitude/longitude`). There is **NO mandatory or continuous live GPS tracking of technicians**. All distance, dispatch matching, and travel estimates originate from the registered workshop coordinates.
- **Consequences**:
  - Requires clean RLS policies distinguishing owner management rights from technician membership rights in `facility_memberships`.
  - Decouples technician profiles from facility administration.
  - Respects technician privacy and works reliably in low-connectivity rural environments without live GPS tracking.
- **Target Phase**: Phase 13 (Technician Trust, Shared Workshops & Accountability).

---

### ADR-002: Immobile Agricultural Machinery Service Protocol
- **Status**: **Approved (Implementation Scheduled for Phase 14)**
- **Context**: Agricultural tractors and implements frequently suffer catastrophic mechanical immobilizations (engine seizure, axle shearing, wheel/hub failure, differential lock) directly in muddy fields. Farmers cannot transport immobile multi-ton machinery to distant workshops without heavy commercial equipment.
- **Decision**:
  1. If a farmer flags a machine as completely stopped (`is_immobile = true`), the system **locks the service delivery mode strictly to Doorstep / On-Field Service**.
  2. Workshop Drop-Off is strictly disabled in the intake wizard.
  3. The farmer is explicitly warned not to attempt hazardous road towing or field haulage.
  4. An eligible technician travels from their registered workshop directly to the farmer's field location.
  5. Commercial flatbed / heavy towing dispatch is explicitly deferred post-hackathon.
- **Consequences**:
  - Enforces field safety for rural operators.
  - Simplifies intake state machine by removing unfeasible drop-off options.
- **Target Phase**: Phase 14 (Smart Dispatch & Emergency Response).

---

### ADR-003: Workshop Bay Capacity Management & Drop-Off Limits
- **Status**: **Approved (Implementation Scheduled for Phase 14)**
- **Context**: Rural repair shops have limited physical yard/bay capacity for large tractors and harvesters. Overcrowding leads to extended repair backlogs, parts misplacement, and field delays.
- **Decision**:
  1. Every repair facility has a configurable `max_equipment_capacity` field.
  2. Active workshop repairs are tracked dynamically (`current_active_repairs`).
  3. When `current_active_repairs >= max_equipment_capacity`, the workshop is flagged as *"At Capacity"* and excluded from receiving new farmer drop-off bookings.
- **Consequences**:
  - Prevents workshop yard congestion and machine abandonment.
  - Distributes repair load across available district facilities.
- **Target Phase**: Phase 14 (Smart Dispatch & Emergency Response).

---

### ADR-004: Privacy-Conscious In-Person Physical KYC Verification
- **Status**: **Approved (Implementation Scheduled for Phase 13)**
- **Context**: Verifying technician identity and workshop legitimacy is essential for farmer trust, but collecting and storing full 12-digit Aadhaar numbers or identity document scans introduces severe regulatory, privacy, and security liabilities.
- **Decision**:
  1. Zero full 12-digit Aadhaar numbers or government identity scans shall ever be uploaded, stored, or queried in TerraByte.
  2. KYC verification is conducted **physically in-person** at the central Nagpur Service Centre. Technicians present physical government credentials and workshop trade licenses to authorized officers.
  3. Account approval is executed via an admin-only SECURITY DEFINER RPC `public.verify_technician_kyc()`.
  4. The database stores strictly verification metadata: timestamp, verifying admin profile ID, and optional non-reversible cryptographic hash / last-4 digits for audit purposes.
- **Consequences**:
  - 100% compliance with identity privacy and data protection principles.
  - Eliminates external KYC vendor costs and API failure points, honoring the $0.00 free-tier constraint.
- **Target Phase**: Phase 13 (Technician Trust, Shared Workshops & Accountability).

---

### ADR-005: Authoritative OSRM Road Distance Routing & Strict Haversine Ban
- **Status**: **Approved (Implementation Scheduled for Phase 14)**
- **Context**: Straight-line (Haversine) distance misrepresents travel in rural Vidarbha due to river crossings, unpaved farm bunds, railway lines, and winding canal routes. Haversine calculations give farmers and technicians false expectations of travel duration.
- **Decision**:
  1. All technician travel distances and ETAs must be calculated authoritatively via the Open Source Routing Machine (OSRM) using actual road networks from the technician's **registered workshop coordinates** (`repair_facilities.latitude/longitude`). There is **NO continuous live GPS tracking of technicians**.
  2. **Strict Haversine Ban**: Straight-line Haversine calculations are **strictly prohibited** from the user interface, technician matching algorithms, and service-radius decisions.
  3. **Graceful Outage Fallback**: If OSRM routing is unreachable, times out, or returns an error, the interface must display:  
     `"Road Distance Temporarily Unavailable"`  
     Under no circumstances shall the application fall back to Haversine in the UI or reject qualified technicians.
  4. **Traffic Disclaimer**: OSRM driving duration is an estimated road driving duration based on standard road speeds without real-time traffic conditions.
- **Consequences**:
  - Provides realistic driving estimates reflecting actual rural road networks.
  - Guarantees deterministic, graceful degradation during upstream network outages.
- **Target Phase**: Phase 14 (Smart Dispatch & Emergency Response).

---

### ADR-006: Multilingual Scope Boundaries (English + Hindi Farmer UI)
- **Status**: **Approved (Implementation Scheduled for Phase 12)**
- **Context**: To maximize accessibility for rural operators while maintaining code maintainability under hackathon delivery timelines, linguistic scope must be sharply defined.
- **Decision**:
  1. The Farmer Portal (`/farmer/*`, intake wizard, stepper, quotes, fleet) shall support **English (`en`) and Hindi (`hi`)**.
  2. Configure **Noto Sans Devanagari** typography for Devanagari script integrity.
  3. **Explicit Marathi UI Removal**: All proposed Marathi UI localization is completely removed from web application screens. Farmer UI is strictly English + Hindi.
  4. **Voice Transcription Preservation**: Audio speech-to-text input retains Marathi transcription support independently via Whisper / Web Speech API.
  5. Technician and Service Centre administration interfaces remain in English for this release.
- **Consequences**:
  - Prevents translation fragmentation and excessive UI maintenance.
  - Guarantees high-quality, fully translated Hindi experience for farmers.
- **Target Phase**: Phase 12 (Multilingual Experience).

---

### ADR-007: Administrative Approval Gate for AI-Generated Technician Expertise
- **Status**: **Approved (Implementation Scheduled for Phase 13)**
- **Context**: AI models can analyze technician repair history and suggest brand and skill tags. However, unverified AI assertions presented as certified claims create liability and erode farmer trust.
- **Decision**:
  1. AI suggestions for technician brand certifications (e.g., *Mahindra Certified, Swaraj Hydraulics*) and skill tags are strictly advisory.
  2. AI-suggested tags **never** automatically become verified profile attributes or appear on public technician profiles.
  3. Suggestions flow to the Service Centre administrative approval workbench.
  4. An administrator must manually review, verify physical credentials, and explicitly sign off before any skill tag is rendered publicly.
- **Consequences**:
  - Protects platform credibility and prevents hallucinated qualifications.
  - Maintains human-in-the-loop governance for all trust-critical attributes.
- **Target Phase**: Phase 13 (Technician Trust, Shared Workshops & Accountability).

---

### ADR-008: Verified-Only Ratings Engine with Null Default Ratings
- **Status**: **Approved (Implementation Scheduled for Phase 13)**
- **Context**: Hardcoded default ratings (such as 5.00 stars for newly registered technicians) mislead farmers and dilute the value of genuine technician performance.
- **Decision**:
  1. Reviews and numeric ratings (1–5 stars) can be submitted **only** by farmers who have an immutable, completed `service_history` record associated with the assigned technician.
  2. The default rating for technicians without verified reviews is `NULL`, rendered in the interface as *"New / Unrated"*.
  3. Hardcoded or default 5.00-star ratings are completely banned.
  4. A PostgreSQL trigger atomically recalculates the technician's average rating and total review count upon review INSERT, UPDATE, or DELETE.
- **Consequences**:
  - 100% authentic, tamper-proof reputation system.
  - Protects new technicians from unfair rating penalties while preventing unearned perfect scores.
- **Target Phase**: Phase 13 (Technician Trust, Shared Workshops & Accountability).

---

## Open Architecture Decisions (Status: Needs Decision)

### Part 1: The Original 18 Architecture Review Questions
The following 18 technical and architectural questions from the master architecture review are preserved verbatim for stakeholder evaluation and resolution:

1. **Facility Ownership Divergence**: How to enforce in database constraints that `repair_facilities.owner_profile_id` and the `OWNER` membership row in `facility_memberships` never fall out of sync.  
   *Status*: **Needs Decision**
2. **Owner vs Manager Permissions**: Exact permission boundary between `OWNER` (can edit address, capacity, and delete shop) and `MANAGER` (can invite staff and manage daily bay check-ins, but cannot alter facility metadata).  
   *Status*: **Needs Decision**
3. **Physical KYC Document Audit Log**: Exact UI controls and validation in the admin KYC console to capture document type and masked last-4 ID without allowing freeform injection.  
   *Status*: **Needs Decision**
4. **Security Definer Function Hardening**: Auditing search paths (`SET search_path = 'public', 'pg_temp'`) and explicit `REVOKE`/`GRANT` execution permissions on all RPCs.  
   *Status*: **Needs Decision**
5. **Facility Governance Trigger Protection**: Ensuring PostgreSQL update triggers cannot be circumvented if role resolution returns `NULL` or bypasses PostgREST context.  
   *Status*: **Needs Decision**
6. **Pre-Check-in Facility Binding**: The exact mechanism for binding `repair_requests.facility_id` when the farmer selects an approved workshop before equipment physically arrives.  
   *Status*: **Needs Decision**
7. **Check-in State Validation**: Ensuring `execute_workshop_checkin` strictly rejects tickets not in `WORKSHOP_DROPOFF` mode or not in `AWAITING_ARRIVAL` state.  
   *Status*: **Needs Decision**
8. **Farmer Collection Confirmation**: Whether collection sign-off requires a farmer touch-canvas signature, an SMS OTP, or both.  
   *Status*: **Needs Decision**
9. **Collection Lifecycle Integrity**: Ensuring equipment collection cannot mark a ticket `COMPLETED` unless field/shop testing has passed and `service_history` is generated.  
   *Status*: **Needs Decision**
10. **Occupancy Invariant Enforcement**: Enforcing capacity limits strictly at check-in rather than silently clamping occupancy counts during downsized workshop capacity.  
    *Status*: **Needs Decision**
11. **Private Storage Policies**: Specific Supabase Storage bucket RLS policies for intake photos, check-in receipts, and handover signatures.  
    *Status*: **Needs Decision**
12. **Pre-Arrival Cancellation Lifecycle**: Authorization rules allowing farmers or admins to cancel a drop-off ticket before arrival without generating receipts or affecting occupancy.  
    *Status*: **Needs Decision**
13. **Facility vs Technician Reviews**: Whether farmers should review only the assigned technician, or also provide a separate facility rating for the workshop.  
    *Status*: **Needs Decision**
14. **Primary Facility Redundancy**: Whether `technician_profiles.primary_facility_id` should be a distinct preferred base column or derived dynamically from `facility_memberships`.  
    *Status*: **Needs Decision**
15. **Seeded Facility Verification**: Verifying exact physical street addresses and GPS coordinates for Central Nagpur Agro Depot (MIDC Hingna) before seeding.  
    *Status*: **Needs Decision**
16. **Elimination of Hardcoded UUIDs**: Ensuring migrations contain zero hardcoded user UUIDs (such as demo account IDs) in production DDL routines.  
    *Status*: **Needs Decision**
17. **Hindi Translation Tone & Review**: Reviewing Hindi terminology with native speakers to ensure natural rural phrasing rather than machine translation.  
    *Status*: **Needs Decision**
18. **OSRM Traffic Disclaimer**: Explicitly documenting throughout the UI that OSRM driving duration is an estimated road duration without real-time traffic conditions.  
    *Status*: **Needs Decision**

---

### Part 2: Supplementary Operational Questions
The following additional operational questions identified during subsequent scoping audits are also preserved for stakeholder guidance:

19. **Independent Technicians**: Can an independent field mechanic operate on TerraByte without being affiliated with a registered physical workshop entity?  
    *Status*: **Needs Decision**
20. **Multi-Workshop Membership**: Can a single certified technician belong to more than one workshop facility simultaneously, or is membership strictly one-to-one?  
    *Status*: **Needs Decision**
21. **Drop-Off Transit Liability**: In Flow B (Workshop Drop-Off), who holds formal equipment liability during farmer-operated road transit before the official Check-in Receipt (`RCP-TB-xxxx`) is signed?  
    *Status*: **Needs Decision**
22. **Emergency Capacity Override**: Should Service Centre dispatchers have administrative authority to override a workshop's `max_equipment_capacity` limit during peak seasonal breakdown surges (e.g., Kharif sowing peak)?  
    *Status*: **Needs Decision**
23. **Maximum Dispatch Radius**: What is the maximum allowable road distance radius for doorstep technician matching across Vidarbha (e.g., 35 km vs 50 km)?  
    *Status*: **Needs Decision**
24. **Voice Typing Fallback on Low-End Browsers**: On mobile browsers where the native Web Speech API lacks Hindi/Marathi language packs, should voice recording fall back to client-side audio capture with serverless Whisper processing, or revert gracefully to text-only input?  
    *Status*: **Needs Decision**
25. **Minimum Review Quorum**: How many verified reviews must a technician accumulate (e.g., 3 reviews vs 5 reviews) before their numeric star rating is rendered publicly rather than showing *"New / Unrated"*?  
    *Status*: **Needs Decision**
26. **Commercial Towing Integration Scheduling**: In which phase of the commercial post-hackathon roadmap should flatbed/towing vehicle dispatch integrations be scheduled?  
    *Status*: **Needs Decision**

---

*Decisions log updated: 2026-11-04 — Master Architecture & Decisions Record*