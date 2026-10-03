import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
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
  const { ready, userId, emailConfirmed, profile, profileError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    if (searchParams.get("unconfirmed") === "true") {
      setInfoMsg("Please verify your email address before accessing the workspace.");
    } else if (searchParams.get("verified") === "true") {
      setInfoMsg("Email verified successfully! You can now sign in.");
    }

    const errorDesc = searchParams.get("error_description") || hashParams.get("error_description");
    const errorCode = searchParams.get("error_code") || hashParams.get("error_code");
    if (errorCode === "otp_expired") {
      setErr("Your verification link has expired or has already been used. Please request a new one below.");
    } else if (errorDesc) {
      setErr(decodeURIComponent(errorDesc.replace(/\+/g, " ")));
    }
  }, []);

  useEffect(() => {
    if (profile && emailConfirmed) nav({ to: homeFor(profile) });
  }, [profile, emailConfirmed, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setResendMsg("");
    setBusy(true);
    const targetEmail = email.trim();
    const { error } = await supabase.auth.signInWithPassword({ email: targetEmail, password });
    setBusy(false);
    if (error) {
      const msg = error.message.toLowerCase();
      const isUnconfirmed = msg.includes("email not confirmed") || (error as { code?: string }).code === "email_not_confirmed";
      if (isUnconfirmed) {
        setUnconfirmedEmail(targetEmail);
        setErr("Your email address is not verified yet. Please check your inbox for the confirmation link.");
      } else {
        setUnconfirmedEmail("");
        setErr(error.message);
      }
    }
  };

  const handleResend = async () => {
    const target = unconfirmedEmail || email.trim();
    if (!target) return;
    setResendBusy(true);
    setResendMsg("");
    try {
      await supabase.auth.resend({
        type: "signup",
        email: target,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });
      setResendMsg("Verification email resent. Please check your inbox and spam folder.");
    } catch {
      setResendMsg("If this account exists, a verification link was sent.");
    } finally {
      setResendBusy(false);
    }
  };

  const fillAndSignIn = async (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setErr("");
    setUnconfirmedEmail("");
    setResendMsg("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPass });
    setBusy(false);
    if (error) setErr(error.message);
  };

  return (
    <AuthLayout>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
      </Link>
      <h2 className="font-display text-3xl font-bold">Sign in</h2>
      <p className="mt-1 text-muted-foreground">Farmers, technicians and service centre staff all sign in here.</p>

      {infoMsg && !err && (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-foreground font-medium">
          {infoMsg}
        </div>
      )}

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

          {unconfirmedEmail && (
            <div className="rounded-xl border border-border bg-muted/60 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Need another verification link?</p>
              {resendMsg ? (
                <p className="text-xs text-emerald-800 dark:text-emerald-300 font-medium">{resendMsg}</p>
              ) : (
                <button
                  type="button"
                  disabled={resendBusy}
                  onClick={() => void handleResend()}
                  className="h-9 w-full rounded-lg border border-border bg-background text-xs font-semibold hover:bg-card disabled:opacity-60"
                >
                  {resendBusy ? "Resending…" : "Resend confirmation email"}
                </button>
              )}
            </div>
          )}

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
                onClick={() => void fillAndSignIn("farmer.nagpur@terrabyte.demo", "TerraByte@2026")}
                className="flex h-11 items-center justify-center rounded-xl border border-border bg-card px-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"
              >
                Farmer
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void fillAndSignIn("tech.nagpur@terrabyte.demo", "TerraByte@2026")}
                className="flex h-11 items-center justify-center rounded-xl border border-border bg-card px-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"
              >
                Technician
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void fillAndSignIn("admin.nagpur@terrabyte.demo", "TerraByte@2026")}
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
