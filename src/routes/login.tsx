import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthLayout, Field, FormError } from "@/components/auth-ui";
import { homeFor, signOut, useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — TerraByte" },
      { name: "description", content: "Sign in to TerraByte to report breakdowns, manage repair jobs or run the service centre." },
      { property: "og:title", content: "Sign in — TerraByte" },
      { property: "og:description", content: "One sign in for farmers, technicians and service centre staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const { ready, userId, profile, profileError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (profile) nav({ to: homeFor(profile) });
  }, [profile, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(error.message);
  };

  const fillAndSignIn = async (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setErr("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPass });
    setBusy(false);
    if (error) setErr(error.message);
  };

  return (
    <AuthLayout>
      <h2 className="font-display text-3xl font-bold">Sign in</h2>
      <p className="mt-1 text-muted-foreground">Farmers, technicians and service centre staff all sign in here.</p>

      {ready && userId && profileError ? (
        <div className="mt-6 space-y-3">
          <FormError>{profileError}</FormError>
          <button onClick={() => void signOut()} className="h-12 w-full rounded-xl border border-border font-semibold hover:bg-muted">Sign out</button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <FormError>{err}</FormError>
          <button disabled={busy} className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {busy ? "Signing in…" : <>Sign in <ArrowRight className="h-5 w-5" /></>}
          </button>

          <div className="mt-6 rounded-2xl border border-dashed border-border bg-muted/30 p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Quick Demo Autofill</p>
            <p className="mt-1 text-xs text-muted-foreground">Autofills real credentials and signs in via Supabase Auth:</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void fillAndSignIn("farmer@terrabyte.com", "TerraByte@2026")}
                className="flex h-11 items-center justify-center rounded-xl border border-border bg-card px-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"
              >
                Farmer
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void fillAndSignIn("technician@terrabyte.com", "TerraByte@2026")}
                className="flex h-11 items-center justify-center rounded-xl border border-border bg-card px-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"
              >
                Technician
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void fillAndSignIn("admin@terrabyte.com", "TerraByte@2026")}
                className="flex h-11 items-center justify-center rounded-xl border border-border bg-card px-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"
              >
                Service Centre
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="mt-8 space-y-2 border-t border-border pt-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">New to TerraByte?</p>
        <Link to="/register/farmer" className="flex h-12 items-center justify-center rounded-xl border-2 border-border font-semibold hover:border-primary/50">Register as Farmer</Link>
        <Link to="/register/technician" className="flex h-12 items-center justify-center rounded-xl border-2 border-border font-semibold hover:border-primary/50">Register as Technician</Link>
        <p className="pt-2 text-xs text-muted-foreground">Service centre accounts are created by an administrator and sign in above.</p>
      </div>
    </AuthLayout>
  );
}
