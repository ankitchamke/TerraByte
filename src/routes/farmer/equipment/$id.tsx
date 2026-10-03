import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, FileText, Tractor } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { btn, Card, ContextualBack, Label, StatusPill } from "@/components/tb";
import { getEquipmentById, type EquipmentRow } from "@/lib/services/equipment";
import {
  getServiceHistoryForEquipment,
  type ServiceHistoryRow,
} from "@/lib/services/service-history";
import { supabase } from "@/integrations/supabase/client";
import { inr, type RepairStatus } from "@/lib/tb-store";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

interface EquipmentDetailSearch {
  from?: "home" | "list" | "repair";
  repairId?: string;
}

export const Route = createFileRoute("/farmer/equipment/$id")({
  validateSearch: (s: Record<string, unknown>): EquipmentDetailSearch => {
    const from = s["from"];
    const validFrom = from === "home" || from === "list" || from === "repair" ? from : undefined;
    return {
      from: validFrom,
      repairId: typeof s["repairId"] === "string" ? (s["repairId"] as string) : undefined,
    };
  },
  head: () => meta("Machine record", "Machine details and permanent service history."),
  component: EquipmentDetail,
});

const fmtDate = (d: string | number) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

function EquipmentDetail() {
  const { id } = Route.useParams();
  const { from, repairId } = Route.useSearch();
  const backTarget =
    from === "repair" && repairId
      ? { to: `/farmer/repair/${repairId}`, label: "Repair Ticket" }
      : from === "home"
      ? { to: "/farmer", label: "Home" }
      : { to: "/farmer/equipment", label: "All machines" };

  const [e, setE] = useState<EquipmentRow | null>(null);
  const [recs, setRecs] = useState<ServiceHistoryRow[]>([]);
  const [activeRepair, setActiveRepair] = useState<{
    id: string;
    status: RepairStatus;
    testing: boolean;
    technicianId?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [equipmentData, serviceData, activeRepairRes] = await Promise.all([
        getEquipmentById(id),
        getServiceHistoryForEquipment(id).catch(() => []),
        supabase
          .from("repair_requests")
          .select("id, job_number, status, is_testing, technician_id")
          .eq("equipment_id", id)
          .not("status", "in", '("COMPLETED","CANCELLED")')
          .maybeSingle(),
      ]);

      setE(equipmentData);
      setRecs(serviceData);

      if (activeRepairRes?.data) {
        setActiveRepair({
          id: activeRepairRes.data.job_number || activeRepairRes.data.id,
          status: activeRepairRes.data.status as RepairStatus,
          testing: activeRepairRes.data.is_testing,
          technicianId: activeRepairRes.data.technician_id,
        });
      } else {
        setActiveRepair(null);
      }
    } catch (err: any) {
      console.error("Failed to load equipment details:", err);
      setError(err?.message || "Failed to load equipment details");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-5">
        <ContextualBack to={backTarget.to} label={backTarget.label} />
        <div className="py-12 text-center text-muted-foreground">Loading machine record…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5">
        <ContextualBack to={backTarget.to} label={backTarget.label} />
        <Card className="text-destructive">
          <p>Failed to load machine record: {error}</p>
          <button onClick={() => void loadData()} className={cn(btn.ghost, "mt-3")}>
            Retry
          </button>
        </Card>
      </div>
    );
  }

  if (!e) {
    return (
      <div className="space-y-5">
        <ContextualBack to={backTarget.to} label={backTarget.label} />
        <Card>
          <p>Machine not found.</p>
          <Link to={backTarget.to as any} className={cn(btn.ghost, "mt-3")}>
            Back to {backTarget.label.toLowerCase()}
          </Link>
        </Card>
      </div>
    );
  }

  const spend = recs.reduce((a, r) => a + Number(r.total_cost || 0), 0);
  const down = recs.reduce((a, r) => a + Number(r.downtime_hours || 0), 0);

  return (
    <div className="space-y-5">
      <ContextualBack to={backTarget.to} label={backTarget.label} />
      <div className="overflow-hidden rounded-2xl bg-soil text-soil-foreground">
        <div className="flex gap-4 p-5">
          {e.photo_url ? (
            <img src={e.photo_url} alt="" className="h-20 w-20 rounded-xl object-cover" />
          ) : (
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-soil-foreground/10">
              <Tractor className="h-10 w-10" />
            </span>
          )}
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-widest opacity-60">{e.type}</p>
            <h1 className="text-3xl font-extrabold">
              {e.make} {e.model}
            </h1>
            <p className="font-mono text-xs opacity-70">{e.serial_number}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 border-t border-soil-foreground/10 text-center">
          {[
            ["Year", e.year ?? "—"],
            ["Hours", (e.operating_hours ?? 0).toLocaleString("en-IN")],
            ["Lifetime spend", inr(spend)],
            ["Downtime", `${down}h`],
          ].map(([k, v]) => (
            <div key={k} className="border-r border-soil-foreground/10 p-3 last:border-0">
              <p className="text-[10px] uppercase tracking-wider opacity-60">{k}</p>
              <p className="font-display text-lg font-bold">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {activeRepair ? (
        <Link
          to="/farmer/repair/$id"
          params={{ id: activeRepair.id }}
          search={{ from: "equipment", equipmentId: e.id }}
          className="flex items-center gap-3 rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4"
        >
          <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              Active repair <span className="font-mono">{activeRepair.id}</span>
            </p>
            <StatusPill r={activeRepair} audience="farmer" />
          </div>
          <ChevronRight className="h-5 w-5" />
        </Link>
      ) : (
        <Link
          to="/farmer/report-breakdown"
          search={{ equipment: e.id }}
          className={cn(btn.urgent, "w-full")}
        >
          <AlertTriangle className="h-6 w-6" /> Report breakdown for this machine
        </Link>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">Service history</h2>
        </div>
        {recs.length === 0 && (
          <Card className="text-sm text-muted-foreground">
            No service records yet. Completed repairs are added here automatically.
          </Card>
        )}
        <ol className="relative space-y-4 border-l-2 border-primary/30 pl-5">
          {recs.map((r) => (
            <li key={r.id} className="relative">
              <span className="absolute -left-[27px] top-5 h-3 w-3 rounded-full border-2 border-background bg-primary" />
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold">{r.service_type}</h3>
                  <span className="font-mono text-sm">{fmtDate(r.service_date)}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {r.issue_description} · at {(r.operating_hours ?? 0).toLocaleString("en-IN")} hrs
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <Label>Total</Label>
                    <p className="font-bold">{inr(Number(r.total_cost || 0))}</p>
                  </div>
                  <div>
                    <Label>Labour</Label>
                    <p>{inr(Number(r.labour_cost || 0))}</p>
                  </div>
                  <div>
                    <Label>Downtime</Label>
                    <p>{r.downtime_hours} h</p>
                  </div>
                  <div>
                    <Label>Invoice</Label>
                    <p className="flex items-center gap-1 font-mono text-xs">
                      <FileText className="h-3 w-3" />
                      {r.invoice_reference}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <Label>Parts replaced</Label>
                  <p className="text-sm">
                    {r.parts_replaced && r.parts_replaced.length > 0
                      ? r.parts_replaced.join(", ")
                      : "None"}
                  </p>
                </div>
                <div className="mt-3">
                  <Label>Technician</Label>
                  <p className="text-sm">
                    {r.technician_name} · {r.workshop_name}
                  </p>
                </div>
                {r.technician_notes && (
                  <p className="mt-3 text-sm italic text-muted-foreground">
                    "{r.technician_notes}"
                  </p>
                )}
                {r.maintenance_advice && (
                  <p className="mt-3 rounded-lg bg-primary/8 p-2 text-sm">
                    <b>Advice:</b> {r.maintenance_advice}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
