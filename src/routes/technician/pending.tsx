import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clock, LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";
import { meta } from "@/lib/seo";
import { refreshProfile, signOut, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/technician/pending")({
  head: () => meta("Application pending", "Your TerraByte technician application is awaiting service centre approval."),
  component: Pending,
});

function Pending() {
  const { profile, email } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-warning/25 text-warning-foreground"><Clock className="h-8 w-8" /></span>
        <h1 className="mt-5 font-display text-3xl font-bold">Your technician application is pending approval.</h1>
        <p className="mt-3 text-muted-foreground">
          Thanks{profile?.full_name ? `, ${profile.full_name}` : ""}. The service centre is reviewing your workshop details.
          You'll be able to receive repair jobs as soon as your account is approved.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Signed in as {email}</p>
        <div className="mt-6 space-y-2">
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); await refreshProfile(); setBusy(false); }}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" /> Check approval status
          </button>
          <button
            onClick={() => void signOut().then(() => nav({ to: "/login" }))}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border font-semibold hover:bg-muted"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
