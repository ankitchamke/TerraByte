import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, ArrowRight, Mail } from "lucide-react";
import { AuthLayout, FormError, Field } from "@/components/auth-ui";
import { homeFor, resendVerificationEmail, useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/confirm")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Email Verification — TerraByte" },
      { name: "description", content: "Verify your TerraByte email address to activate your account." },
      { property: "og:title", content: "Email Verification — TerraByte" },
      { property: "og:description", content: "Verify your TerraByte email address." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthConfirm,
});

function AuthConfirm() {
  const nav = useNavigate();
  const { ready, userId, emailConfirmed, profile } = useAuth();
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
  const [errorMessage, setErrorMessage] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let isMounted = true;

    async function processVerification() {
      // 1. Check for error parameters in hash or search
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const searchParams = new URLSearchParams(window.location.search);

      const err = hashParams.get("error") || searchParams.get("error");
      const errCode = hashParams.get("error_code") || searchParams.get("error_code");
      const errDesc = hashParams.get("error_description") || searchParams.get("error_description");

      if (err || errCode) {
        if (!isMounted) return;
        setStatus("error");
        if (errCode === "otp_expired") {
          setErrorMessage("This verification link has expired or has already been used. Please request a new confirmation email.");
        } else {
          setErrorMessage(errDesc ? decodeURIComponent(errDesc.replace(/\+/g, " ")) : "Verification failed. The link is invalid or expired.");
        }
        return;
      }

      // 2. Check for PKCE authorization code (?code=...)
      const code = searchParams.get("code");
      if (code) {
        const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeErr) {
          if (!isMounted) return;
          setStatus("error");
          setErrorMessage(exchangeErr.message || "Failed to exchange verification code. The link may have expired.");
          return;
        }
        if (!isMounted) return;
        setStatus("success");
        return;
      }

      // 3. Check for token_hash and type (?token_hash=...&type=signup)
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      if (tokenHash) {
        const { error: otpErr } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: (type as "signup" | "email") || "signup",
        });
        if (otpErr) {
          if (!isMounted) return;
          setStatus("error");
          setErrorMessage(otpErr.message || "Verification failed. The link is invalid or expired.");
          return;
        }
        if (!isMounted) return;
        setStatus("success");
        return;
      }

      // 4. Check if session already exists and is confirmed
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (user && (user.email_confirmed_at || (user as unknown as { confirmed_at?: string }).confirmed_at)) {
        if (!isMounted) return;
        setStatus("success");
        return;
      }

      // 5. If hash contains access_token, GoTrue client processes it automatically
      if (window.location.hash.includes("access_token")) {
        // Wait briefly for GoTrue client to parse hash
        setTimeout(async () => {
          const { data: refreshed } = await supabase.auth.getSession();
          if (refreshed.session?.user) {
            if (isMounted) setStatus("success");
          } else {
            if (isMounted) {
              setStatus("error");
              setErrorMessage("Could not complete verification. Please try signing in.");
            }
          }
        }, 800);
        return;
      }

      // Fallback: No tokens or codes present
      setStatus("error");
      setErrorMessage("No verification code or token found. If you have already verified your email, please sign in.");
    }

    void processVerification();

    return () => {
      isMounted = false;
    };
  }, []);

  // When confirmed and profile is available, redirect to user workspace
  useEffect(() => {
    if (status === "success" && ready && userId && emailConfirmed && profile) {
      const timer = setTimeout(() => {
        nav({ to: homeFor(profile) });
      }, 1500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [status, ready, userId, emailConfirmed, profile, nav]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail.trim()) return;
    setResendBusy(true);
    try {
      await resendVerificationEmail(resendEmail.trim());
      setResendSuccess(true);
    } catch {
      // Supabase masks account presence; show friendly generic message
      setResendSuccess(true);
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <AuthLayout>
      {status === "checking" && (
        <div className="py-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Mail className="h-7 w-7 animate-pulse" />
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold">Verifying your email…</h2>
          <p className="mt-2 text-sm text-muted-foreground">Please wait while we confirm your email ownership with Supabase.</p>
        </div>
      )}

      {status === "success" && (
        <div className="py-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold">Email verified successfully!</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {profile ? `Welcome, ${profile.full_name || "member"}! Directing you to your workspace…` : "Redirecting to your TerraByte workspace…"}
          </p>
          <div className="mt-6">
            <Link
              to="/login"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Continue to Sign In <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="py-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold">Verification link issue</h2>
          <div className="mt-3">
            <FormError>{errorMessage}</FormError>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold">Need a new verification link?</h3>
            <p className="mt-1 text-xs text-muted-foreground">Enter your registered email address to receive a fresh confirmation link:</p>
            {resendSuccess ? (
              <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                Verification email sent! Please check your inbox and spam folder.
              </p>
            ) : (
              <form onSubmit={handleResend} className="mt-3 space-y-3">
                <Field
                  label="Email address"
                  type="email"
                  required
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="farmer@example.com"
                />
                <button
                  type="submit"
                  disabled={resendBusy}
                  className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {resendBusy ? "Sending link…" : "Resend confirmation email"}
                </button>
              </form>
            )}
          </div>

          <div className="mt-6 text-center">
            <Link to="/login" className="text-sm font-semibold text-primary hover:underline">
              Back to Sign in
            </Link>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
