# TerraByte — Testing Guide (TESTING)

## 1. Testing Goal

Prove that TerraByte coordinates the complete agricultural equipment repair journey reliably, securely, and intuitively across Farmers, Field Technicians, and Service Centre Dispatchers, while preventing unauthorized access and failing safely under adverse field conditions.

---

## 2. Critical User Journey (CUJ)

The core release gate of TerraByte:
```
1. Farmer logs in with credentials
2. Selects registered tractor & reports breakdown with symptoms + photo
3. Views assistive diagnostic hypothesis & selects qualified technician
4. Technician receives notification, accepts job, and reviews intake details
5. Technician inspects & sends itemized quote (parts + labour + completion ETA)
6. Farmer reviews transparent cost breakdown and authorizes repair
7. Technician updates progress (or marks waiting for parts with blocker visibility)
8. Technician completes repair & confirms handover
9. System compiles verified record permanently bound to machine service history
```
**Release Rule**: TerraByte must NOT ship if any step in this critical journey fails.

---

## 3. Authentication & Role Provisioning Tests

| Test Case | Steps | Expected Result | Status |
|---|---|---|---|
| **AUTH-01: Valid Email/Password Sign In** | Input valid email & password for seeded farmer $\rightarrow$ Submit | Authenticates with Clerk, resolves `role = 'farmer'`, redirects to `/farmer`. | Planned (Phase 3) |
| **AUTH-02: Google OAuth Sign In** | Click [Continue with Google] $\rightarrow$ complete OAuth prompt | Authenticates with Clerk, resolves Supabase profile, redirects to workspace. | Planned (Phase 3) |
| **AUTH-03: Invalid Password** | Input registered email with incorrect password $\rightarrow$ Submit | Rejects login, displays "Incorrect email or password", keeps email in field. | Planned (Phase 3) |
| **AUTH-04: Non-Existent User** | Input unregistered email $\rightarrow$ Submit | Rejects login with generic error; does not expose system internals. | Planned (Phase 3) |
| **AUTH-05: Farmer Public Registration** | Complete standard signup form with email/password $\rightarrow$ Submit | Clerk user created, auto-provisions `role = 'farmer'` in Supabase `profiles`, lands on `/farmer`. | Planned (Phase 3) |
| **AUTH-06: Technician Registration (Pending Gate)** | Click "Register as Technician" $\rightarrow$ complete registration | Clerk user created, provisions `role = 'technician'` with status `PENDING`, redirects to `/technician/pending`. | Planned (Phase 3) |
| **AUTH-07: Technician Pending Gate Hard Block** | Logged-in pending technician manually navigates to `/technician` | Intercepted by approval gate and redirected back to `/technician/pending`. | Planned (Phase 3) |
| **AUTH-08: Approved Technician Sign In** | Administrator marks status `APPROVED` $\rightarrow$ Technician logs in | Resolves approval status and redirects to `/technician` dashboard. | Planned (Phase 3) |
| **AUTH-09: Admin Manual Provisioning Only** | Inspect registration options on `/login` | Zero public registration path for Admin. Admin accounts are manually provisioned by administrators. | Planned (Phase 3) |
| **AUTH-10: Cross-Role Protection** | Log in as Farmer $\rightarrow$ Manually navigate to `/admin` or `/technician` | Intercepted by role guard and redirected back to `/farmer`. | Planned (Phase 3) |
| **AUTH-11: Sign Out** | Tap user profile $\rightarrow$ [Sign Out] | Clerk session revoked, local cache cleared, navigates to `/login`. | Planned (Phase 3) |
| **AUTH-12: Session Persistence** | Log in $\rightarrow$ Refresh page or open in new tab | Session automatically restored via Clerk; user remains on active workspace. | Planned (Phase 3) |
| **AUTH-13: Protected Route Interception** | Log out $\rightarrow$ Manually navigate to `/farmer/equipment` | Immediately intercepted and redirected to `/login`. | Planned (Phase 3) |
| **AUTH-14: No Phone OTP / SMS Gateways** | Inspect login and registration screens | Zero phone number input or SMS OTP trigger; authentication is strictly Email/Password and Google OAuth. | Planned (Phase 3) |

---

## 4. Authorization & Row Level Security (RLS) Tests

| Test Case | Actor | Action | Expected Result | Status |
|---|---|---|---|---|
| **RLS-01: Cross-Farmer Machine** | Farmer A | Attempt to query `equipment` belonging to Farmer B | Query returns 0 rows; data strictly isolated. | Planned (Phase 3) |
| **RLS-02: Cross-Farmer Repair** | Farmer A | Attempt to query `repair_requests` of Farmer B | Query returns 0 rows. | Planned (Phase 3) |
| **RLS-03: Technician Quote Auth** | Technician | Insert quote for an assigned repair request | Allowed by RLS policy. | Planned (Phase 3) |
| **RLS-04: Farmer Quote Approve** | Farmer | Update `quotes.status` to `APPROVED` for own repair | Allowed by RLS policy. | Planned (Phase 3) |
| **RLS-05: Illegal Quote Approve**| Technician | Attempt to update `quotes.status = 'APPROVED'` | Rejected by RLS policy with permission denied. | Planned (Phase 3) |
| **RLS-06: Admin Oversight** | Admin | Query all `repair_requests` and `quotes` across cluster | Allowed; admin possesses cluster visibility. | Planned (Phase 3) |
| **RLS-07: Anon Mutation** | Unauthenticated | Attempt `INSERT INTO repair_requests` via Supabase client | Rejected with `401 / permission denied`. | Planned (Phase 3) |

---

## 5. Farmer Flow Tests

| Test Case | Screen | Action | Expected Result | Status |
|---|---|---|---|---|
| **FARM-01: View Fleet** | `/farmer/equipment` | Open fleet screen | Displays all machines owned by farmer with operating hours and status. | Verified (Mock) |
| **FARM-02: Add Machine** | `/farmer/equipment` | Open modal $\rightarrow$ fill Make, Model, Serial No. $\rightarrow$ Save | Asset added to fleet; immediately selectable in breakdown intake. | Verified (Mock) |
| **FARM-03: Add Machine Valid**| `/farmer/equipment` | Leave Make/Model blank $\rightarrow$ Save | Form highlights missing fields; does not submit. | Verified (Mock) |
| **FARM-04: Report Breakdown** | `/farmer/report-breakdown` | Select machine $\rightarrow$ pick symptoms $\rightarrow$ input description $\rightarrow$ Submit | Advances to Step 2 with assistive diagnostic summary and matching techs. | Verified (Mock) |
| **FARM-05: Dispatch Tech** | `/farmer/report-breakdown` | Select recommended technician $\rightarrow$ [Request Repair] | Creates repair order (`REQUESTED`); navigates to `/farmer/repair/:id`. | Verified (Mock) |
| **FARM-06: Approve Quote** | `/farmer/repair/:id` | Review quote card $\rightarrow$ Tap [Approve & Authorize] | Status transitions to `IN_PROGRESS`; authorizes technician work. | Verified (Mock) |
| **FARM-07: Blocker Banner** | `/farmer/repair/:id` | Technician marks job `WAITING_FOR_PARTS` | Farmer view updates with amber banner showing part name and ETA. | Verified (Mock) |
| **FARM-08: Handover Sign-Off** | `/farmer/repair/:id` | Technician completes $\rightarrow$ Farmer taps [Confirm & Save] | Job closes; permanently recorded in machine's service history. | Verified (Mock) |

---

## 6. Technician Flow Tests

| Test Case | Screen | Action | Expected Result | Status |
|---|---|---|---|---|
| **TECH-01: View Feed** | `/technician` | Open technician dashboard | Displays incoming `REQUESTED` jobs filtered by operating radius. | Verified (Mock) |
| **TECH-02: Accept Job** | `/technician` | Tap [Accept Dispatch] on new lead | Status updates to `ACCEPTED`; job moves to active spotlight card. | Verified (Mock) |
| **TECH-03: Create Quote** | `/technician/job/:id` | Add parts rows + labour fee + completion ETA $\rightarrow$ Send | Status updates to `QUOTE_PENDING`; farmer notified. | Verified (Mock) |
| **TECH-04: Quote Total Calc**| `/technician/job/:id` | Add Part A (Qty 2 @ 500) + Labour (750) | Total dynamically calculates to Rs 1,750. | Verified (Mock) |
| **TECH-05: Mark Parts Delay**| `/technician/job/:id` | Toggle `WAITING_FOR_PARTS` $\rightarrow$ input part name + ETA | Status updates to `WAITING_FOR_PARTS`; records audit timeline event. | Verified (Mock) |
| **TECH-06: Resume Repair** | `/technician/job/:id` | Toggle back to `IN_PROGRESS` | Status updates to `IN_PROGRESS`; parts hold resolved. | Verified (Mock) |
| **TECH-07: Complete Repair** | `/technician/job/:id` | Conduct test run $\rightarrow$ input advice $\rightarrow$ [Mark Completed] | Status updates to `COMPLETED`; writes to `service_history`. | Verified (Mock) |

---

## 7. Service Centre / Admin Tests

| Test Case | Screen | Action | Expected Result | Status |
|---|---|---|---|---|
| **ADM-01: Metrics Overview** | `/admin` | Open operations console | Displays live unassigned count, active count, blocked count, downtime avg. | Verified (Mock) |
| **ADM-02: Stalled Request** | `/admin` | Request unaccepted for > 30 minutes | Row highlighted in amber/red alert styling. | Verified (Mock) |
| **ADM-03: Reassign Job** | `/admin` | Select stalled job $\rightarrow$ choose new workshop $\rightarrow$ [Reassign] | Job technician updated; original tech removed; new tech alerted. | Verified (Mock) |
| **ADM-04: Blocker Filter** | `/admin` | Click filter [Waiting for Parts] | Table isolates jobs delayed by parts supply chain. | Verified (Mock) |

---

## 8. Repair Workflow & State Transition Tests

```
State Transition Verification Matrix:
- REQUESTED       ──► ACCEPTED           [VALID]
- REQUESTED       ──► CANCELLED          [VALID]
- ACCEPTED        ──► QUOTE_PENDING      [VALID]
- QUOTE_PENDING   ──► IN_PROGRESS        [VALID - ONLY WITH FARMER APPROVAL]
- QUOTE_PENDING   ──► QUOTE_REVISED      [VALID]
- IN_PROGRESS     ──► WAITING_FOR_PARTS  [VALID]
- WAITING_FOR_PARTS ──► IN_PROGRESS      [VALID]
- IN_PROGRESS     ──► COMPLETED          [VALID]
- REQUESTED       ──► IN_PROGRESS        [INVALID - BLOCKED BY STATE MACHINE]
- QUOTE_PENDING   ──► COMPLETED          [INVALID - BLOCKED BY STATE MACHINE]
```

---

## 9. Quote Tests

- **Q-01 (Dynamic Parts Rows)**: Technician can add, edit, and delete multiple line items.
- **Q-02 (Zero Quantity / Negative Price)**: Form rejects non-positive quantities or negative prices.
- **Q-03 (Revision Versioning)**: Modifying a declined quote increments `version = 2` without destroying original audit log.
- **Q-04 (Approval Hard Gate)**: Technician cannot mark `IN_PROGRESS` while quote is `QUOTE_PENDING`.

---

## 10. Service History Tests

- **SH-01 (Asset Binding)**: Completed service record is permanently bound to `equipment.id`.
- **SH-02 (Data Completeness)**: Record captures service date, operating hours, replaced parts array, labour cost, total cost, technician name, workshop name, and maintenance advice.
- **SH-03 (Immutability)**: Historical service records cannot be edited or deleted by farmers or technicians.

---

## 11. Assistive AI Diagnostics Tests (Planned for Phase 5)

- **AI-01 (Structured Response)**: Gemini Edge Function returns valid JSON matching schema (`likely_issue`, `severity`, `parts_category`, `safety_advice`).
- **AI-02 (Loading Indicator)**: Submitting intake displays an animated pulse indicator ("Analyzing symptoms...").
- **AI-03 (API Failure Fallback)**: If Gemini API returns 500 or times out, UI gracefully falls back to rule-based category matching without crashing.
- **AI-04 (Malformed Response)**: If Gemini returns unparseable text, fallback parser extracts keywords safely.
- **AI-05 (Key Security)**: Client network tab inspects zero calls to `generativelanguage.googleapis.com`; all traffic proxies through Supabase Edge Function.

---

## 12. Error Handling & Reliability Tests

- **ERR-01 (Network Failure)**: Disconnecting internet triggers an offline banner with direct phone dialer buttons.
- **ERR-02 (Double Submission)**: Tapping `[Approve Quote]` or `[Submit Request]` multiple times rapidly triggers button disabling; only one mutation fires.
- **ERR-03 (Page Refresh)**: Refreshing active repair view maintains current state from database.
- **ERR-04 (Empty State)**: Clean empty state displayed when zero equipment or zero repairs exist.

---

## 13. Responsive Testing Matrix

Test across standard viewports:
- **Small Mobile (320px – 375px)**: iPhone SE / Android compact.
- **Large Mobile (390px – 430px)**: iPhone 14/15 / Pixel 7.
- **Tablet (768px – 1024px)**: iPad Mini / Air.
- **Desktop (1280px+)**: Laptop / External display.

**Verification Checklist**:
- [ ] No horizontal scroll or viewport overflow on any screen.
- [ ] Primary CTAs (`[Report Breakdown]`, `[Approve Quote]`) are pinned or thumb-reachable with minimum 48px height.
- [ ] Form inputs maintain readable 16px font to prevent mobile Safari auto-zoom.
- [ ] Modals and drawers fit comfortably within mobile viewports with visible close buttons.

---

## 14. Accessibility Checks

- [ ] All icon-only buttons (notifications, back, call) have explicit `aria-label` attributes.
- [ ] Form fields are linked to visible `<label>` tags with matching `htmlFor` / `id`.
- [ ] Interactive elements are reachable and operable via keyboard `Tab` and `Enter` / `Space`.
- [ ] Focus states have high-contrast visible rings (`focus-visible:ring-2`).
- [ ] Color is never the sole indicator of state (status badges use text labels alongside color).

---

## 15. Security & Privacy Checks

- [ ] `.env.local` is listed in `.gitignore` and confirmed untracked by `git ls-files`.
- [ ] `.env.example` contains only generic placeholder values.
- [ ] Zero Supabase service-role keys, database passwords, or CLI tokens present in `src/`.
- [ ] Browser console logs zero sensitive credentials during login or API operations.
- [ ] PostgreSQL RLS verified active on all 10 application tables.

---

## 16. Release Blockers

The following defects constitute immediate release blockers:
1. **Authentication Failure**: Users cannot log in or are redirected incorrectly.
2. **Data Leakage**: A farmer can view another farmer's private equipment or repairs.
3. **RLS Bypass**: Any client can execute unauthorized database updates.
4. **Broken Workflow**: A repair cannot advance from `REQUESTED` to `COMPLETED`.
5. **Quote Gate Failure**: Work can proceed without farmer quote approval.
6. **Mobile Unusability**: Critical buttons are cut off or unclickable on mobile viewports.
7. **Secret Exposure**: Any API key, service-role secret, or token is committed to Git.
8. **Build / Type Failure**: `tsc --noEmit` or `vite build` produces errors.

---

## 17. Standard Test Failure Report Format

When a test fails, document it using this format:

```markdown
### Defect Report: [TEST-ID] — [Brief Title]
- **Test Case**: [e.g., AUTH-02 / FARM-06]
- **Expected Result**: [What should have happened]
- **Actual Result**: [What actually happened]
- **Environment**: [e.g., Chrome 124 / iOS Safari 17 / Windows Desktop]
- **Reproduction Steps**:
  1. Navigate to ...
  2. Input ...
  3. Tap ...
- **Log / Error Trace**: [Copy of error string or screenshot link]
- **Severity**: [Critical / High / Medium / Low]
- **Status**: [Open / Investigating / Fixed / Verified]
```
