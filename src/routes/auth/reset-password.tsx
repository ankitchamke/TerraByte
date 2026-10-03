import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthLayout, Field, FormError } from "@/components/auth-ui";
import { clearPasswordRecoveryState, signOut, useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset Password — TerraByte" },
      {
        name: "description",
        content: "Set a new password for your TerraByte account.",
      },
      { property: "og:title", content: "Reset Password — TerraByte" },
      {
        property: "og:description",
        content: "Set a new password for your TerraByte account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResetPasswordPage,
});

type FlowState =
  | "verifying"
  | "ready"
  | "expired_or_invalid"
  | "already_signed_in"
  | "success";

function ResetPasswordPage() {
  const nav = useNavigate();
  const { ready, userId, isPasswordRecovery } = useAuth();

  const [flowState, setFlowState] = useState<FlowState>("verifying");
  const [errorMessage, setErrorMessage] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let isMounted = true;

    async function evaluateRecoverySession() {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

      // 1. Check for error parameters in URL or hash
      const err = searchParams.get("error") || hashParams.get("error");
      const errCode = searchParams.get("error_code") || hashParams.get("error_code");
      const errDesc = searchParams.get("error_description") || hashParams.get("error_description");

      if (err || errCode) {
        if (!isMounted) return;
        setFlowState("expired_or_invalid");
        if (errCode === "otp_expired" || errDesc?.toLowerCase().includes("expired")) {
          setErrorMessage(
            "This reset link has expired or has already been used. Please request a new password reset link."
          );
        } else {
          setErrorMessage(
            "This reset link is invalid or has expired. Please request a new password reset link."
          );
        }
        return;
      }

      // 2. Check for PKCE authorization code (?code=...)
      const code = searchParams.get("code");
      if (code) {
        try {
          const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeErr) {
            if (!isMounted) return;
            setFlowState("expired_or_invalid");
            setErrorMessage(
              "This reset link has expired or has already been used. Please request a new password reset link."
            );
            return;
          }
          if (!isMounted) return;
          setFlowState("ready");
          return;
        } catch {
          if (!isMounted) return;
          setFlowState("expired_or_invalid");
          setErrorMessage(
            "This reset link has expired or has already been used. Please request a new password reset link."
          );
          return;
        }
      }

      // 3. Check for token_hash and type (?token_hash=...&type=recovery)
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      if (tokenHash) {
        try {
          const { error: otpErr } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: (type as any) || "recovery",
          });
          if (otpErr) {
            if (!isMounted) return;
            setFlowState("expired_or_invalid");
            setErrorMessage(
              "This reset link has expired or has already been used. Please request a new password reset link."
            );
            return;
          }
          if (!isMounted) return;
          setFlowState("ready");
          return;
        } catch {
          if (!isMounted) return;
          setFlowState("expired_or_invalid");
          setErrorMessage(
            "This reset link has expired or has already been used. Please request a new password reset link."
          );
          return;
        }
      }

      // 4. Check for implicit hash token with type=recovery
      if (window.location.hash.includes("type=recovery") || window.location.hash.includes("access_token")) {
        setTimeout(async () => {
          if (!isMounted) return;
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            setFlowState("ready");
          } else {
            setFlowState("expired_or_invalid");
            setErrorMessage(
              "This reset link has expired or has already been used. Please request a new password reset link."
            );
          }
        }, 500);
        return;
      }

      // 5. If isPasswordRecovery flag is set in global auth state
      if (isPasswordRecovery) {
        if (!isMounted) return;
        setFlowState("ready");
        return;
      }

      // 6. Check existing session:
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) {
        // Normal signed-in user visiting without recovery context (Part 6)
        if (!isMounted) return;
        setFlowState("already_signed_in");
        return;
      }

      // 7. No recovery tokens and not authenticated: Invalid access
      if (!isMounted) return;
      setFlowState("expired_or_invalid");
      setErrorMessage(
        "No active password reset request was found. Please request a new reset link to proceed."
      );
    }

    void evaluateRecoverySession();

    return () => {
      isMounted = false;
    };
  }, [isPasswordRecovery]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError("");

    if (newPassword.length < 8) {
      setFieldError("Password must be at least 8 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setFieldError("Passwords do not match.");
      return;
    }

    setUpdating(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        console.error("[TerraByte] Update password error:", error);
        setFieldError(
          error.message && !error.message.includes("schema")
            ? error.message
            : "Failed to update password. The link may have expired."
        );
        setUpdating(false);
        return;
      }

      // Clean up recovery session
      clearPasswordRecoveryState();
      await supabase.auth.signOut();

      setFlowState("success");
    } catch (err: any) {
      console.error("[TerraByte] Update password exception:", err);
      setFieldError("An unexpected error occurred. Please try again.");
    } finally {
      setUpdating(false);
    }
  };

  const handleSignOutForReset = async () => {
    await signOut();
    void nav({ to: "/forgot-password" });
  };

  return (
    <AuthLayout>
      {/* 1. Evaluating / Verifying */}
      {flowState === "verifying" && (
        <div className="py-8 text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
          <h2 className="font-display text-2xl font-bold">Verifying reset link…</h2>
          <p className="text-sm text-muted-foreground">
            Please wait while we validate your password recovery session.
          </p>
        </div>
      )}

      {/* 2. Normal Signed-In User without recovery context (Part 6) */}
      {flowState === "already_signed_in" && (
        <div className="py-6 space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold">You're already signed in</h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              To change your password while signed in, use the Account Security section in your profile.
            </p>
          </div>

          <div className="pt-2 flex flex-col gap-2.5">
            <Link
              to="/profile"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Go to Account Security in Profile <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOutForReset()}
              className="flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Sign out to reset a different account
            </button>
          </div>
        </div>
      )}

      {/* 3. Expired or Invalid Link (Part 5) */}
      {flowState === "expired_or_invalid" && (
        <div className="py-6 space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold">Reset link issue</h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              {errorMessage}
            </p>
          </div>

          <div className="pt-2 flex flex-col gap-2.5">
            <Link
              to="/forgot-password"
              className="flex h-12 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Request a New Reset Link
            </Link>
            <Link
              to="/login"
              className="flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Back to Sign in
            </Link>
          </div>
        </div>
      )}

      {/* 4. Ready to Set New Password (Part 4) */}
      {flowState === "ready" && (
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary mb-2">
            <KeyRound className="h-4 w-4" />
            <span>Password Recovery</span>
          </div>
          <h2 className="font-display text-3xl font-bold">Set new password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Please enter your new password below. It must contain at least 8 characters.
          </p>

          <form onSubmit={handleUpdatePassword} className="mt-6 space-y-4">
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />

            <Field
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />

            <FormError>{fieldError}</FormError>

            <button
              type="submit"
              disabled={updating}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-60 active:scale-[0.99]"
            >
              {updating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Updating password…</span>
                </>
              ) : (
                <>
                  <span>Update Password</span>
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 border-t border-border pt-4 text-center">
            <Link to="/login" className="text-xs font-semibold text-muted-foreground hover:text-foreground">
              Cancel and return to Sign in
            </Link>
          </div>
        </div>
      )}

      {/* 5. Success State */}
      {flowState === "success" && (
        <div className="py-6 space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold">Password updated successfully!</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your account password has been changed. You can now sign in with your new password.
            </p>
          </div>

          <div className="pt-2">
            <Link
              to="/login"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Continue to Sign In <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
