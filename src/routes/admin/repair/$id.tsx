import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertOctagon, ArrowLeft, PackageSearch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable, Timeline } from "@/components/repair-parts";
import { btn, CallButton, Card, input, Label, StatusPill } from "@/components/tb";
import { matchTechnicians } from "@/lib/matching";
import { actions, ago, isOverdue, useTB } from "@/lib/tb-store";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/repair/$id")({
  head: () => meta("Repair detail", "Inspect, dispatch and unblock a repair."),
  component: AdminRepair,
});

function AdminRepair() {
  const { id } = Route.useParams();
  const s = useTB();
  const r = s.repairs.find((x) => x.id === id);
  const [eta, setEta] = useState(r?.parts?.eta ?? "");
  if (!r)
    return (
      <Card>
        Not found.{" "}
        <Link to="/admin" className="font-semibold text-primary">
          Back
        </Link>
      </Card>
    );
  const e = s.equipment.find((x) => x.id === r.equipmentId)!;
  const f = s.farmers.find((x) => x.id === r.farmerId)!;
  const t = s.technicians.find((x) => x.id === r.technicianId);
  const matches = matchTechnicians(s.technicians, e, r);
  const od = isOverdue(r);
  return (
    <div className="space-y-5">
      <Link
        to="/admin"
        className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Pipeline
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-muted-foreground">
            {r.id} · opened {ago(r.createdAt)} ago
          </p>
          <h1 className="text-3xl font-bold">
            {e.make} {e.model}
          </h1>
          <p className="text-sm text-muted-foreground">
            {f.name} · {r.location}
          </p>
        </div>
        <StatusPill r={r} audience="staff" />
      </div>
      {od && (
        <p className="flex items-center gap-2 rounded-xl border-2 border-destructive bg-destructive/5 p-3 font-semibold text-destructive">
          <AlertOctagon className="h-5 w-5" /> Exception: in "{r.status}" for {ago(r.statusSince)} —
          intervene.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-lg font-bold">
              {t ? "Reassign technician" : "Dispatch technician"}
            </h2>
            <p className="mb-3 text-sm">
              Current: <b>{t?.name ?? "Unassigned"}</b>
              {r.declinedBy.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · declined by{" "}
                  {r.declinedBy.map((d) => s.technicians.find((x) => x.id === d)?.name).join(", ")}
                </span>
              )}
            </p>
            <div className="space-y-2">
              {matches
                .filter((m) => m.tech.id !== r.technicianId)
                .map((m) => (
                  <div
                    key={m.tech.id}
                    className="flex items-center gap-3 rounded-xl border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {m.tech.name}{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          score {m.score}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.reasons.join(" · ") || "No specialty match"} · {m.tech.distanceKm} km ·{" "}
                        {
                          s.repairs.filter(
                            (x) =>
                              x.technicianId === m.tech.id &&
                              !["COMPLETED", "CANCELLED"].includes(x.status),
                          ).length
                        }{" "}
                        open jobs
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        actions.reassign(r.id, m.tech.id);
                        toast.success(`Assigned to ${m.tech.name}`);
                      }}
                      className="h-10 shrink-0 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
                    >
                      Assign
                    </button>
                  </div>
                ))}
            </div>
          </Card>
          {r.parts && r.status === "WAITING_FOR_PARTS" && (
            <Card className="border-warning">
              <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
                <PackageSearch className="h-5 w-5" /> Parts blocker
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label>Part</Label>
                  <p className="font-semibold">{r.parts.part}</p>
                </div>
                <div>
                  <Label>Blocked for</Label>
                  <p className="font-semibold">{ago(r.parts.since)}</p>
                </div>
                <div className="col-span-2">
                  <Label>Reason</Label>
                  <p>{r.parts.reason}</p>
                </div>
                {r.parts.note && (
                  <p className="col-span-2 italic text-muted-foreground">"{r.parts.note}"</p>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <input className={input} value={eta} onChange={(ev) => setEta(ev.target.value)} />
                <button
                  onClick={() => {
                    actions.updatePartsEta(r.id, eta, "admin");
                    toast("Parts ETA updated; farmer notified");
                  }}
                  className={btn.amber}
                >
                  Update ETA
                </button>
              </div>
            </Card>
          )}
          {r.quote && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Quote</h2>
              <QuoteTable q={r.quote} />
            </Card>
          )}
          <AssessmentCard r={r} />
        </div>
        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-lg font-bold">Contacts</h2>
            <div className="grid gap-2">
              <CallButton phone={f.phone} label={`Farmer · ${f.name}`} />
              {t && <CallButton phone={t.phone} label={`Technician · ${t.name}`} />}
            </div>
          </Card>
          <Card>
            <Label>Farmer report</Label>
            <p className="text-sm">{r.symptoms.join(", ")}</p>
            <p className="mt-2 text-sm italic">"{r.description}"</p>
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-bold">Status timeline</h2>
            <Timeline r={r} />
          </Card>
          {r.status !== "COMPLETED" && r.status !== "CANCELLED" && (
            <button
              onClick={() => {
                if (confirm("Cancel this repair?")) actions.cancel(r.id);
              }}
              className={cn(btn.ghost, "w-full text-destructive")}
            >
              Cancel repair
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
