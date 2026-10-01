import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthLayout, Field, FormError } from "@/components/auth-ui";
import { homeFor, useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/register/technician")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Register as a technician — TerraByte" },
      { name: "description", content: "Apply to join TerraByte as a verified agricultural equipment technician." },
      { property: "og:title", content: "Register as a technician — TerraByte" },
      { property: "og:description", content: "Receive repair jobs, send transparent quotes and update repair progress." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TechnicianRegister,
});

function TechnicianRegister() {
  const nav = useNavigate();
  const { profile, emailConfirmed } = useAuth();
  const [f, setF] = useState({ name: "", workshop: "", village: "", phone: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [existingAccount, setExistingAccount] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  useEffect(() => {
    if (profile && emailConfirmed) nav({ to: homeFor(profile) });
  }, [profile, emailConfirmed, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setExistingAccount(false);
    setBusy(true);
    const targetEmail = f.email.trim();
    const { data, error } = await supabase.auth.signUp({
      email: targetEmail,
      password: f.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        data: { role: "technician", full_name: f.name, workshop: f.workshop, village: f.village, phone: f.phone },
      },
    });
    setBusy(false);
    if (error) {
      if (error.message.toLowerCase().includes("already registered") || (error as { code?: string }).code === "user_already_exists") {
        setErr("An account with this email address already exists.");
        setExistingAccount(true);
        return;
      }
      setErr(error.message);
      return;
    }

    // Supabase User Enumeration Protection: existing users return an empty identities array
    if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
      setErr("An account with this email address already exists.");
      setExistingAccount(true);
      return;
    }

    // Always require explicit email verification; do not auto-login into workspace
    if (data.session) {
      await supabase.auth.signOut();
    }
    setRegisteredEmail(targetEmail);
    setSent(true);
  };

  const handleResend = async () => {
    if (!registeredEmail) return;
    setResendBusy(true);
    setResendMsg("");
    try {
      await supabase.auth.resend({
        type: "signup",
        email: registeredEmail,
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

  return (
    <AuthLayout>
      <h2 className="font-display text-3xl font-bold">Register as a technician</h2>
      <p className="mt-1 text-muted-foreground">Applications are reviewed by the service centre before you can take jobs.</p>
      {sent ? (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed">
            <p className="font-semibold text-foreground">Check your email to verify your application</p>
            <p className="mt-1 text-muted-foreground">
              We have sent a verification link to <strong className="text-foreground">{registeredEmail}</strong>. After confirming your email, your profile will be reviewed by the service centre.
            </p>
          </div>

          {resendMsg && (
            <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
              {resendMsg}
            </p>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              disabled={resendBusy}
              onClick={() => void handleResend()}
              className="h-11 w-full rounded-xl border border-border bg-muted font-semibold text-sm hover:bg-muted/80 disabled:opacity-60"
            >
              {resendBusy ? "Resending…" : "Resend verification email"}
            </button>
            <Link
              to="/login"
              className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Continue to Sign in
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Full name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Field label="Workshop name" required value={f.workshop} onChange={(e) => setF({ ...f, workshop: e.target.value })} />
          <Field label="Service area" required value={f.village} onChange={(e) => setF({ ...f, village: e.target.value })} />
          <Field label="Phone number" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Field label="Email" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Field label="Password" type="password" autoComplete="new-password" minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <FormError>{err}</FormError>
          {existingAccount && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm space-y-2">
              <p className="font-semibold text-foreground">Sign in to your existing account</p>
              <p className="text-xs text-muted-foreground">
                An account with <strong className="text-foreground">{f.email.trim()}</strong> is already registered. Please sign in below:
              </p>
              <Link
                to="/login"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Go to Sign in
              </Link>
            </div>
          )}
          <button disabled={busy} className="h-14 w-full rounded-xl bg-primary text-lg font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {busy ? "Submitting application…" : "Submit technician application"}
          </button>
        </form>
      )}
      <p className="mt-6 text-sm text-muted-foreground">Already registered? <Link to="/login" className="font-semibold text-primary">Sign in</Link></p>
    </AuthLayout>
  );
}
