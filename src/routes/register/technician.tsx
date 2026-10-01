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
  const { profile } = useAuth();
  const [f, setF] = useState({ name: "", workshop: "", village: "", phone: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => { if (profile) nav({ to: homeFor(profile) }); }, [profile, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: f.email.trim(),
      password: f.password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { role: "technician", full_name: f.name, workshop: f.workshop, village: f.village, phone: f.phone },
      },
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (!data.session) setSent(true);
  };

  return (
    <AuthLayout>
      <h2 className="font-display text-3xl font-bold">Register as a technician</h2>
      <p className="mt-1 text-muted-foreground">Applications are reviewed by the service centre before you can take jobs.</p>
      {sent ? (
        <p className="mt-6 rounded-xl border border-border bg-muted p-4 text-sm">Check your email to confirm your account, then sign in to see your application status.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Full name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Field label="Workshop name" required value={f.workshop} onChange={(e) => setF({ ...f, workshop: e.target.value })} />
          <Field label="Service area" required value={f.village} onChange={(e) => setF({ ...f, village: e.target.value })} />
          <Field label="Phone number" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Field label="Email" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Field label="Password" type="password" autoComplete="new-password" minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <FormError>{err}</FormError>
          <button disabled={busy} className="h-14 w-full rounded-xl bg-primary text-lg font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {busy ? "Submitting application…" : "Submit technician application"}
          </button>
        </form>
      )}
      <p className="mt-6 text-sm text-muted-foreground">Already registered? <Link to="/login" className="font-semibold text-primary">Sign in</Link></p>
    </AuthLayout>
  );
}
