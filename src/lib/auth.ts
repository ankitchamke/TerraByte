import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { actions } from "@/lib/tb-store";

export type AppRole = "farmer" | "technician" | "service_centre";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  village: string | null;
  role: AppRole;
  is_verified: boolean;
  demo_code?: string | null;
}

export interface AuthState {
  ready: boolean;
  userId: string | null;
  email: string | null;
  emailConfirmed: boolean;
  profile: Profile | null;
  /** set when a session exists but no valid profile row could be read */
  profileError: string | null;
  isPasswordRecovery: boolean;
}

let state: AuthState = { ready: false, userId: null, email: null, emailConfirmed: false, profile: null, profileError: null, isPasswordRecovery: false };
const listeners = new Set<() => void>();
const set = (p: Partial<AuthState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

let inflightProfilePromise: Promise<void> | null = null;

async function loadProfile(userId: string, email: string | null, emailConfirmed: boolean = false): Promise<void> {
  // If identical profile load is already in-flight, reuse it
  if (inflightProfilePromise && state.userId === userId) {
    return inflightProfilePromise;
  }

  inflightProfilePromise = (async () => {
    try {
      // Query profiles matching auth_user_id or id, with email as fallback
      const orFilter = email
        ? `auth_user_id.eq.${userId},id.eq.${userId},email.eq.${email}`
        : `auth_user_id.eq.${userId},id.eq.${userId}`;

      const { data: profileRow, error } = await supabase
        .from("profiles")
        .select("id, auth_user_id, full_name, phone, village, role, email, demo_code")
        .or(orFilter)
        .maybeSingle();

      if (error) {
        set({ ready: true, userId, email, emailConfirmed, profile: null, profileError: error.message });
        return;
      }
      if (!profileRow) {
        set({
          ready: true,
          userId,
          email,
          emailConfirmed,
          profile: null,
          profileError: "We couldn't find an account profile for this login. Please contact the service centre to finish setting up your account.",
        });
        return;
      }

  // If the profile exists but auth_user_id wasn't linked yet, link it
  if (!profileRow.auth_user_id && userId) {
    void supabase.from("profiles").update({ auth_user_id: userId }).eq("id", profileRow.id);
  }

  // Check technician verification state:
  // In canonical schema, technicians have their own record in technician_profiles with is_verified
  let isVerified = true;
  if (profileRow.role === "technician") {
    const { data: techRow } = await supabase
      .from("technician_profiles")
      .select("is_verified")
      .or(`profile_id.eq.${profileRow.id},id.eq.${profileRow.id}`)
      .maybeSingle();
    isVerified = Boolean(techRow?.is_verified ?? false);
  }

  const role: AppRole = profileRow.role === "admin" ? "service_centre" : (profileRow.role as AppRole);

  const profile: Profile = {
    id: profileRow.id,
    full_name: profileRow.full_name,
    phone: profileRow.phone,
    village: profileRow.village,
    role,
    is_verified: isVerified,
    demo_code: profileRow.demo_code ?? null,
  };

  set({ ready: true, userId, email, emailConfirmed, profile, profileError: null });
    } finally {
      inflightProfilePromise = null;
    }
  })();
  return inflightProfilePromise;
}

let started = false;
export function startAuth() {
  if (started || typeof window === "undefined") return;
  started = true;
  supabase.auth.onAuthStateChange((event, session) => {
    const u = session?.user;
    if (!u) {
      actions.logout();
      set({ ready: true, userId: null, email: null, emailConfirmed: false, profile: null, profileError: null, isPasswordRecovery: false });
      return;
    }
    const isRecovery = event === "PASSWORD_RECOVERY";
    const emailConfirmed = !!(u.email_confirmed_at || (u as unknown as { confirmed_at?: string }).confirmed_at);
    set({
      userId: u.id,
      email: u.email ?? null,
      emailConfirmed,
      isPasswordRecovery: isRecovery ? true : (event === "SIGNED_IN" || event === "USER_UPDATED" ? false : state.isPasswordRecovery),
    });
    void loadProfile(u.id, u.email ?? null, emailConfirmed);
  });
  void supabase.auth.getSession().then(({ data }) => {
    const u = data.session?.user;
    if (!u) {
      actions.logout();
      set({ ready: true, userId: null, email: null, emailConfirmed: false, profile: null, profileError: null, isPasswordRecovery: false });
    } else {
      const emailConfirmed = !!(u.email_confirmed_at || (u as unknown as { confirmed_at?: string }).confirmed_at);
      set({ userId: u.id, email: u.email ?? null, emailConfirmed });
      void loadProfile(u.id, u.email ?? null, emailConfirmed);
    }
  });
}

export function clearPasswordRecoveryState() {
  set({ isPasswordRecovery: false });
}

export function refreshProfile() {
  if (state.userId) return loadProfile(state.userId, state.email, state.emailConfirmed);
  return Promise.resolve();
}

export async function resendVerificationEmail(email: string) {
  const clean = email.trim();
  if (!clean) throw new Error("Please enter a valid email address.");
  const redirectUrl = typeof window !== "undefined" ? `${window.location.origin}/auth/confirm` : undefined;
  if (redirectUrl) {
    return supabase.auth.resend({
      type: "signup",
      email: clean,
      options: { emailRedirectTo: redirectUrl },
    });
  }
  return supabase.auth.resend({
    type: "signup",
    email: clean,
  });
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      startAuth();
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Where an authenticated user belongs, based purely on the database profile. */
export function homeFor(p: Profile): "/farmer" | "/technician" | "/technician/pending" | "/admin" {
  if (p.role === "service_centre") return "/admin";
  if (p.role === "technician") return p.is_verified ? "/technician" : "/technician/pending";
  return "/farmer";
}

export async function signOut() {
  actions.logout();
  await supabase.auth.signOut();
}
