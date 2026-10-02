import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Loader2, PackageSearch, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable, TechCard, Timeline } from "@/components/repair-parts";
import { btn, CallButton, Card, input, Label, StatusPill, Stepper } from "@/components/tb";
import {
  cancelRepairRequest,
  getRepairRequestById,
  type RepairRequestDetail,
} from "@/lib/services/repair-requests";
import {
  approveQuote,
  getQuotesForRepair,
  rejectQuote,
  type QuoteDetail,
} from "@/lib/services/quotes";
import { getRepairNotes, type RepairNoteWithAuthor } from "@/lib/services/repair-notes";
import {
  assignTechnician,
  getAssignedTechnician,
  getEligibleTechnicians,
  type ScoredTechnicianMatch,
  type VerifiedTechnicianWithProfile,
} from "@/lib/services/technicians";
import { ago, fmtTime, inr, quoteTotals, type Quote, type Technician } from "@/lib/tb-store";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/farmer/repair/$id")({
  head: () => meta("Repair Hub", "Live status of your machine's repair."),
  component: RepairHub,
});

function toQuoteView(q: QuoteDetail): Quote {
  return {
    parts: (q.quote_items || []).map((item) => ({
      name: item.part_name,
      spec: item.part_spec || "OEM Standard",
      qty: item.quantity,
      price: Number(item.unit_price),
      source: item.part_source || "Taluka Distributor",
    })),
    labourDesc: q.labour_description || "Inspection & service labour",
    labour: Number(q.labour_amount),
    taxPct: Number(q.tax_percent),
    eta: q.estimated_completion || "TBD",
    warranty: q.warranty_terms || "90 days on parts & labour",
    version: q.version,
    sentAt: new Date(q.created_at).getTime(),
  };
}

function formatTechCardData(t: VerifiedTechnicianWithProfile): Technician {
  return {
    id: t.profile_id,
    name: t.profile?.full_name || "Technician",
    workshop: t.workshop_name || "Authorized Service Centre",
    brands: t.brands || [],
    skills: t.skills || [],
    verified: Boolean(t.is_verified),
    distanceKm: t.distance_km ?? 0,
    etaMin: t.eta_minutes ?? 45,
    available: Boolean(t.is_available),
    rating: Number(t.rating ?? 4.8),
    jobsDone: t.jobs_completed ?? 0,
    phone: t.profile?.phone || t.phone || "",
  };
}

function RepairHub() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [r, setR] = useState<RepairRequestDetail | null>(null);
  const [quotes, setQuotes] = useState<QuoteDetail[]>([]);
  const [notes, setNotes] = useState<RepairNoteWithAuthor[]>([]);
  const [assignedTech, setAssignedTech] = useState<VerifiedTechnicianWithProfile | null>(null);
  const [eligibleTechs, setEligibleTechs] = useState<ScoredTechnicianMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [assigningTechId, setAssigningTechId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const repairData = await getRepairRequestById(id);
      if (!repairData) {
        setR(null);
        return;
      }
      setR(repairData);

      const [quotesData, notesData, assignedTechData, eligibleTechsData] = await Promise.all([
        getQuotesForRepair(repairData.id).catch(() => []),
        getRepairNotes(repairData.id).catch(() => []),
        repairData.technician_id
          ? getAssignedTechnician(repairData.id).catch(() => null)
          : Promise.resolve(null),
        repairData.status === "REQUESTED" && !repairData.technician_id
          ? getEligibleTechnicians(repairData.id).catch(() => [])
          : Promise.resolve([]),
      ]);

      setQuotes(quotesData);
      setNotes(notesData);
      setAssignedTech(assignedTechData);
      setEligibleTechs(eligibleTechsData);
    } catch (err: any) {
      console.error("[TerraByte] Failed to load repair details:", err);
      setError(err?.message || "Failed to load repair details");
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
        <Link
          to="/farmer"
          className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <div className="py-12 text-center text-muted-foreground">Loading repair details…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5">
        <Link
          to="/farmer"
          className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <Card className="text-destructive">
          <p>Failed to load repair: {error}</p>
          <button onClick={() => void loadData()} className={cn(btn.ghost, "mt-3")}>
            Retry
          </button>
        </Card>
      </div>
    );
  }

  if (!r) {
    return (
      <div className="space-y-5">
        <Link
          to="/farmer"
          className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <Card>
          <p>Repair not found.</p>
          <Link to="/farmer" className="mt-2 inline-block font-semibold text-primary">
            Go home
          </Link>
        </Card>
      </div>
    );
  }

  const e = r.equipment;
  const assignedTechData: Technician | null = assignedTech
    ? formatTechCardData(assignedTech)
    : r.technician
      ? {
          id: r.technician.id,
          name: r.technician.full_name || "Technician",
          workshop: "Authorized Service Centre",
          brands: [],
          skills: [],
          verified: true,
          distanceKm: 0,
          etaMin: 45,
          available: true,
          rating: 4.8,
          jobsDone: 0,
          phone: r.technician.phone || "",
        }
      : null;

  const lastNote = notes[notes.length - 1];
  const partsHold = (r.parts_hold as any) || null;
  const completion = (r.completion_details as any) || null;

  const pendingQuote = quotes.find((q) => q.status === "PENDING");
  const approvedQuote = quotes.find((q) => q.status === "APPROVED");
  const activeQuote = pendingQuote || approvedQuote || quotes[quotes.length - 1];
  const viewQuote = activeQuote ? toQuoteView(activeQuote) : null;

  const handleApproveQuote = async () => {
    if (!pendingQuote || actionInProgress) return;
    setActionInProgress(true);
    try {
      await approveQuote(pendingQuote.id);
      toast.success("Repair authorized. Technician notified.");
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to approve quote");
    } finally {
      setActionInProgress(false);
    }
  };

  const handleDeclineQuote = async () => {
    if (!pendingQuote || !reason.trim() || actionInProgress) return;
    setActionInProgress(true);
    try {
      await rejectQuote(pendingQuote.id, reason.trim());
      setDeclining(false);
      setReason("");
      toast("Sent to technician for revision");
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to request quote revision");
    } finally {
      setActionInProgress(false);
    }
  };

  const handleRequestTechnician = async (techProfileId: string, techName: string) => {
    if (!r || assigningTechId) return;
    setAssigningTechId(techProfileId);
    try {
      await assignTechnician({
        repair_request_id: r.id,
        technician_id: techProfileId,
      });
      toast.success(`Request sent to ${techName}`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to request technician");
    } finally {
      setAssigningTechId(null);
    }
  };

  const handleCancel = async () => {
    if (!r || cancelling) return;
    if (!confirm("Cancel this repair request?")) return;
    setCancelling(true);
    try {
      await cancelRepairRequest(r.id);
      toast.success("Repair request cancelled.");
      await navigate({ to: "/farmer" });
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel repair request");
      setCancelling(false);
    }
  };

  const assessmentObj = (r.assessment as any) || {
    system: "General Mechanical",
    possibleIssue: "Inspection required",
    severity: "Moderate",
    advice: "Avoid heavy use until a technician inspects.",
    partsCategory: [],
    skill: "Engine",
  };

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
          {r.job_number || r.id} · reported {ago(new Date(r.created_at).getTime())} ago
        </p>
        <h1 className="text-3xl font-bold">
          {e?.make || "Equipment"} {e?.model || ""}
        </h1>
        <div className="mt-2">
          <StatusPill r={{ status: r.status, testing: r.is_testing }} audience="farmer" />
        </div>
      </div>

      {r.status === "WAITING_FOR_PARTS" && partsHold && (
        <section className="overflow-hidden rounded-2xl border-2 border-warning bg-card">
          <div className="flex items-center gap-2 bg-warning px-5 py-3 font-display text-lg font-bold text-warning-foreground">
            <PackageSearch className="h-5 w-5" /> Repair paused — waiting for spare part
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <Label>Missing part</Label>
              <p className="text-lg font-bold">{partsHold.part}</p>
            </div>
            <div>
              <Label>Expected arrival</Label>
              <p className="text-lg font-bold">{partsHold.eta}</p>
            </div>
            <div className="sm:col-span-2">
              <Label>Why paused</Label>
              <p>{partsHold.reason}</p>
            </div>
            {partsHold.note && (
              <p className="rounded-xl bg-muted p-3 text-sm italic sm:col-span-2">
                "{partsHold.note}" — {assignedTechData?.name ?? "Technician"}
              </p>
            )}
            <div className="sm:col-span-2">
              <Label>Revised completion</Label>
              <p className="font-semibold">
                {partsHold.revised_completion || partsHold.revisedCompletion || "TBD"}
              </p>
            </div>
          </div>
        </section>
      )}

      {r.status === "REQUESTED" && !r.technician_id && (
        <AssessmentCard r={{ assessment: assessmentObj } as any} />
      )}
      {r.status === "REQUESTED" && !r.technician_id && (
        <div className="space-y-3">
          <div>
            <h2 className="text-xl font-bold">Best-matched technicians</h2>
            <p className="text-sm text-muted-foreground">
              Ranked by {e?.make ?? "machine"} experience,{" "}
              {(assessmentObj.skill || "system").toLowerCase()} expertise, availability, then distance.
            </p>
          </div>
          {r.declined_by && r.declined_by.length > 0 && (
            <p className="rounded-xl bg-warning/15 p-3 text-sm">
              A technician couldn't take this job. Please choose another — the service centre has also
              been alerted.
            </p>
          )}
          {eligibleTechs.map((m, i) => (
            <TechCard key={m.technician.id} t={formatTechCardData(m.technician)} reasons={m.reasons}>
              <div className="mt-4 flex gap-2">
                <button
                  disabled={assigningTechId === m.technician.profile_id}
                  onClick={() =>
                    handleRequestTechnician(
                      m.technician.profile_id,
                      m.technician.profile?.full_name ?? "Technician"
                    )
                  }
                  className={cn(i === 0 ? btn.primary : btn.ghost, "flex-1 disabled:opacity-50")}
                >
                  {assigningTechId === m.technician.profile_id
                    ? "Requesting…"
                    : `Request Repair${i === 0 ? " · Best match" : ""}`}
                </button>
                {m.technician.profile?.phone ? (
                  <CallButton phone={m.technician.profile.phone} label="" className="w-12 px-0" />
                ) : null}
              </div>
            </TechCard>
          ))}
          {eligibleTechs.length === 0 && (
            <Card className="text-sm text-muted-foreground">
              No technicians matched currently. The Service Centre has been alerted to assign an available
              technician.
            </Card>
          )}
        </div>
      )}

      {r.status === "REQUESTED" && r.technician_id && (
        <Card className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <div>
            <p className="font-semibold">
              Waiting for {assignedTechData?.name || "Technician"} to accept
            </p>
            <p className="text-sm text-muted-foreground">Usually within 15 minutes. We'll notify you.</p>
          </div>
        </Card>
      )}

      {r.status === "QUOTE_PENDING" && viewQuote && (
        <section className="rounded-2xl border-2 border-accent bg-card p-5">
          <h2 className="text-2xl font-bold">Review your repair quote</h2>
          <p className="mb-4 mt-1 flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-sm font-semibold text-primary">
            <ShieldCheck className="h-5 w-5 shrink-0" /> No work or charges start until you approve
            this quote.
          </p>
          <QuoteTable q={viewQuote} />
          {!declining ? (
            <div className="mt-5 grid gap-2">
              <button
                disabled={actionInProgress}
                onClick={handleApproveQuote}
                className={cn(btn.primary, "h-14 text-lg disabled:opacity-50")}
              >
                {actionInProgress
                  ? "Authorizing repair…"
                  : `Approve & Authorize Repair · ${inr(quoteTotals(viewQuote).total)}`}
              </button>
              <div className="grid grid-cols-2 gap-2">
                {assignedTechData?.phone ? (
                  <CallButton phone={assignedTechData.phone} label="Call to discuss" />
                ) : null}
                <button
                  disabled={actionInProgress}
                  onClick={() => setDeclining(true)}
                  className={cn(btn.ghost, "disabled:opacity-50")}
                >
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
                      reason === x ? "border-primary bg-primary/10" : "border-border"
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
                <button
                  disabled={actionInProgress}
                  onClick={() => setDeclining(false)}
                  className={btn.ghost}
                >
                  Back
                </button>
                <button
                  disabled={!reason.trim() || actionInProgress}
                  onClick={handleDeclineQuote}
                  className={cn(btn.amber, "disabled:opacity-50")}
                >
                  {actionInProgress ? "Sending…" : "Send for revision"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {r.status === "QUOTE_REVISED" && (
        <Card className="border-accent">
          <p className="font-semibold">The technician is revising the quote.</p>
          {r.clarification_note && (
            <p className="text-sm text-muted-foreground">Your note: "{r.clarification_note}"</p>
          )}
        </Card>
      )}

      {r.status === "COMPLETED" && (
        <section className="overflow-hidden rounded-2xl border-2 border-success bg-card">
          <div className="flex items-center gap-2 bg-success px-5 py-3 font-display text-lg font-bold text-primary-foreground">
            <CheckCircle2 className="h-5 w-5" /> Repair Complete & Verified
          </div>
          <div className="space-y-4 p-5">
            {completion?.photo_url && (
              <img
                src={completion.photo_url}
                alt="Completion proof"
                className="max-h-60 w-full rounded-xl object-cover"
              />
            )}
            <div>
              <Label>Work performed</Label>
              <p>{completion?.notes || "Repairs finalized and verified."}</p>
            </div>
            {viewQuote && (
              <div>
                <Label>Parts replaced</Label>
                <p>{viewQuote.parts.map((p) => p.name).join(", ") || "None"}</p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <Label>Labour</Label>
                <p className="font-semibold">{inr(viewQuote?.labour ?? 0)}</p>
              </div>
              <div>
                <Label>Final amount</Label>
                <p className="font-display text-xl font-bold">
                  {inr(viewQuote ? quoteTotals(viewQuote).total : 0)}
                </p>
              </div>
              <div>
                <Label>Completed</Label>
                <p className="font-semibold">
                  {completion?.completed_at
                    ? fmtTime(new Date(completion.completed_at).getTime())
                    : fmtTime(new Date(r.updated_at).getTime())}
                </p>
              </div>
            </div>
            {assignedTechData && (
              <p className="text-sm">
                Technician: <b>{assignedTechData.name}</b> · {assignedTechData.workshop}
              </p>
            )}
            <p className="rounded-xl bg-success/15 p-3 text-sm font-semibold text-success">
              Handover confirmed. Saved to the machine's permanent service history.
            </p>
            {e && (
              <Link to="/farmer/equipment/$id" params={{ id: e.id }} className={cn(btn.ghost, "w-full")}>
                View service history
              </Link>
            )}
          </div>
        </section>
      )}

      {assignedTechData && r.status !== "REQUESTED" && (
        <TechCard t={assignedTechData}>
          {assignedTechData.phone ? (
            <div className="mt-4 grid grid-cols-1">
              <CallButton
                phone={assignedTechData.phone}
                label={`Call ${assignedTechData.name.split(" ")[0]}`}
              />
            </div>
          ) : null}
        </TechCard>
      )}

      {lastNote && r.status !== "COMPLETED" && (
        <Card>
          <Label>
            Latest note from technician · {ago(new Date(lastNote.created_at).getTime())} ago
          </Label>
          <p>{lastNote.note_text}</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-4 text-lg font-bold">Progress</h2>
        <Stepper
          r={
            {
              status: r.status,
              testing: r.is_testing,
              technicianId: r.technician_id,
            } as any
          }
        />
      </Card>

      {viewQuote && !["QUOTE_PENDING", "COMPLETED"].includes(r.status) && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">Approved quote</h2>
          <QuoteTable q={viewQuote} />
        </Card>
      )}

      {r.status !== "REQUESTED" && r.status !== "COMPLETED" && (
        <AssessmentCard r={{ assessment: assessmentObj } as any} compact />
      )}

      <details className="rounded-2xl border border-border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Full activity log</summary>
        <div className="mt-4">
          <Timeline
            r={
              {
                timeline: (r.repair_timeline || []).map((t) => ({
                  status: t.status as any,
                  by: (t.created_by_role as any) || "system",
                  at: new Date(t.created_at).getTime(),
                  note: t.note || undefined,
                })),
              } as any
            }
          />
        </div>
      </details>

      {["REQUESTED", "ACCEPTED"].includes(r.status) && (
        <button
          disabled={cancelling}
          onClick={handleCancel}
          className="w-full py-3 text-sm text-muted-foreground underline disabled:opacity-50"
        >
          {cancelling ? "Cancelling request…" : "Cancel request"}
        </button>
      )}
    </div>
  );
}
