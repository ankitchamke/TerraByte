import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertOctagon, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card, DemoTag, StatusPill } from "@/components/tb";
import { ago } from "@/lib/tb-store";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
import {
  getAdminRepairRequests,
  type RepairRequestDetail,
} from "@/lib/services/repair-requests";
import {
  getVerifiedTechnicians,
  type VerifiedTechnicianWithProfile,
} from "@/lib/services/technicians";

export const Route = createFileRoute("/admin/")({
  head: () => meta("Operations", "Service centre repair pipeline, exceptions and parts blockers."),
  component: Admin,
});

const FILTERS = ["All", "Unassigned", "Awaiting Quote", "Waiting for Parts", "Overdue"] as const;
type F = (typeof FILTERS)[number];

const OVERDUE_MIN: Partial<Record<string, number>> = {
  REQUESTED: 20,
  ACCEPTED: 180,
  QUOTE_PENDING: 240,
  QUOTE_REVISED: 120,
  WAITING_FOR_PARTS: 24 * 60,
};

function checkOverdue(r: RepairRequestDetail): boolean {
  const limit = OVERDUE_MIN[r.status];
  if (limit === undefined) return false;
  const statusSinceMs = new Date(r.status_since).getTime();
  return Date.now() - statusSinceMs > limit * 60 * 1000;
}

const test: Record<F, (r: RepairRequestDetail) => boolean> = {
  All: () => true,
  Unassigned: (r) => r.status === "REQUESTED",
  "Awaiting Quote": (r) => ["ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED"].includes(r.status),
  "Waiting for Parts": (r) => r.status === "WAITING_FOR_PARTS",
  Overdue: checkOverdue,
};

function Admin() {
  const [repairs, setRepairs] = useState<RepairRequestDetail[]>([]);
  const [technicians, setTechnicians] = useState<VerifiedTechnicianWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<F>("All");
  const [, tick] = useState(0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [repairsData, techsData] = await Promise.all([
        getAdminRepairRequests(),
        getVerifiedTechnicians().catch(() => []),
      ]);
      setRepairs(repairsData);
      setTechnicians(techsData);
    } catch (err: any) {
      console.error("[TerraByte] Failed to load admin operations data:", err);
      setError(err?.message || "Failed to load repair operations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const i = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(i);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="py-12 text-center text-muted-foreground">Loading repair operations…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Card className="text-destructive">
          <p>Failed to load operations data: {error}</p>
          <button onClick={() => void loadData()} className="mt-3 inline-block font-semibold underline">
            Retry
          </button>
        </Card>
      </div>
    );
  }

  const open = repairs.filter(
    (r) => r.status !== "CANCELLED" && !(r.status === "COMPLETED" && r.verified_at)
  );
  const exceptions = open.filter(checkOverdue);

  const metrics = [
    { k: "Unassigned / open requests", v: open.filter(test.Unassigned).length, tone: "text-info" },
    {
      k: "Active repairs",
      v: open.filter((r) =>
        ["IN_PROGRESS", "ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED"].includes(r.status)
      ).length,
      tone: "text-primary",
    },
    { k: "Waiting for parts", v: open.filter(test["Waiting for Parts"]).length, tone: "text-warning-foreground" },
    { k: "Avg. downtime (hrs)", v: "—", tone: "text-foreground" },
  ];

  const rows = open
    .filter(test[f])
    .sort(
      (a, b) =>
        Number(checkOverdue(b)) - Number(checkOverdue(a)) ||
        new Date(a.status_since).getTime() - new Date(b.status_since).getTime()
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Nagpur district · live
          </p>
          <h1 className="text-3xl font-bold">Repair operations</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/admin/technicians"
            className="inline-flex h-10 items-center gap-1 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
          >
            Technician accounts <ChevronRight className="h-4 w-4" />
          </Link>
          <DemoTag />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.k} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{m.k}</p>
            <p className={cn("font-display text-4xl font-extrabold", m.tone)}>{m.v}</p>
          </div>
        ))}
      </div>
      {exceptions.length > 0 && (
        <div className="rounded-2xl border-2 border-destructive bg-destructive/5 p-4">
          <p className="mb-2 flex items-center gap-2 font-bold text-destructive">
            <AlertOctagon className="h-5 w-5" /> {exceptions.length} operational exception
            {exceptions.length > 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {exceptions.map((r) => {
              const statusSinceMs = new Date(r.status_since).getTime();
              return (
                <Link
                  key={r.id}
                  to="/admin/repair/$id"
                  params={{ id: r.job_number || r.id }}
                  className="rounded-lg bg-card px-3 py-2 text-sm"
                >
                  <b className="font-mono">{r.job_number || r.id}</b> ·{" "}
                  {r.status === "REQUESTED" ? "unaccepted" : r.status.toLowerCase().replace(/_/g, " ")} for{" "}
                  {ago(statusSinceMs)}
                </Link>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((x) => (
          <button
            key={x}
            onClick={() => setF(x)}
            className={cn(
              "h-10 shrink-0 rounded-full border px-4 text-sm font-semibold",
              f === x ? "border-foreground bg-foreground text-background" : "border-border bg-card"
            )}
          >
            {x} <span className="opacity-60">{open.filter(test[x]).length}</span>
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {["Job", "Machine", "Farmer", "Technician", "Status", "Time in status", ""].map((h) => (
                <th key={h} className="px-4 py-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  No jobs in this view.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const e = r.equipment;
              const t = r.technician;
              const od = checkOverdue(r);
              const statusSinceMs = new Date(r.status_since).getTime();
              return (
                <tr
                  key={r.id}
                  className={cn("border-b border-border last:border-0", od && "bg-destructive/5")}
                >
                  <td className="px-4 py-3 font-mono font-semibold">
                    {od && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-destructive" />}
                    {r.job_number || r.id}
                  </td>
                  <td className="px-4 py-3">{e ? `${e.make} ${e.model}` : "Equipment"}</td>
                  <td className="px-4 py-3">{r.farmer?.full_name || "Farmer"}</td>
                  <td className="px-4 py-3">
                    {t?.full_name ?? <span className="font-semibold text-destructive">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill r={{ status: r.status, testing: r.is_testing }} audience="staff" />
                  </td>
                  <td className={cn("px-4 py-3 font-mono", od && "font-bold text-destructive")}>
                    {ago(statusSinceMs)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to="/admin/repair/$id"
                      params={{ id: r.job_number || r.id }}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 font-semibold hover:bg-muted"
                    >
                      {r.status === "REQUESTED" && !t ? "Dispatch" : "Open"} <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <h2 className="mb-3 text-xl font-bold">Technician workload</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {technicians.map((t) => {
            const load = open.filter((r) => r.technician_id === t.profile_id).length;
            const techName = t.profile?.full_name || "Technician";
            const workshopName = t.workshop_name || "Workshop";
            return (
              <div key={t.id} className="rounded-2xl border border-border bg-card p-4">
                <p className="font-semibold">{techName}</p>
                <p className="text-xs text-muted-foreground">{workshopName}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      t.is_available ? "text-success" : "text-muted-foreground"
                    )}
                  >
                    {t.is_available ? "Online" : "Busy"}
                  </span>
                  <span className="font-display text-2xl font-bold">{load}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, load * 33)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
