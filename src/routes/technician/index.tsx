import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Inbox } from "lucide-react";
import { Card, DemoTag, StatusPill } from "@/components/tb";
import { actions, ago, useTB, type Repair } from "@/lib/tb-store";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/technician/")({
  head: () => meta("Technician jobs", "Incoming repair requests and active jobs."),
  component: TechHome,
});

function TechHome() {
  const s = useTB();
  const me = s.technicians.find((t) => t.id === s.session!.userId)!;
  const mine = s.repairs.filter((r) => r.technicianId === me.id);
  const incoming = mine.filter((r) => r.status === "REQUESTED");
  const active = mine.filter((r) => !["REQUESTED", "COMPLETED", "CANCELLED"].includes(r.status));
  const done = mine.filter((r) => r.status === "COMPLETED");
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold">{me.name}</h1>
          <p className="text-sm text-muted-foreground">{me.workshop}</p>
        </div>
        <DemoTag />
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1.5">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            onClick={() => actions.setAvailability(me.id, v)}
            className={cn(
              "h-14 rounded-xl text-lg font-bold",
              me.available === v
                ? v
                  ? "bg-success text-primary-foreground"
                  : "bg-foreground text-background"
                : "text-muted-foreground",
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
  list: Repair[];
  empty: string;
  urgent?: boolean;
}) {
  const s = useTB();
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
          const e = s.equipment.find((x) => x.id === r.equipmentId)!;
          return (
            <Link
              key={r.id}
              to="/technician/job/$id"
              params={{ id: r.id }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border-2 bg-card p-4",
                urgent ? "border-accent" : "border-border",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-muted-foreground">
                  {r.id} · {ago(r.statusSince)} in status
                </p>
                <p className="truncate text-lg font-bold">
                  {e.make} {e.model}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {r.symptoms.join(", ")} · {r.location}
                </p>
                <div className="mt-1.5">
                  <StatusPill r={r} audience="staff" />
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
