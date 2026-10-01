import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, Clock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { meta } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/technicians")({
  head: () => meta("Technician accounts", "Review and approve technician accounts for the TerraByte network."),
  component: Technicians,
});

interface Row {
  id: string;
  full_name: string;
  phone: string | null;
  village: string | null;
  is_verified: boolean;
  created_at: string;
  technician_profiles: { workshop: string; service_area: string | null } | null;
}

function Technicians() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, phone, village, is_verified, created_at, technician_profiles(workshop, service_area)")
      .eq("role", "technician")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setErr("");
    setRows((data ?? []) as unknown as Row[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setVerified = async (id: string, is_verified: boolean) => {
    setBusy(id);
    const { error } = await supabase.from("profiles").update({ is_verified }).eq("id", id);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    await load();
  };

  const pending = rows.filter((r) => !r.is_verified);
  const approved = rows.filter((r) => r.is_verified);

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Account verification</p>
        <h1 className="text-3xl font-bold">Technician accounts</h1>
        <p className="mt-1 text-muted-foreground">Approved technicians can sign in to the technician workspace and take jobs.</p>
      </div>
      {err && <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      {loading && <p className="text-muted-foreground">Loading accounts…</p>}
      {!loading && rows.length === 0 && <p className="rounded-2xl border border-border bg-card p-6 text-muted-foreground">No technician accounts have registered yet.</p>}

      {[{ title: "Pending approval", list: pending }, { title: "Approved", list: approved }].map(({ title, list }) => list.length > 0 && (
        <section key={title}>
          <h2 className="mb-3 flex items-center gap-2 text-xl font-bold">
            {title === "Pending approval" ? <Clock className="h-5 w-5 text-warning-foreground" /> : <BadgeCheck className="h-5 w-5 text-success" />} {title} <span className="text-muted-foreground">({list.length})</span>
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {list.map((r) => (
              <div key={r.id} className={cn("rounded-2xl border bg-card p-4", r.is_verified ? "border-border" : "border-warning/60")}>
                <p className="font-semibold">{r.full_name || "Unnamed technician"}</p>
                <p className="text-sm text-muted-foreground">{r.technician_profiles?.workshop || "Workshop not provided"}</p>
                <p className="text-sm text-muted-foreground">{r.technician_profiles?.service_area || r.village || "—"} · {r.phone || "no phone"}</p>
                <button
                  disabled={busy === r.id}
                  onClick={() => void setVerified(r.id, !r.is_verified)}
                  className={cn("mt-3 h-11 w-full rounded-xl font-semibold disabled:opacity-60", r.is_verified ? "border border-border hover:bg-muted" : "bg-primary text-primary-foreground hover:bg-primary/90")}
                >
                  {r.is_verified ? "Revoke access" : "Approve technician"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
