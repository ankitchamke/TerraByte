import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { AlertOctagon, ChevronRight, Layers, MapPin } from "lucide-react";
import {
  clusterRepairsByTahsil,
  type ClusterRepairsResult,
  type TahsilCluster,
} from "@/lib/services/circuit-optimizer";
import type { RepairRequestDetail } from "@/lib/services/repair-requests";
import { cn } from "@/lib/utils";

export interface AdminTalukaClustersProps {
  repairs: RepairRequestDetail[];
  className?: string;
  selectedTahsil?: string | null;
  onSelectTahsil?: (tahsil: string | null) => void;
}

/**
 * Service Centre Taluka Breakdown Clusters Widget
 *
 * Groups unassigned open doorstep breakdown requests into geographic taluka clusters across
 * the 14 Nagpur District Tahsils, highlighting emergency field stoppages so dispatchers
 * can identify rural breakdown concentrations and dispatch proximate travelling mechanics.
 */
export function AdminTalukaClusters({
  repairs,
  className,
  selectedTahsil,
  onSelectTahsil,
}: AdminTalukaClustersProps) {
  // 1. Filter only open, unassigned doorstep repair requests
  const eligibleRepairs = useMemo(() => {
    return (repairs || []).filter(
      (r) =>
        r.status === "REQUESTED" &&
        !r.technician_id &&
        (r.service_type || "DOORSTEP") === "DOORSTEP",
    );
  }, [repairs]);

  // 2. Cluster open repairs by normalized Nagpur tahsil
  const clusterResult: ClusterRepairsResult<RepairRequestDetail> = useMemo(() => {
    return clusterRepairsByTahsil<RepairRequestDetail>(eligibleRepairs);
  }, [eligibleRepairs]);

  const { clusterList, totalEligibleDoorstepRepairs } = clusterResult;

  // Compute total critical stopped machines across all active clusters
  const totalCriticalStopped = useMemo(() => {
    return clusterList.reduce((acc, c) => acc + c.criticalStoppedCount, 0);
  }, [clusterList]);

  return (
    <div
      className={cn("space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xs", className)}
      data-testid="admin-taluka-clusters"
    >
      {/* Widget Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Taluka Breakdown Clusters</h2>
            <p className="text-xs text-muted-foreground">
              Geographic concentration of open doorstep breakdown requests in Nagpur District
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {totalCriticalStopped > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 border border-destructive/30 px-2.5 py-0.5 text-xs font-bold text-destructive"
              title="Machines completely halted in field requiring immediate mobile dispatch"
            >
              <AlertOctagon className="h-3.5 w-3.5" />
              <span>
                {totalCriticalStopped} Emergency Stoppage{totalCriticalStopped > 1 ? "s" : ""}
              </span>
            </span>
          )}

          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            {totalEligibleDoorstepRepairs} open doorstep{" "}
            {totalEligibleDoorstepRepairs === 1 ? "request" : "requests"} · {clusterList.length}{" "}
            {clusterList.length === 1 ? "cluster" : "clusters"}
          </span>

          {selectedTahsil && (
            <button
              type="button"
              onClick={() => onSelectTahsil?.(null)}
              className="text-xs font-semibold text-primary underline hover:opacity-80 cursor-pointer"
            >
              Clear tahsil filter
            </button>
          )}
        </div>
      </div>

      {/* Empty State */}
      {clusterList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          <MapPin className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
          <p className="font-semibold text-foreground">No open doorstep requests to cluster</p>
          <p className="mt-1 text-xs text-muted-foreground">
            All incoming doorstep repair requests across Nagpur tahsils have been assigned or
            resolved.
          </p>
        </div>
      ) : (
        /* Cluster Cards Grid */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clusterList.map((cluster: TahsilCluster<RepairRequestDetail>) => {
            const hasEmergency = cluster.criticalStoppedCount > 0;
            const isSelected = selectedTahsil === cluster.tahsil;
            const displayName = cluster.tahsil === "Unknown" ? "Unknown Area" : cluster.tahsil;

            return (
              <div
                key={cluster.tahsil}
                className={cn(
                  "flex flex-col justify-between rounded-xl border p-3.5 transition-all text-left shadow-xs",
                  hasEmergency
                    ? "border-destructive/40 bg-destructive/5 hover:border-destructive hover:shadow-sm"
                    : "border-border bg-card hover:border-primary/50 hover:bg-muted/30",
                  isSelected && "ring-2 ring-primary border-primary",
                )}
                data-tahsil={cluster.tahsil}
              >
                <div>
                  {/* Cluster Title, Count, & Emergency Pill */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <MapPin
                          className={cn(
                            "h-4 w-4 shrink-0",
                            hasEmergency ? "text-destructive" : "text-primary",
                          )}
                        />
                        <h3 className="font-bold text-sm sm:text-base text-foreground truncate">
                          {displayName}
                        </h3>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground font-medium">
                        {cluster.count} {cluster.count === 1 ? "open repair" : "open repairs"}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      {hasEmergency ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-bold text-destructive">
                          <AlertOctagon className="h-3 w-3" />
                          <span>{cluster.criticalStoppedCount} stopped</span>
                        </span>
                      ) : (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          {cluster.count} open
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Urgency Breakdown Chips */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1 text-[11px]">
                    {cluster.criticalCount > 0 && (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-bold text-destructive">
                        {cluster.criticalCount} Critical
                      </span>
                    )}
                    {cluster.highCount > 0 && (
                      <span className="rounded bg-warning/20 px-1.5 py-0.5 font-semibold text-warning-foreground">
                        {cluster.highCount} High
                      </span>
                    )}
                    {cluster.standardCount > 0 && (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                        {cluster.standardCount} Standard
                      </span>
                    )}
                    {cluster.flexibleCount > 0 && (
                      <span className="rounded bg-muted/60 px-1.5 py-0.5 font-medium text-muted-foreground/80">
                        {cluster.flexibleCount} Flexible
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick Repair Tickets in Cluster */}
                <div className="mt-3 border-t border-border/50 pt-2 space-y-1.5">
                  <div className="space-y-1">
                    {cluster.repairs.slice(0, 3).map((r) => {
                      const targetId = r.job_number || r.id;
                      const isStopped =
                        r.urgency_level === "CRITICAL" && Boolean(r.is_machine_stopped);
                      return (
                        <Link
                          key={r.id}
                          to="/admin/repair/$id"
                          params={{ id: targetId }}
                          className="group flex items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-muted/70"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isStopped ? (
                              <AlertOctagon className="h-3 w-3 text-destructive shrink-0" />
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            )}
                            <span className="font-mono font-bold text-primary underline-offset-2 group-hover:underline">
                              {targetId}
                            </span>
                            <span className="text-muted-foreground truncate max-w-[130px]">
                              {r.equipment
                                ? `${r.equipment.make} ${r.equipment.model}`
                                : "Machinery"}
                            </span>
                          </div>

                          <span className="text-[11px] text-muted-foreground group-hover:text-foreground flex items-center gap-0.5 shrink-0">
                            Dispatch <ChevronRight className="h-3 w-3" />
                          </span>
                        </Link>
                      );
                    })}
                  </div>

                  {cluster.repairs.length > 3 && (
                    <p className="text-[11px] text-muted-foreground text-center pt-0.5 italic">
                      +{cluster.repairs.length - 3} more in {displayName}
                    </p>
                  )}

                  {onSelectTahsil && (
                    <button
                      type="button"
                      onClick={() => onSelectTahsil(isSelected ? null : cluster.tahsil)}
                      className="mt-1 w-full text-center text-[11px] font-semibold text-primary hover:underline cursor-pointer py-0.5"
                    >
                      {isSelected ? "Clear filter" : `Filter queue for ${displayName}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
