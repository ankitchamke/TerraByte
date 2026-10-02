import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Inbox } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, DemoTag, StatusPill } from "@/components/tb";
import { ago } from "@/lib/tb-store";
import { useAuth } from "@/lib/auth";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
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

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
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
    } catch (err: any) {
      console.error("[TerraByte] Failed to load technician data:", err);
      setError(err?.message || "Failed to load technician jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
  const active = repairs.filter((r) =>
    ["ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED", "IN_PROGRESS", "WAITING_FOR_PARTS"].includes(r.status)
  );
  const done = repairs.filter((r) => r.status === "COMPLETED");

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
      <Section title={`Active jobs (${active.length})`} list={active} empty="No active jobs." />
      {done.length > 0 && <Section title="Completed" list={done} empty="" />}
    </div>
  );
}

function Section({
  title,
  list,
  empty,
  urgent,
}: {
  title: string;
  list: RepairRequestWithEquipment[];
  empty: string;
  urgent?: boolean;
}) {
  return (
    <div>
      <h2 className="mb-3 text-xl font-bold">{title}</h2>
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
                "flex items-center gap-3 rounded-2xl border-2 bg-card p-4",
                urgent ? "border-accent" : "border-border"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-muted-foreground">
                  {r.job_number || r.id} · {ago(statusSinceMs)} in status
                </p>
                <p className="truncate text-lg font-bold">
                  {e ? `${e.make} ${e.model}` : "Equipment"}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {r.symptoms.join(", ")} · {r.location}
                </p>
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
