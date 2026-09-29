import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Loader2, PackageSearch, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable, TechCard, Timeline } from "@/components/repair-parts";
import { btn, CallButton, Card, input, Label, StatusPill, Stepper } from "@/components/tb";
import { matchTechnicians } from "@/lib/matching";
import { actions, ago, fmtTime, inr, quoteTotals, useTB } from "@/lib/tb-store";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/farmer/repair/$id")({
  head: () => meta("Repair Hub", "Live status of your machine's repair."),
  component: RepairHub,
});

function RepairHub() {
  const { id } = Route.useParams();
  const s = useTB();
  const r = s.repairs.find((x) => x.id === id && x.farmerId === s.session!.userId);
  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  if (!r)
    return (
      <Card>
        Repair not found.{" "}
        <Link to="/farmer" className="font-semibold text-primary">
          Go home
        </Link>
      </Card>
    );
  const e = s.equipment.find((x) => x.id === r.equipmentId)!;
  const t = s.technicians.find((x) => x.id === r.technicianId);
  const lastNote = r.notes[r.notes.length - 1];

  return (
    <div className="space-y-5">
      <Link
        to="/farmer"
        className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Home
      </Link>
      <div>
        <p className="font-mono text-sm text-muted-foreground">
          {r.id} · reported {ago(r.createdAt)} ago
        </p>
        <h1 className="text-3xl font-bold">
          {e.make} {e.model}
        </h1>
        <div className="mt-2">
          <StatusPill r={r} audience="farmer" />
        </div>
      </div>

      {r.status === "WAITING_FOR_PARTS" && r.parts && (
        <section className="overflow-hidden rounded-2xl border-2 border-warning bg-card">
          <div className="flex items-center gap-2 bg-warning px-5 py-3 font-display text-lg font-bold text-warning-foreground">
            <PackageSearch className="h-5 w-5" /> Repair paused — waiting for spare part
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <Label>Missing part</Label>
              <p className="text-lg font-bold">{r.parts.part}</p>
            </div>
            <div>
              <Label>Expected arrival</Label>
              <p className="text-lg font-bold">{r.parts.eta}</p>
            </div>
            <div className="sm:col-span-2">
              <Label>Why paused</Label>
              <p>{r.parts.reason}</p>
            </div>
            {r.parts.note && (
              <p className="rounded-xl bg-muted p-3 text-sm italic sm:col-span-2">
                "{r.parts.note}" — {t?.name}
              </p>
            )}
            <div className="sm:col-span-2">
              <Label>Revised completion</Label>
              <p className="font-semibold">{r.parts.revisedCompletion}</p>
            </div>
          </div>
        </section>
      )}

      {r.status === "REQUESTED" && !r.technicianId && <AssessmentCard r={r} />}
      {r.status === "REQUESTED" && !r.technicianId && (
        <div className="space-y-3">
          <div>
            <h2 className="text-xl font-bold">Best-matched technicians</h2>
            <p className="text-sm text-muted-foreground">
              Ranked by {e.make} experience, {r.assessment.skill.toLowerCase()} expertise,
              availability, then distance. Demo profiles.
            </p>
          </div>
          {r.declinedBy.length > 0 && (
            <p className="rounded-xl bg-warning/15 p-3 text-sm">
              A technician couldn't take this job. Please choose another — the service centre has
              also been alerted.
            </p>
          )}
          {matchTechnicians(s.technicians, e, r).map((m, i) => (
            <TechCard key={m.tech.id} t={m.tech} reasons={m.reasons}>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    actions.requestTechnician(r.id, m.tech.id);
                    toast.success(`Request sent to ${m.tech.name}`);
                  }}
                  className={cn(i === 0 ? btn.primary : btn.ghost, "flex-1")}
                >
                  Request Repair{i === 0 && " · Best match"}
                </button>
                <CallButton phone={m.tech.phone} label="" className="w-12 px-0" />
              </div>
            </TechCard>
          ))}
        </div>
      )}

      {r.status === "REQUESTED" && t && (
        <Card className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <div>
            <p className="font-semibold">Waiting for {t.name} to accept</p>
            <p className="text-sm text-muted-foreground">
              Usually within 15 minutes. We'll notify you.
            </p>
          </div>
        </Card>
      )}

      {r.status === "QUOTE_PENDING" && r.quote && (
        <section className="rounded-2xl border-2 border-accent bg-card p-5">
          <h2 className="text-2xl font-bold">Review your repair quote</h2>
          <p className="mb-4 mt-1 flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-sm font-semibold text-primary">
            <ShieldCheck className="h-5 w-5 shrink-0" /> No work or charges start until you approve
            this quote.
          </p>
          <QuoteTable q={r.quote} />
          {!declining ? (
            <div className="mt-5 grid gap-2">
              <button
                onClick={() => {
                  actions.approveQuote(r.id);
                  toast.success("Repair authorized. Technician notified.");
                }}
                className={cn(btn.primary, "h-14 text-lg")}
              >
                Approve & Authorize Repair · {inr(quoteTotals(r.quote).total)}
              </button>
              <div className="grid grid-cols-2 gap-2">
                {t && <CallButton phone={t.phone} label="Call to discuss" />}
                <button onClick={() => setDeclining(true)} className={btn.ghost}>
                  Decline quote
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-2">
              <Label>What should the technician change?</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  "Too expensive",
                  "Want local (non-OEM) parts",
                  "Need earlier completion",
                  "Please explain labour",
                ].map((x) => (
                  <button
                    key={x}
                    onClick={() => setReason(x)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm",
                      reason === x ? "border-primary bg-primary/10" : "border-border",
                    )}
                  >
                    {x}
                  </button>
                ))}
              </div>
              <input
                className={input}
                maxLength={200}
                value={reason}
                onChange={(ev) => setReason(ev.target.value)}
                placeholder="Short reason"
              />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setDeclining(false)} className={btn.ghost}>
                  Back
                </button>
                <button
                  disabled={!reason.trim()}
                  onClick={() => {
                    actions.declineQuote(r.id, reason.trim());
                    setDeclining(false);
                    toast("Sent to technician for revision");
                  }}
                  className={btn.amber}
                >
                  Send for revision
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {r.status === "QUOTE_REVISED" && (
        <Card className="border-accent">
          <p className="font-semibold">The technician is revising the quote.</p>
          <p className="text-sm text-muted-foreground">Your note: "{r.clarification}"</p>
        </Card>
      )}

      {r.status === "COMPLETED" && r.quote && (
        <section className="overflow-hidden rounded-2xl border-2 border-success bg-card">
          <div className="flex items-center gap-2 bg-success px-5 py-3 font-display text-lg font-bold text-primary-foreground">
            <CheckCircle2 className="h-5 w-5" /> Repair Complete & Verified
          </div>
          <div className="space-y-4 p-5">
            {r.completion?.photo && (
              <img
                src={r.completion.photo}
                alt="Completion proof"
                className="max-h-60 w-full rounded-xl object-cover"
              />
            )}
            <div>
              <Label>Work performed</Label>
              <p>{r.completion?.notes}</p>
            </div>
            <div>
              <Label>Parts replaced</Label>
              <p>{r.quote.parts.map((p) => p.name).join(", ")}</p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <Label>Labour</Label>
                <p className="font-semibold">{inr(r.quote.labour)}</p>
              </div>
              <div>
                <Label>Final amount</Label>
                <p className="font-display text-xl font-bold">{inr(quoteTotals(r.quote).total)}</p>
              </div>
              <div>
                <Label>Completed</Label>
                <p className="font-semibold">{r.completion && fmtTime(r.completion.at)}</p>
              </div>
            </div>
            <p className="text-sm">
              Technician: <b>{t?.name}</b> · {t?.workshop}
            </p>
            {r.verifiedAt ? (
              <p className="rounded-xl bg-success/15 p-3 text-sm font-semibold text-success">
                Handover confirmed {fmtTime(r.verifiedAt)}. Saved to the machine's service history.
              </p>
            ) : (
              <button
                onClick={() => {
                  actions.verify(r.id);
                  toast.success("Handover confirmed. Back to work!");
                }}
                className={cn(btn.primary, "h-14 w-full text-lg")}
              >
                Confirm machine received & working
              </button>
            )}
            <Link
              to="/farmer/equipment/$id"
              params={{ id: e.id }}
              className={cn(btn.ghost, "w-full")}
            >
              View service history
            </Link>
          </div>
        </section>
      )}

      {t && r.status !== "REQUESTED" && (
        <TechCard t={t}>
          <div className="mt-4 grid grid-cols-1">
            <CallButton phone={t.phone} label={`Call ${t.name.split(" ")[0]}`} />
          </div>
        </TechCard>
      )}

      {lastNote && r.status !== "COMPLETED" && (
        <Card>
          <Label>Latest note from technician · {ago(lastNote.at)} ago</Label>
          <p>{lastNote.text}</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-4 text-lg font-bold">Progress</h2>
        <Stepper r={r} />
      </Card>

      {r.quote && !["QUOTE_PENDING", "COMPLETED"].includes(r.status) && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">Approved quote</h2>
          <QuoteTable q={r.quote} />
        </Card>
      )}

      {r.status !== "REQUESTED" && r.status !== "COMPLETED" && <AssessmentCard r={r} compact />}

      <details className="rounded-2xl border border-border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Full activity log</summary>
        <div className="mt-4">
          <Timeline r={r} />
        </div>
      </details>

      {["REQUESTED", "ACCEPTED"].includes(r.status) && (
        <button
          onClick={() => {
            if (confirm("Cancel this repair request?")) actions.cancel(r.id);
          }}
          className="w-full py-3 text-sm text-muted-foreground underline"
        >
          Cancel request
        </button>
      )}
    </div>
  );
}
