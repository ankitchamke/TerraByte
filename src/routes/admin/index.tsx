import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertOctagon, AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Users } from "lucide-react";
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

const FILTERS = [
  "All",
  "Unassigned",
  "Awaiting Quote",
  "Waiting for Parts",
  "Cancellation Requests",
  "Overdue",
  "Completed",
  "Cancelled",
] as const;
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
  "Cancellation Requests": (r) => r.status === "CANCELLATION_REQUESTED",
  Overdue: checkOverdue,
  Completed: (r) => r.status === "COMPLETED",
  Cancelled: (r) => r.status === "CANCELLED",
};

function Admin() {
  const nav = useNavigate();
  const [repairs, setRepairs] = useState<RepairRequestDetail[]>([]);
  const [technicians, setTechnicians] = useState<VerifiedTechnicianWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<F>("All");
  const [showAllTechs, setShowAllTechs] = useState(false);
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

  const open = repairs.filter(
    (r) => r.status !== "CANCELLED" && r.status !== "COMPLETED"
  );
  const completed = repairs.filter((r) => r.status === "COMPLETED");
  const cancelled = repairs.filter((r) => r.status === "CANCELLED");
  const exceptions = open.filter(checkOverdue);
  const cancellationRequests = open.filter((r) => r.status === "CANCELLATION_REQUESTED");

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

  const INITIAL_TECHS_COUNT = 4;

  const techWorkload = technicians.map((t) => {
    const load = open.filter((r) => r.technician_id === t.profile_id).length;
    return {
      t,
      load,
      techName: t.profile?.full_name || "Technician",
      workshopName: t.workshop_name || "Workshop",
      isAvailable: Boolean(t.is_available),
    };
  });

  const sortedTechWorkload = [...techWorkload].sort((a, b) => b.load - a.load);
  const maxLoad = Math.max(1, ...sortedTechWorkload.map((tw) => tw.load));
  const visibleTechs = showAllTechs
    ? sortedTechWorkload
    : sortedTechWorkload.slice(0, INITIAL_TECHS_COUNT);

  const rows = f === "Completed"
    ? completed.sort(
        (a, b) =>
          new Date(b.status_since || b.created_at).getTime() -
          new Date(a.status_since || a.created_at).getTime()
      )
    : f === "Cancelled"
    ? cancelled.sort(
        (a, b) =>
          new Date(b.status_since || b.created_at).getTime() -
          new Date(a.status_since || a.created_at).getTime()
      )
    : open
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

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading repair operations…</div>
      ) : error ? (
        <Card className="text-destructive">
          <p>Failed to load operations data: {error}</p>
          <button onClick={() => void loadData()} className="mt-3 inline-block font-semibold underline">
            Retry
          </button>
        </Card>
      ) : (
        <>
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
                  {r.status === "REQUESTED"
                    ? "unaccepted"
                    : r.status === "QUOTE_REVISED"
                    ? "revision awaiting technician"
                    : r.status.toLowerCase().replace(/_/g, " ")}{" "}
                  for {ago(statusSinceMs)}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {cancellationRequests.length > 0 && (
        <div className="rounded-2xl border-2 border-warning bg-warning/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-bold text-warning-foreground">
              <AlertTriangle className="h-5 w-5" /> {cancellationRequests.length} cancellation request
              {cancellationRequests.length > 1 ? "s" : ""} pending Service Centre review
            </p>
            <button
              type="button"
              onClick={() => setF("Cancellation Requests")}
              className="text-xs font-semibold underline text-warning-foreground hover:opacity-80 cursor-pointer"
            >
              Filter queue ({cancellationRequests.length})
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {cancellationRequests.map((cr) => {
              const statusSinceMs = new Date(cr.status_since).getTime();
              const targetId = cr.job_number || cr.id;
              return (
                <Link
                  key={cr.id}
                  to="/admin/repair/$id"
                  params={{ id: targetId }}
                  onClick={(e) => {
                    if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                      e.preventDefault();
                      void nav({
                        to: "/admin/repair/$id",
                        params: { id: targetId },
                      });
                    }
                  }}
                  className="group flex items-center gap-2 rounded-lg border border-warning/40 bg-card px-3 py-2 text-sm shadow-xs hover:border-warning hover:bg-warning/15 hover:shadow-sm active:scale-[0.99] cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
                >
                  <b className="font-mono text-foreground underline-offset-2 group-hover:underline">
                    {targetId}
                  </b>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-xs font-medium text-foreground truncate max-w-[140px]">
                    {cr.farmer?.full_name || "Farmer"}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground italic truncate max-w-[180px]">
                    "{cr.cancellation_reason || "Requested"}"
                  </span>
                  <span className="text-xs font-mono text-warning-foreground font-semibold">
                    {ago(statusSinceMs)}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-warning-foreground/70 group-hover:text-warning-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Compact Technician Workload Summary (placed near top of dashboard) */}
      {sortedTechWorkload.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">Technician workload</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {sortedTechWorkload.length} active in district
              </span>
            </div>
            {sortedTechWorkload.length > INITIAL_TECHS_COUNT && (
              <button
                type="button"
                onClick={() => setShowAllTechs(!showAllTechs)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
              >
                {showAllTechs ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" /> Show top {INITIAL_TECHS_COUNT}
                  </>
                ) : (
                  <>
                    View all {sortedTechWorkload.length} technicians <ChevronRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            )}
          </div>

          <div
            className={cn(
              "grid gap-3 sm:grid-cols-2 lg:grid-cols-4",
              showAllTechs && sortedTechWorkload.length > 8 && "max-h-[420px] overflow-y-auto pr-1"
            )}
          >
            {visibleTechs.map((tw) => (
              <div
                key={tw.t.id}
                className="flex flex-col justify-between rounded-xl border border-border bg-muted/30 p-3 shadow-xs hover:border-primary/40 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate" title={tw.techName}>
                        {tw.techName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate" title={tw.workshopName}>
                        {tw.workshopName}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        tw.isAvailable ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          tw.isAvailable ? "bg-success" : "bg-muted-foreground"
                        )}
                      />
                      {tw.isAvailable ? "Online" : "Busy"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-border/50">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium text-foreground">
                      <b className="font-display text-sm font-bold text-primary mr-1">{tw.load}</b>
                      {tw.load === 1 ? "active job" : "active jobs"}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {Math.round((tw.load / Math.max(1, open.length)) * 100)}% load
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{
                        width: `${
                          tw.load === 0
                            ? 0
                            : Math.max(6, Math.min(100, Math.round((tw.load / maxLoad) * 100)))
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
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
            {x} <span className="opacity-60">{x === "Completed" ? completed.length : x === "Cancelled" ? cancelled.length : open.filter(test[x]).length}</span>
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
              const isCancelling = r.status === "CANCELLATION_REQUESTED";
              const isCompleted = r.status === "COMPLETED";
              const isCancelled = r.status === "CANCELLED";
              const statusSinceMs = new Date(r.status_since).getTime();
              return (
                <tr
                  key={r.id}
                  className={cn(
                    "border-b border-border last:border-0",
                    isCancelling
                      ? "bg-warning/10 border-warning/30 hover:bg-warning/15"
                      : od
                      ? "bg-destructive/5"
                      : isCompleted || isCancelled
                      ? "hover:bg-muted/40"
                      : undefined
                  )}
                >
                  <td className="px-4 py-3 font-mono font-semibold">
                    {isCancelling ? (
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warning animate-pulse" />
                    ) : od ? (
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-destructive" />
                    ) : null}
                    {r.job_number || r.id}
                  </td>
                  <td className="px-4 py-3">{e ? `${e.make} ${e.model}` : "Equipment"}</td>
                  <td className="px-4 py-3">
                    <div>
                      <p>{r.farmer?.full_name || "Farmer"}</p>
                      {isCancelling && r.cancellation_reason ? (
                        <p
                          className="text-xs text-warning-foreground font-medium italic truncate max-w-[170px]"
                          title={r.cancellation_reason}
                        >
                          "{r.cancellation_reason}"
                        </p>
                      ) : isCancelled && r.cancellation_reason ? (
                        <p
                          className="text-xs text-muted-foreground font-medium italic truncate max-w-[170px]"
                          title={r.cancellation_reason}
                        >
                          "{r.cancellation_reason}"
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {t?.full_name ?? (r.status === "CANCELLED" || r.status === "COMPLETED" ? (
                      <span className="text-muted-foreground italic">Unassigned</span>
                    ) : (
                      <span className="font-semibold text-destructive">Unassigned</span>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill r={{ status: r.status, testing: r.is_testing }} audience="staff" />
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 font-mono",
                      isCancelling
                        ? "font-bold text-warning-foreground"
                        : od && "font-bold text-destructive"
                    )}
                  >
                    {ago(statusSinceMs)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to="/admin/repair/$id"
                      params={{ id: r.job_number || r.id }}
                      className={cn(
                        "inline-flex h-9 items-center gap-1 rounded-lg border px-3 font-semibold transition-colors",
                        isCancelling
                          ? "border-warning bg-warning/20 text-warning-foreground hover:bg-warning/30"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      {isCancelling
                        ? "Review"
                        : r.status === "REQUESTED" && !t
                        ? "Dispatch"
                        : "Open"} <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  )}
</div>
  );
}
