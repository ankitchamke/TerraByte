import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Loader2, Mail } from "lucide-react";
import { useState } from "react";
import { AuthLayout, Field, FormError } from "@/components/auth-ui";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Forgot Password — TerraByte" },
      {
        name: "description",
        content: "Reset your TerraByte account password.",
      },
      { property: "og:title", content: "Forgot Password — TerraByte" },
      {
        property: "og:description",
        content: "Reset your TerraByte account password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErr("Please enter your email address.");
      return;
    }

    setErr("");
    setBusy(true);

    try {
      const redirectUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/reset-password`
          : undefined;

      const { error } = await supabase.auth.resetPasswordForEmail(
        cleanEmail,
        redirectUrl ? { redirectTo: redirectUrl } : undefined,
      );

      // To prevent email enumeration, we do not expose user existence errors.
      // If a network-level or rate-limit error occurred, show a friendly advisory.
      if (error) {
        console.warn("[TerraByte] Password reset response:", error.message);
        if (error.message.toLowerCase().includes("rate limit") || (error as { status?: number }).status === 429) {
          setErr("Too many reset requests. Please wait a few moments before trying again.");
          setBusy(false);
          return;
        }
      }

      setSubmitted(true);
    } catch (unexpected: any) {
      console.error("[TerraByte] Unexpected reset request error:", unexpected);
      // Treat standard exceptions gracefully while showing generic confirmation
      setSubmitted(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Link
        to="/login"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Sign in
      </Link>

      <h2 className="font-display text-3xl font-bold">Forgot password?</h2>
      <p className="mt-1 text-muted-foreground">
        Enter your registered email address to receive password reset instructions.
      </p>

      {submitted ? (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Mail className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-xl font-bold">Check your inbox</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              If an account is associated with{" "}
              <strong className="text-foreground font-semibold">{email.trim()}</strong>,
              a password reset link has been sent. Please check your inbox and spam folder.
            </p>
          </div>
          <div className="pt-2 flex flex-col gap-2">
            <Link
              to="/login"
              className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Return to Sign in
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field
            label="Email address"
            type="email"
            autoComplete="email"
            required
            placeholder="farmer@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <FormError>{err}</FormError>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-60 active:scale-[0.99]"
          >
            {busy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Sending reset link…</span>
              </>
            ) : (
              <>
                <span>Send Reset Link</span>
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </form>
      )}

      <div className="mt-8 border-t border-border pt-6 text-center">
        <p className="text-xs text-muted-foreground">
          Remember your password?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
