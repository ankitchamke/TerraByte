import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertOctagon, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { DemoTag, StatusPill } from "@/components/tb";
import { ago, isOverdue, useTB, type Repair } from "@/lib/tb-store";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({
  head: () => meta("Operations", "Service centre repair pipeline, exceptions and parts blockers."),
  component: Admin,
});

const FILTERS = ["All", "Unassigned", "Awaiting Quote", "Waiting for Parts", "Overdue"] as const;
type F = (typeof FILTERS)[number];
const test: Record<F, (r: Repair) => boolean> = {
  All: () => true,
  Unassigned: (r) => r.status === "REQUESTED",
  "Awaiting Quote": (r) => ["ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED"].includes(r.status),
  "Waiting for Parts": (r) => r.status === "WAITING_FOR_PARTS",
  Overdue: isOverdue,
};

function Admin() {
  const s = useTB();
  const [f, setF] = useState<F>("All");
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(i); }, []);
  const open = s.repairs.filter((r) => !["CANCELLED"].includes(r.status) && !(r.status === "COMPLETED" && r.verifiedAt));
  const done = s.service.filter((x) => x.downtimeH);
  const avgDown = done.length ? (done.reduce((a, x) => a + x.downtimeH, 0) / done.length).toFixed(1) : "—";
  const exceptions = open.filter(isOverdue);
  const metrics = [
    { k: "Unassigned / open requests", v: open.filter(test.Unassigned).length, tone: "text-info" },
    { k: "Active repairs", v: open.filter((r) => ["IN_PROGRESS", "ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED"].includes(r.status)).length, tone: "text-primary" },
    { k: "Waiting for parts", v: open.filter(test["Waiting for Parts"]).length, tone: "text-warning-foreground" },
    { k: "Avg. downtime (hrs)", v: avgDown, tone: "text-foreground" },
  ];
  const rows = open.filter(test[f]).sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || a.statusSince - b.statusSince);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Nashik district · live</p><h1 className="text-3xl font-bold">Repair operations</h1></div>
        <div className="flex items-center gap-3">
          <Link to="/admin/technicians" className="inline-flex h-10 items-center gap-1 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted">Technician accounts <ChevronRight className="h-4 w-4" /></Link>
          <DemoTag />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => <div key={m.k} className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{m.k}</p><p className={cn("font-display text-4xl font-extrabold", m.tone)}>{m.v}</p></div>)}
      </div>
      {exceptions.length > 0 && (
        <div className="rounded-2xl border-2 border-destructive bg-destructive/5 p-4">
          <p className="mb-2 flex items-center gap-2 font-bold text-destructive"><AlertOctagon className="h-5 w-5" /> {exceptions.length} operational exception{exceptions.length > 1 ? "s" : ""}</p>
          <div className="flex flex-wrap gap-2">{exceptions.map((r) => <Link key={r.id} to="/admin/repair/$id" params={{ id: r.id }} className="rounded-lg bg-card px-3 py-2 text-sm"><b className="font-mono">{r.id}</b> · {r.status === "REQUESTED" ? "unaccepted" : r.status.toLowerCase().replace(/_/g, " ")} for {ago(r.statusSince)}</Link>)}</div>
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((x) => <button key={x} onClick={() => setF(x)} className={cn("h-10 shrink-0 rounded-full border px-4 text-sm font-semibold", f === x ? "border-foreground bg-foreground text-background" : "border-border bg-card")}>{x} <span className="opacity-60">{open.filter(test[x]).length}</span></button>)}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>{["Job", "Machine", "Farmer", "Technician", "Status", "Time in status", ""].map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No jobs in this view.</td></tr>}
            {rows.map((r) => {
              const e = s.equipment.find((x) => x.id === r.equipmentId)!;
              const t = s.technicians.find((x) => x.id === r.technicianId);
              const od = isOverdue(r);
              return (
                <tr key={r.id} className={cn("border-b border-border last:border-0", od && "bg-destructive/5")}>
                  <td className="px-4 py-3 font-mono font-semibold">{od && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-destructive" />}{r.id}</td>
                  <td className="px-4 py-3">{e.make} {e.model}</td>
                  <td className="px-4 py-3">{s.farmers.find((x) => x.id === r.farmerId)?.name}</td>
                  <td className="px-4 py-3">{t?.name ?? <span className="font-semibold text-destructive">Unassigned</span>}</td>
                  <td className="px-4 py-3"><StatusPill r={r} audience="staff" /></td>
                  <td className={cn("px-4 py-3 font-mono", od && "font-bold text-destructive")}>{ago(r.statusSince)}</td>
                  <td className="px-4 py-3 text-right"><Link to="/admin/repair/$id" params={{ id: r.id }} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 font-semibold hover:bg-muted">{r.status === "REQUESTED" && !t ? "Dispatch" : "Open"} <ChevronRight className="h-4 w-4" /></Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <h2 className="mb-3 text-xl font-bold">Technician workload</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {s.technicians.map((t) => {
            const load = open.filter((r) => r.technicianId === t.id).length;
            return <div key={t.id} className="rounded-2xl border border-border bg-card p-4"><p className="font-semibold">{t.name}</p><p className="text-xs text-muted-foreground">{t.workshop}</p><div className="mt-2 flex items-center justify-between"><span className={cn("text-xs font-semibold", t.available ? "text-success" : "text-muted-foreground")}>{t.available ? "Online" : "Busy"}</span><span className="font-display text-2xl font-bold">{load}</span></div><div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, load * 33)}%` }} /></div></div>;
          })}
        </div>
      </div>
    </div>
  );
}
