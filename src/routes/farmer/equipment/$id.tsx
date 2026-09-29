import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, ChevronRight, FileText, Tractor } from "lucide-react";
import { btn, Card, DemoTag, Label, StatusPill } from "@/components/tb";
import { fmtDate, inr, isActive, useTB } from "@/lib/tb-store";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/farmer/equipment/$id")({
  head: () => meta("Machine record", "Machine details and permanent service history."),
  component: EquipmentDetail,
});

function EquipmentDetail() {
  const { id } = Route.useParams();
  const s = useTB();
  const e = s.equipment.find((x) => x.id === id && x.farmerId === s.session!.userId);
  if (!e)
    return (
      <Card>
        <p>Machine not found.</p>
        <Link to="/farmer/equipment" className={cn(btn.ghost, "mt-3")}>
          Back
        </Link>
      </Card>
    );
  const active = s.repairs.find((r) => r.equipmentId === e.id && isActive(r));
  const recs = s.service.filter((x) => x.equipmentId === e.id).sort((a, b) => b.date - a.date);
  const spend = recs.reduce((a, r) => a + r.total, 0);
  const down = recs.reduce((a, r) => a + r.downtimeH, 0);
  return (
    <div className="space-y-5">
      <Link
        to="/farmer/equipment"
        className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All machines
      </Link>
      <div className="overflow-hidden rounded-2xl bg-soil text-soil-foreground">
        <div className="flex gap-4 p-5">
          {e.photo ? (
            <img src={e.photo} alt="" className="h-20 w-20 rounded-xl object-cover" />
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
            <p className="font-mono text-xs opacity-70">{e.serial}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 border-t border-soil-foreground/10 text-center">
          {[
            ["Year", e.year],
            ["Hours", e.hours.toLocaleString("en-IN")],
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

      {active ? (
        <Link
          to="/farmer/repair/$id"
          params={{ id: active.id }}
          className="flex items-center gap-3 rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4"
        >
          <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              Active repair <span className="font-mono">{active.id}</span>
            </p>
            <StatusPill r={active} audience="farmer" />
          </div>
          <ChevronRight className="h-5 w-5" />
        </Link>
      ) : (
        <Link
          to="/farmer/report-breakdown"
          search={{ equipment: e.id }}
          className={cn(btn.urgent, "w-full")}
        >
          <AlertTriangle className="h-5 w-5" /> Report breakdown for this machine
        </Link>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">Service history</h2>
          <DemoTag />
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
                  <h3 className="text-lg font-bold">{r.type}</h3>
                  <span className="font-mono text-sm">{fmtDate(r.date)}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {r.issue} · at {r.hours.toLocaleString("en-IN")} hrs
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <Label>Total</Label>
                    <p className="font-bold">{inr(r.total)}</p>
                  </div>
                  <div>
                    <Label>Labour</Label>
                    <p>{inr(r.labour)}</p>
                  </div>
                  <div>
                    <Label>Downtime</Label>
                    <p>{r.downtimeH} h</p>
                  </div>
                  <div>
                    <Label>Invoice</Label>
                    <p className="flex items-center gap-1 font-mono text-xs">
                      <FileText className="h-3 w-3" />
                      {r.invoice}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <Label>Parts replaced</Label>
                  <p className="text-sm">{r.parts.join(", ")}</p>
                </div>
                <div className="mt-3">
                  <Label>Technician</Label>
                  <p className="text-sm">
                    {r.technician} · {r.workshop}
                  </p>
                </div>
                {r.notes && (
                  <p className="mt-3 text-sm italic text-muted-foreground">"{r.notes}"</p>
                )}
                <p className="mt-3 rounded-lg bg-primary/8 p-2 text-sm">
                  <b>Advice:</b> {r.advice}
                </p>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
