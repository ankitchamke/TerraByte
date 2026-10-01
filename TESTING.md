# TerraByte — Testing Guide & Verification Matrix

## 1. Testing Philosophy & Scope

This document specifies the verification criteria and test matrix for TerraByte.
- **Phase 2 Baseline Tests**: Behavioral tests verifying the real Supabase Auth, PostgreSQL triggers, Row Level Security (RLS) identity protection, role routing, technician approval workflow, and demo login.
- **Planned Domain Tests**: End-to-end business journey tests scheduled across subsequent phases (Phases 3–8) as live domain tables are built.

---

## 2. Phase 2 Supabase Authentication & Identity Test Matrix

| Test ID | Test Scenario | Setup | Action | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **AUTH-01** | Farmer signup | Unregistered farmer email & strong password | Call `supabase.auth.signUp()` with metadata `{ role: 'farmer', full_name, village, phone }` | New user created in `auth.users`; trigger `handle_new_user()` provisions `public.profiles` with `role = 'farmer'`, `is_verified = true`, `id = auth.users.id` | User ID created in `auth.users`; `profiles` record created with `role: 'farmer'`, `is_verified: true`, and matching ID | **PASS** |
| **AUTH-02** | Technician signup | Unregistered tech email & strong password | Call `supabase.auth.signUp()` with metadata `{ role: 'technician', full_name, workshop, village, phone }` | New user in `auth.users`; trigger provisions `profiles` with `role = 'technician'`, `is_verified = false`, and inserts row into `public.technician_profiles` | User ID created; `profiles` record created with `role: 'technician'`, `is_verified: false`; `technician_profiles` created with workshop name | **PASS** |
| **AUTH-03** | Farmer login | Seeded or registered farmer account | Call `supabase.auth.signInWithPassword()` with farmer credentials | Returns valid authenticated session with JWT access token; profile loads; `homeFor(profile)` routes to `/farmer` | HTTP 200 OK; access token returned; session established; routes to `/farmer` | **PASS** |
| **AUTH-04** | Technician login | Seeded or registered technician account | Call `supabase.auth.signInWithPassword()` with tech credentials | Returns valid session; if `is_verified = true` routes to `/technician`, else to `/technician/pending` | HTTP 200 OK; access token returned; verified tech routes to `/technician`; unverified tech routes to `/technician/pending` | **PASS** |
| **AUTH-05** | Service Centre login | Provisioned Service Centre account (`admin@terrabyte.com`) | Call `supabase.auth.signInWithPassword()` with admin credentials | Returns valid session; profile resolves `role = 'service_centre'`; routes to `/admin` | HTTP 200 OK; access token returned; profile has `role: 'service_centre'`; routes to `/admin` | **PASS** |
| **AUTH-06** | Logout | Authenticated session active in browser | Click [Sign out] button or invoke `signOut()` from `src/lib/auth.ts` | Calls `supabase.auth.signOut()`; local auth store clears; user is redirected to `/login` | Session revoked in Supabase client; state reset to null; navigates to `/login` | **PASS** |
| **AUTH-07** | Session restoration | User authenticated in browser tab | Reload browser page or open new tab at protected route | `onAuthStateChange` & `getSession()` restore token; profile reloaded from database; user remains on workspace | Session restored immediately from storage; profile loaded; zero redirect to `/login` | **PASS** |
| **AUTH-08** | Invalid credentials | Any email with incorrect password | Call `signInWithPassword()` with invalid password | HTTP 400 error returned by Supabase; no session created; inline error displayed | HTTP 400 Bad Request; error message "Invalid login credentials"; no session created | **PASS** |
| **AUTH-09** | Duplicate email | Email already registered in `auth.users` | Attempt `signUp()` with same email address | Registration blocked; returns HTTP 422 or empty identities list; no duplicate profile row | HTTP 422 Unprocessable Entity; duplicate user creation blocked; database table unmodified | **PASS** |
| **AUTH-10** | Missing profile error | User exists in `auth.users` but no profile row in `public.profiles` | Authenticate user lacking profile row | `loadProfile()` sets `profileError`; `/login` displays explicit configuration error; **no fallback to farmer** | `profileError` set: *"We couldn't find an account profile for this login..."*; `/login` displays error card with Sign out button | **PASS** |
| **AUTH-11** | Farmer role protection | Signed in as Farmer | Directly enter URL `/admin` or `/technician` | `RoleGuard` detects profile role mismatch; redirects back to `homeFor(profile)` (`/farmer`) | Redirected to `/farmer`; protected admin and technician dashboards completely inaccessible | **PASS** |
| **AUTH-12** | Technician role protection | Signed in as Technician | Directly enter URL `/admin` or `/farmer` | `RoleGuard` detects role mismatch; redirects back to `homeFor(profile)` (`/technician`) | Redirected to `/technician`; farmer and admin routes inaccessible | **PASS** |
| **AUTH-13** | Service Centre role protection | Signed in as Service Centre | Directly enter URL `/farmer` or `/technician` | `RoleGuard` detects role mismatch; redirects back to `homeFor(profile)` (`/admin`) | Redirected to `/admin`; role boundaries strictly enforced | **PASS** |
| **AUTH-14** | Technician pending gate | Newly registered technician (`is_verified = false`) | Attempt navigation to `/technician` workbench | `RoleGuard` detects `!profile.is_verified`; blocks workbench access and displays `/technician/pending` | Workbench locked; renders pending approval screen with "Check approval status" and "Sign out" | **PASS** |
| **AUTH-15** | Technician approval workflow | Service Centre admin and unverified technician | Admin visits `/admin/technicians` $\rightarrow$ clicks [Approve technician] $\rightarrow$ tech refreshes `/technician/pending` | `profiles.is_verified` updated to `true` in Supabase; tech clicks [Check approval status] and is unblocked | Admin PATCH updates `is_verified: true` (HTTP 200); technician profile reflects `is_verified: true`; routes to `/technician` | **PASS** |
| **AUTH-16** | Role tampering prevention | Authenticated Farmer tries client-side role elevation | Issue direct PATCH to `public.profiles` setting `role = 'service_centre'` | PostgreSQL trigger `guard_profile_privileges` raises exception; transaction aborted | HTTP 400; message: *"Only the service centre can change role or verification status"*; role unchanged | **PASS** |
| **AUTH-17** | Verification tampering prevention | Authenticated Technician tries self-approval | Issue direct PATCH to `public.profiles` setting `is_verified = true` | PostgreSQL trigger `guard_profile_privileges` raises exception; transaction aborted | HTTP 400; message: *"Only the service centre can change role or verification status"*; verification unchanged | **PASS** |
| **AUTH-18** | Cross-user profile access | Authenticated Farmer queries other users' profiles | Send SELECT query to `public.profiles` filtering for another user's UUID | PostgreSQL RLS policy `profiles_select_own` filters out other users; returns 0 rows | Empty array `[]` returned (0 rows); unauthorized user profiles completely hidden | **PASS** |
| **AUTH-19** | Direct URL protection | Logged-out visitor with no session | Enter `/farmer`, `/technician`, `/technician/pending`, or `/admin` | `RoleGuard` detects `userId === null`; redirects immediately to `/login` | Instant redirect to `/login`; zero flash of protected content | **PASS** |
| **AUTH-20** | Quick Demo Login | Visitor on `/login` screen | Click [Farmer], [Technician], or [Service Centre] demo buttons | Autofills real credentials into email/password fields and invokes real `signInWithPassword()`; zero bypass | Form autofilled; real Supabase Auth executed; token received; user routed to appropriate portal | **PASS** |

---

## 3. Planned Domain Verification Tests (Phases 3–8)

The following domain tests are scheduled as the relational schema and storage are connected in subsequent phases:

| Test ID | Domain Feature | Phase | Planned Test Scenario |
| :--- | :--- | :---: | :--- |
| **E2E-01** | Farmer Fleet Management | Phase 3 | Insert new tractor into Supabase `equipment` table; verify display across farmer views. |
| **E2E-02** | Breakdown Ticket Submission | Phase 3 | Submit breakdown report with photo upload to Supabase Storage; verify row in `repairs`. |
| **E2E-03** | Quote Formulation | Phase 4 | Technician drafts quote; inserts into `quotes` and `quote_parts` tables. |
| **E2E-04** | Farmer Quote Approval | Phase 4 | Farmer approves quote; updates `repairs.status = 'IN_PROGRESS'`. |
| **E2E-05** | Parts Hold & Resumption | Phase 4 | Tech sets `WAITING_FOR_PARTS`; records delay reason; resumes to `IN_PROGRESS` on delivery. |
| **E2E-06** | Load Testing & Closure | Phase 4 | Tech records field test; signs off repair as `COMPLETED`. |
| **E2E-07** | Permanent Service History | Phase 4 | Completed repair auto-commits immutable maintenance entry into `service_records`. |
| **E2E-08** | Operations Triage & SLA | Phase 5 | Unassigned breakdown (>30 min) flagged in red; admin reassigns ticket to qualified tech. |
| **E2E-09** | Realtime Sync | Phase 7 | Status updates on technician workbench instantly update farmer screen via Supabase Realtime. |
| **E2E-10** | Multimodal Gemini AI | Phase 8 | Farmer uploads broken part photo; Gemini API returns suspected failure mode and parts advice. |

---

## 4. Release Blocker Checklist

No phase promotion or production deployment may occur if:
1. Unauthenticated users can view or interact with `/farmer/*`, `/technician/*`, or `/admin/*`.
2. Unverified technicians can access the technician job workbench before administrator approval.
3. Non-admin users can elevate their role to `service_centre` or set `is_verified = true`.
4. Any client request can read or modify another user's private profile.
5. TypeScript errors (`tsc --noEmit`) or Vite build failures exist.
