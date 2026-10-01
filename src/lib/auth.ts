import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "farmer" | "technician" | "service_centre";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  village: string | null;
  role: AppRole;
  is_verified: boolean;
}

export interface AuthState {
  ready: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  /** set when a session exists but no valid profile row could be read */
  profileError: string | null;
}

let state: AuthState = { ready: false, userId: null, email: null, profile: null, profileError: null };
const listeners = new Set<() => void>();
const set = (p: Partial<AuthState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

async function loadProfile(userId: string, email: string | null) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, village, role, is_verified")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    set({ ready: true, userId, email, profile: null, profileError: error.message });
    return;
  }
  if (!data) {
    set({
      ready: true,
      userId,
      email,
      profile: null,
      profileError: "We couldn't find an account profile for this login. Please contact the service centre to finish setting up your account.",
    });
    return;
  }
  set({ ready: true, userId, email, profile: data as Profile, profileError: null });
}

let started = false;
export function startAuth() {
  if (started || typeof window === "undefined") return;
  started = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    const u = session?.user;
    if (!u) {
      set({ ready: true, userId: null, email: null, profile: null, profileError: null });
      return;
    }
    set({ userId: u.id, email: u.email ?? null });
    void loadProfile(u.id, u.email ?? null);
  });
  void supabase.auth.getSession().then(({ data }) => {
    const u = data.session?.user;
    if (!u) set({ ready: true, userId: null, email: null, profile: null, profileError: null });
    else void loadProfile(u.id, u.email ?? null);
  });
}

export function refreshProfile() {
  if (state.userId) return loadProfile(state.userId, state.email);
  return Promise.resolve();
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
  await supabase.auth.signOut();
}
