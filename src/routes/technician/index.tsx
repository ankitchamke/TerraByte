import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Clock, Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, DemoTag, StatusPill } from "@/components/tb";
import { ago } from "@/lib/tb-store";
import { useAuth } from "@/lib/auth";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { useRepairListRealtime } from "@/hooks/use-repair-realtime";
import {
  getTechnicianRepairRequests,
  type RepairRequestWithEquipment,
} from "@/lib/services/repair-requests";
import {
  getMyTechnicianProfile,
  updateTechnicianAvailability,
  type VerifiedTechnicianWithProfile,
} from "@/lib/services/technicians";

export const Route = createFileRoute("/technician/")({
  head: () => meta("Technician jobs", "Incoming repair requests and active jobs."),
  component: TechHome,
});

function TechHome() {
  const { profile } = useAuth();
  const [techProfile, setTechProfile] = useState<VerifiedTechnicianWithProfile | null>(null);
  const [repairs, setRepairs] = useState<RepairRequestWithEquipment[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setError(null);
      const [techData, repairsData] = await Promise.all([
        getMyTechnicianProfile().catch(() => null),
        getTechnicianRepairRequests(),
      ]);
      setTechProfile(techData);
      if (techData) {
        setAvailable(Boolean(techData.is_available));
      }
      setRepairs(repairsData);
      hasLoadedRef.current = true;
    } catch (err: any) {
      console.error("[TerraByte] Failed to load technician data:", err);
      if (!hasLoadedRef.current) {
        setError(err?.message || "Failed to load technician jobs");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Live synchronization of technician's incoming and active jobs
  useRepairListRealtime({
    channelName: `technician-pipeline-${profile?.id || "tech"}`,
    onUpdate: loadData,
    enabled: Boolean(profile?.id),
  });

  const handleToggleAvailability = async (v: boolean) => {
    try {
      await updateTechnicianAvailability(v);
      setAvailable(v);
      toast.success(v ? "Status updated to Online" : "Status updated to Busy");
    } catch (err: any) {
      toast.error(err?.message || "Failed to update availability");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="py-12 text-center text-muted-foreground">Loading technician jobs…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Card className="text-destructive">
          <p>Failed to load jobs: {error}</p>
          <button onClick={() => void loadData()} className="mt-3 inline-block font-semibold underline">
            Retry
          </button>
        </Card>
      </div>
    );
  }

  const incoming = repairs.filter((r) => r.status === "REQUESTED");
  const onHold = repairs.filter((r) => r.status === "CANCELLATION_REQUESTED");
  const active = repairs.filter((r) =>
    ["ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED", "IN_PROGRESS", "WAITING_FOR_PARTS"].includes(r.status)
  );
  const done = repairs.filter((r) => r.status === "COMPLETED");
  const cancelled = repairs.filter((r) => r.status === "CANCELLED");

  const techName = profile?.full_name?.trim() || "Technician";
  const workshopName = techProfile?.workshop_name || "Field Workshop";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold">{techName}</h1>
          <p className="text-sm text-muted-foreground">{workshopName}</p>
        </div>
        <DemoTag />
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1.5">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            onClick={() => void handleToggleAvailability(v)}
            className={cn(
              "h-14 rounded-xl text-lg font-bold",
              available === v
                ? v
                  ? "bg-success text-primary-foreground"
                  : "bg-foreground text-background"
                : "text-muted-foreground"
            )}
          >
            {v ? "● Online" : "Busy"}
          </button>
        ))}
      </div>
      <Section
        title={`Incoming requests (${incoming.length})`}
        list={incoming}
        empty="No new requests. Stay online to receive jobs."
        urgent
      />
      {onHold.length > 0 && (
        <Section
          title={`On hold · Cancellation pending (${onHold.length})`}
          list={onHold}
          empty=""
          onHold
        />
      )}
      <Section title={`Active jobs (${active.length})`} list={active} empty="No active jobs." />
      {done.length > 0 && <Section title={`Completed (${done.length})`} list={done} empty="" />}
      {cancelled.length > 0 && (
        <Section title={`Cancelled (${cancelled.length})`} list={cancelled} empty="" isCancelled />
      )}
    </div>
  );
}

function Section({
  title,
  list,
  empty,
  urgent,
  onHold,
  isCancelled,
}: {
  title: string;
  list: RepairRequestWithEquipment[];
  empty: string;
  urgent?: boolean;
  onHold?: boolean;
  isCancelled?: boolean;
}) {
  return (
    <div>
      <h2
        className={cn(
          "mb-3 text-xl font-bold",
          onHold && "text-warning-foreground flex items-center gap-2",
          isCancelled && "text-muted-foreground"
        )}
      >
        {onHold && <Clock className="h-5 w-5 text-warning shrink-0" />}
        {title}
      </h2>
      {list.length === 0 && (
        <Card className="flex items-center gap-3 text-sm text-muted-foreground">
          <Inbox className="h-5 w-5" />
          {empty}
        </Card>
      )}
      <div className="space-y-2">
        {list.map((r) => {
          const e = r.equipment;
          const statusSinceMs = new Date(r.status_since).getTime();
          return (
            <Link
              key={r.id}
              to="/technician/job/$id"
              params={{ id: r.job_number || r.id }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border-2 bg-card p-4 transition-colors",
                onHold
                  ? "border-warning/70 bg-warning/10 hover:bg-warning/15 shadow-xs"
                  : isCancelled
                  ? "border-border bg-muted/40 hover:bg-muted/60 opacity-80"
                  : urgent
                  ? "border-accent"
                  : "border-border hover:border-border/80"
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-xs text-muted-foreground">
                    {r.job_number || r.id} · {ago(statusSinceMs)} in status
                  </p>
                  {onHold && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
                      Work on hold
                    </span>
                  )}
                </div>
                <p className="truncate text-lg font-bold">
                  {e ? `${e.make} ${e.model}` : "Equipment"}
                </p>
                {onHold ? (
                  <p className="truncate text-sm text-warning-foreground font-medium italic">
                    Reason: "{r.cancellation_reason || "Cancellation requested"}" · Pending Service Centre review
                  </p>
                ) : isCancelled && r.cancellation_reason ? (
                  <p className="truncate text-sm text-muted-foreground italic">
                    Cancelled: "{r.cancellation_reason}"
                  </p>
                ) : (
                  <p className="truncate text-sm text-muted-foreground">
                    {r.symptoms.join(", ")} · {r.location}
                  </p>
                )}
                <div className="mt-1.5">
                  <StatusPill r={{ status: r.status, testing: r.is_testing }} audience="staff" />
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
