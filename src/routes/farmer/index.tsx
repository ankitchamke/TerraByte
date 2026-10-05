import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, Clock, History, Phone, Plus, Tractor } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { btn, Card, DemoTag, Label, StatusPill } from "@/components/tb";
import { useAuth } from "@/lib/auth";
import { useRepairListRealtime } from "@/hooks/use-repair-realtime";
import { getFarmerEquipment, type EquipmentRow } from "@/lib/services/equipment";
import { getFarmerRepairRequests, type RepairRequestWithEquipment } from "@/lib/services/repair-requests";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/farmer/")({
  head: () => meta("My farm", "Your machines, active repairs and breakdown reporting."),
  component: FarmerHome,
});

function FarmerHome() {
  const { profile } = useAuth();
  const farmerId = profile?.id;
  const [repairs, setRepairs] = useState<RepairRequestWithEquipment[]>([]);
  const [loadingRepairs, setLoadingRepairs] = useState(true);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);

  const fetchRepairs = useCallback(() => {
    if (!farmerId) return;
    getFarmerRepairRequests(farmerId, { activeOnly: true })
      .then((repData) => {
        setRepairs(repData);
        setLoadingRepairs(false);
      })
      .catch((err) => {
        console.error("Failed to load farmer repairs:", err);
      });
  }, [farmerId]);

  useEffect(() => {
    let mounted = true;

    // Load equipment and repair requests concurrently without blocking waterfalls
    getFarmerEquipment(farmerId)
      .then((eqData) => {
        if (!mounted) return;
        setEquipment(eqData);
        setLoadingEquipment(false);
      })
      .catch((err) => {
        console.error("Failed to load farmer equipment:", err);
        if (!mounted) return;
        setEquipment([]);
        setLoadingEquipment(false);
      });

    fetchRepairs();

    return () => {
      mounted = false;
    };
  }, [farmerId, fetchRepairs]);

  // Live synchronization of farmer's repair requests
  useRepairListRealtime({
    channelName: `farmer-repairs-${farmerId}`,
    filter: farmerId ? `farmer_id=eq.${farmerId}` : undefined,
    onUpdate: fetchRepairs,
    enabled: Boolean(farmerId),
  });

  const farmerName = profile?.full_name?.trim()
    ? profile.full_name.trim().split(" ")[0]
    : "Farmer";

  // Prioritize genuinely active repairs currently moving through the workflow.
  // Completed repairs belong in Service History and machine records.
  const active = repairs.filter(
    (r) => r.status !== "CANCELLED" && r.status !== "COMPLETED"
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Namaskar,</p>
          <h1 className="truncate text-3xl font-bold">{farmerName}</h1>
        </div>
        <DemoTag />
      </div>

      {loadingRepairs ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Checking active repairs…</div>
      ) : (
        active.map((r) => {
          const paused = r.status === "WAITING_FOR_PARTS";
          const isUnassignedRequest = r.status === "REQUESTED" && !r.technician_id;
          const needsAction =
            r.status === "QUOTE_PENDING" ||
            r.status === "QUOTE_REVISED" ||
            isUnassignedRequest;
          const assessment = (r.assessment && typeof r.assessment === "object" ? r.assessment : {}) as any;
          const partsHold = (r.parts_hold && typeof r.parts_hold === "object" ? r.parts_hold : null) as any;

          return (
            <Link
              key={r.id}
              to="/farmer/repair/$id"
              params={{ id: r.job_number || r.id }}
              className={cn(
                "block overflow-hidden rounded-2xl border-2 bg-card",
                paused
                  ? "border-warning"
                  : needsAction
                    ? "border-accent"
                    : "border-primary/40"
              )}
            >
              <div
                className={cn(
                  "flex items-center gap-2 px-5 py-2 text-sm font-semibold",
                  paused
                    ? "bg-warning text-warning-foreground"
                    : needsAction
                      ? "bg-accent text-accent-foreground"
                      : "bg-primary text-primary-foreground"
                )}
              >
                {paused ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                {needsAction ? "Action needed" : "Active repair"} ·{" "}
                <span className="font-mono">{r.job_number || r.id}</span>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-bold">
                      {r.equipment?.make || "Equipment"} {r.equipment?.model || ""}
                    </h2>
                    <p className="text-sm text-muted-foreground">{assessment.system || "Inspection required"}</p>
                  </div>
                  <StatusPill
                    r={{
                      status: r.status,
                      testing: Boolean(r.is_testing),
                      technicianId: r.technician_id,
                    }}
                    audience="farmer"
                  />
                </div>
                {paused && partsHold && (
                  <p className="mt-3 rounded-xl bg-warning/15 p-3 text-sm">
                    <b>Waiting for:</b> {partsHold.part || "Required part"}
                    <br />
                    <b>Arrives:</b> {partsHold.eta || partsHold.revisedCompletion || "Pending supplier"}
                  </p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <Label>Technician</Label>
                    <p className="font-semibold">{r.technician?.full_name ?? "Not yet assigned"}</p>
                  </div>
                  <div>
                    <Label>Expected ready</Label>
                    <p className="font-semibold">
                      {partsHold?.revisedCompletion ??
                        partsHold?.eta ??
                        (r.technician ? "In progress" : "—")}
                    </p>
                  </div>
                </div>
                <span className={cn(btn.primary, "mt-4 w-full")}>
                  {isUnassignedRequest ? "Send request to technician" : "View Repair"}{" "}
                  <ChevronRight className="h-4 w-4" />
                </span>
              </div>
            </Link>
          );
        })
      )}

      <Link
        to="/farmer/report-breakdown"
        className={cn(btn.urgent, "w-full", !loadingRepairs && active.length === 0 ? "h-24 text-xl" : "")}
      >
        <AlertTriangle className="h-6 w-6" /> Report Equipment Breakdown
      </Link>
      {!loadingRepairs && active.length === 0 && (
        <p className="-mt-3 text-center text-sm text-muted-foreground">
          All machines running. Takes under 2 minutes if something breaks.
        </p>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">My machines</h2>
          <Link
            to="/farmer/equipment"
            className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-primary"
          >
            <Plus className="h-4 w-4" /> Add / manage
          </Link>
        </div>
        {loadingEquipment ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading machines…</div>
        ) : equipment.length === 0 ? (
          <Card className="py-6 text-center text-sm text-muted-foreground">
            No machines registered yet.{" "}
            <Link to="/farmer/equipment" className="font-semibold text-primary underline">
              Add your first machine
            </Link>
          </Card>
        ) : (
          <div className="space-y-2">
            {equipment.map((e) => (
              <Link
                key={e.id}
                to="/farmer/equipment/$id"
                params={{ id: e.id }}
                search={{ from: "home" }}
                className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:border-primary/50"
              >
                {e.photo_url ? (
                  <img src={e.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-muted">
                    <Tractor className="h-7 w-7 text-muted-foreground" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {e.make} {e.model}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {e.type} · {e.year ?? "—"} · {(e.operating_hours ?? 0).toLocaleString("en-IN")} hrs
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                    e.status === "Operational"
                      ? "bg-success/15 text-success"
                      : "bg-destructive/15 text-destructive"
                  )}
                >
                  {e.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/farmer/equipment" className={btn.ghost}>
          <History className="h-4 w-4" /> Service history
        </Link>
        <a href="tel:18002001234" className={btn.ghost}>
          <Phone className="h-4 w-4" /> Helpline
        </a>
      </div>
      <Card className="bg-muted/50 text-sm text-muted-foreground">
        No signal in the field? Call the TerraByte helpline{" "}
        <b className="text-foreground">1800-200-1234</b> (demo) and we'll log the breakdown for you.
      </Card>
    </div>
  );
}
