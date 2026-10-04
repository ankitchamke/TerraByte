import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  PackageSearch,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable, TechCard, Timeline } from "@/components/repair-parts";
import { btn, CallButton, Card, ClickableImage, ContextualBack, formatEtaDateTime, input, Label, StatusPill, Stepper } from "@/components/tb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cancelRepairRequest,
  requestCancellation,
  CANCELLATION_REASONS,
  getRepairRequestById,
  type RepairRequestDetail,
} from "@/lib/services/repair-requests";
import { useAuth } from "@/lib/auth";
import { QuoteComparison } from "@/components/quote-comparison";
import { RepairChat } from "@/components/repair-chat";
import {
  approveQuote,
  getQuotesForRepair,
  getQuoteVersions,
  parseClarificationNote,
  rejectQuote,
  type QuoteDetail,
  type QuoteVersionDetail,
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
import { supabase } from "@/integrations/supabase/client";

interface RepairHubSearch {
  from?: "equipment";
  equipmentId?: string;
}

export const Route = createFileRoute("/farmer/repair/$id")({
  validateSearch: (s: Record<string, unknown>): RepairHubSearch => ({
    from: s["from"] === "equipment" ? "equipment" : undefined,
    equipmentId: typeof s["equipmentId"] === "string" ? (s["equipmentId"] as string) : undefined,
  }),
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
  const { from, equipmentId } = Route.useSearch();
  const backTarget =
    from === "equipment" && equipmentId
      ? { to: `/farmer/equipment/${equipmentId}`, label: "Machine Record" }
      : { to: "/farmer", label: "Home" };
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [r, setR] = useState<RepairRequestDetail | null>(null);
  const [quotes, setQuotes] = useState<QuoteDetail[]>([]);
  const [quoteVersions, setQuoteVersions] = useState<QuoteVersionDetail[]>([]);
  const [notes, setNotes] = useState<RepairNoteWithAuthor[]>([]);
  const [assignedTech, setAssignedTech] = useState<VerifiedTechnicianWithProfile | null>(null);
  const [eligibleTechs, setEligibleTechs] = useState<ScoredTechnicianMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const [revisionReason, setRevisionReason] = useState("Too expensive");
  const [otherExplanation, setOtherExplanation] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [declining, setDeclining] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [cancellationDialogOpen, setCancellationDialogOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState<string>(CANCELLATION_REASONS[0]);
  const [cancellationNote, setCancellationNote] = useState("");
  const [submittingCancellation, setSubmittingCancellation] = useState(false);
  const [cancellationError, setCancellationError] = useState<string | null>(null);
  const [assigningTechId, setAssigningTechId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setError(null);

      const repairData = await getRepairRequestById(id);
      if (!repairData) {
        setR(null);
        return;
      }
      setR(repairData);

      const [quotesData, notesData, assignedTechData, eligibleTechsData, versionsData] = await Promise.all([
        getQuotesForRepair(repairData.id).catch(() => []),
        getRepairNotes(repairData.id).catch(() => []),
        repairData.technician_id
          ? getAssignedTechnician(repairData.id).catch(() => null)
          : Promise.resolve(null),
        repairData.status === "REQUESTED" && !repairData.technician_id
          ? getEligibleTechnicians(repairData.id).catch(() => [])
          : Promise.resolve([]),
        getQuoteVersions(repairData.id).catch(() => []),
      ]);

      setQuotes(quotesData);
      setQuoteVersions(versionsData);
      setNotes(notesData);
      setAssignedTech(assignedTechData);
      setEligibleTechs(eligibleTechsData);
      hasLoadedRef.current = true;
    } catch (err: any) {
      console.error("[TerraByte] Failed to load repair details:", err);
      if (!hasLoadedRef.current) {
        setError(err?.message || "Failed to load repair details");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadData();

    // Subscribe to live updates for this repair ticket
    const channel = supabase
      .channel(`farmer-repair-live-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_requests",
        },
        () => {
          void loadData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "quotes",
        },
        () => {
          void loadData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_timeline",
        },
        () => {
          void loadData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_notes",
        },
        () => {
          void loadData();
        }
      )
      .subscribe();

    const handleFocus = () => {
      void loadData();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener("focus", handleFocus);
    };
  }, [id, loadData]);

  if (loading) {
    return (
      <div className="space-y-5">
        <ContextualBack to={backTarget.to} label={backTarget.label} />
        <div className="py-12 text-center text-muted-foreground">Loading repair details…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5">
        <ContextualBack to={backTarget.to} label={backTarget.label} />
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
        <ContextualBack to={backTarget.to} label={backTarget.label} />
        <Card>
          <p>Repair not found.</p>
          <Link to={backTarget.to as any} className="mt-2 inline-block font-semibold text-primary">
            Go to {backTarget.label.toLowerCase()}
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
    if (!pendingQuote || actionInProgress) return;
    if (revisionReason === "Other" && !otherExplanation.trim()) return;

    setActionInProgress(true);
    try {
      await rejectQuote(pendingQuote.id, {
        reason: revisionReason,
        explanation: revisionReason === "Other" ? otherExplanation.trim() : undefined,
        photo: photoUrl.trim() || undefined,
      });
      setDeclining(false);
      setOtherExplanation("");
      setPhotoUrl("");
      toast.success("Sent to technician for revision");
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

  const isUnassignedRequested = r.status === "REQUESTED" && !r.technician_id;
  const isGovernedCancellable =
    (r.status === "REQUESTED" && Boolean(r.technician_id)) ||
    ["ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED", "IN_PROGRESS", "WAITING_FOR_PARTS"].includes(
      r.status
    );
  const canCancelOrRequest = isUnassignedRequested || isGovernedCancellable;

  const openCancellationDialog = () => {
    setCancellationReason(CANCELLATION_REASONS[0]);
    setCancellationNote("");
    setCancellationError(null);
    setCancellationDialogOpen(true);
  };

  const handleSubmitCancellation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!r || submittingCancellation) return;
    if (!cancellationReason) {
      setCancellationError("Please select a reason for cancellation.");
      return;
    }

    setSubmittingCancellation(true);
    setCancellationError(null);

    try {
      if (isUnassignedRequested) {
        await cancelRepairRequest(r.id, {
          reason: cancellationReason,
          note: cancellationNote.trim() || undefined,
        });
        toast.success("Repair request cancelled.");
        setCancellationDialogOpen(false);
        await navigate({ to: "/farmer" });
      } else {
        await requestCancellation(r.id, {
          reason: cancellationReason,
          note: cancellationNote.trim() || undefined,
        });
        toast.success("Cancellation request submitted. Service Centre has been notified.");
        setCancellationDialogOpen(false);
        await loadData();
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to process cancellation";
      setCancellationError(msg);
      toast.error(msg);
    } finally {
      setSubmittingCancellation(false);
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
      <ContextualBack to={backTarget.to} label={backTarget.label} />
      <div>
        <p className="font-mono text-sm text-muted-foreground">
          {r.job_number || r.id} · reported {ago(new Date(r.created_at).getTime())} ago
        </p>
        <h1 className="text-3xl font-bold">
          {e?.make || "Equipment"} {e?.model || ""}
        </h1>
        <div className="mt-2">
          <StatusPill r={{ status: r.status, testing: r.is_testing, technicianId: r.technician_id }} audience="farmer" />
        </div>
      </div>

      {r.status === "CANCELLATION_REQUESTED" && (
        <section className="overflow-hidden rounded-2xl border-2 border-warning bg-card">
          <div className="flex items-center gap-2 bg-warning px-5 py-3 font-display text-lg font-bold text-warning-foreground">
            <Clock className="h-5 w-5" /> Cancellation Request Under Review
          </div>
          <div className="space-y-4 p-5">
            <p className="text-sm text-foreground">
              You have requested to cancel this repair. The Service Centre has been notified and is currently reviewing your request. Work on your machine is temporarily <strong>on hold</strong>.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 rounded-xl bg-muted/50 p-4 text-sm">
              <div>
                <Label>Reason Submitted</Label>
                <p className="font-semibold">{r.cancellation_reason || "None specified"}</p>
              </div>
              <div>
                <Label>Requested At</Label>
                <p className="font-semibold">
                  {r.cancellation_requested_at
                    ? fmtTime(new Date(r.cancellation_requested_at).getTime())
                    : "Recently"}
                </p>
              </div>
              {r.cancellation_note && (
                <div className="sm:col-span-2">
                  <Label>Your Note</Label>
                  <p className="italic text-muted-foreground">"{r.cancellation_note}"</p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Our Service Centre team will review the request against any parts ordered or labor performed and finalize your ticket.
            </p>
          </div>
        </section>
      )}

      {r.status === "CANCELLED" && (
        <section className="overflow-hidden rounded-2xl border-2 border-muted-foreground/30 bg-card">
          <div className="flex items-center gap-2 bg-muted px-5 py-3 font-display text-lg font-bold text-foreground">
            <XCircle className="h-5 w-5 text-destructive" /> Repair Cancelled
          </div>
          <div className="space-y-4 p-5">
            <p className="text-sm text-foreground">
              This repair request has been cancelled. Your equipment status has been restored to Operational.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 rounded-xl bg-muted/50 p-4 text-sm">
              <div>
                <Label>Cancellation Reason</Label>
                <p className="font-semibold">{r.cancellation_reason || "Cancelled by user"}</p>
              </div>
              <div>
                <Label>Status</Label>
                <p className="font-semibold text-muted-foreground">Closed</p>
              </div>
              {r.cancellation_note && (
                <div className="sm:col-span-2">
                  <Label>Farmer Note</Label>
                  <p className="italic text-muted-foreground">"{r.cancellation_note}"</p>
                </div>
              )}
              {r.cancellation_admin_response && (
                <div className="sm:col-span-2">
                  <Label>Service Centre Resolution</Label>
                  <p className="font-medium text-foreground">"{r.cancellation_admin_response}"</p>
                </div>
              )}
            </div>
            {e && (
              <Link
                to="/farmer/equipment/$id"
                params={{ id: e.id }}
                search={{ from: "repair", repairId: r.id }}
                className={cn(btn.ghost, "w-full")}
              >
                View Machine Record
              </Link>
            )}
          </div>
        </section>
      )}

      {r.status === "WAITING_FOR_PARTS" && (
        <section className="overflow-hidden rounded-2xl border-2 border-warning bg-card">
          <div className="flex items-center gap-2 bg-warning px-5 py-3 font-display text-lg font-bold text-warning-foreground">
            <PackageSearch className="h-5 w-5" /> Paused: Waiting for Spare Parts
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <Label>Missing part</Label>
              <p className="text-lg font-bold">{partsHold?.part || "Spare part"}</p>
            </div>
            <div>
              <Label>Expected arrival</Label>
              <p className="text-lg font-bold">{formatEtaDateTime(partsHold?.eta)}</p>
            </div>
            {partsHold?.reason && (
              <div className="sm:col-span-2">
                <Label>Why paused</Label>
                <p>{partsHold.reason}</p>
              </div>
            )}
            {partsHold?.note && (
              <p className="rounded-xl bg-muted p-3 text-sm italic sm:col-span-2">
                "{partsHold.note}" — {assignedTechData?.name ?? "Technician"}
              </p>
            )}
            {(partsHold?.revised_completion || partsHold?.revisedCompletion) && (
              <div className="sm:col-span-2">
                <Label>Revised completion</Label>
                <p className="font-semibold">
                  {formatEtaDateTime(partsHold.revised_completion || partsHold.revisedCompletion)}
                </p>
              </div>
            )}
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
          <h2 className="text-2xl font-bold">
            {viewQuote.version > 1
              ? `Revised quote ready for your review (v${viewQuote.version})`
              : "Review your repair quote"}
          </h2>
          <p className="mb-4 mt-1 flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-sm font-semibold text-primary">
            <ShieldCheck className="h-5 w-5 shrink-0" /> No work or charges start until you approve
            this quote.
          </p>
          {quoteVersions.length >= 2 && (
            <div className="mb-4">
              <QuoteComparison
                v1={quoteVersions[quoteVersions.length - 2]}
                v2={quoteVersions[quoteVersions.length - 1]}
              />
            </div>
          )}
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
            <div className="mt-5 space-y-3">
              <div>
                <Label>Reason for revision</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {[
                    "Too expensive",
                    "Want local (non-OEM) parts",
                    "Need earlier completion",
                    "Please explain labour",
                    "Other",
                  ].map((x) => (
                    <button
                      key={x}
                      type="button"
                      onClick={() => setRevisionReason(x)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                        revisionReason === x
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-border text-foreground hover:bg-muted"
                      )}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>

              {revisionReason === "Other" && (
                <div>
                  <Label>What would you like changed?</Label>
                  <textarea
                    className={cn(input, "h-24 resize-none py-2 text-sm leading-relaxed")}
                    maxLength={500}
                    value={otherExplanation}
                    onChange={(ev) => setOtherExplanation(ev.target.value)}
                    placeholder="Describe what you would like changed..."
                  />
                </div>
              )}

              <div>
                <Label>Photo / reference link (Optional)</Label>
                <input
                  className={input}
                  maxLength={500}
                  value={photoUrl}
                  onChange={(ev) => setPhotoUrl(ev.target.value)}
                  placeholder="Optional image URL or reference"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  disabled={actionInProgress}
                  onClick={() => setDeclining(false)}
                  className={btn.ghost}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={
                    (revisionReason === "Other" && !otherExplanation.trim()) ||
                    actionInProgress
                  }
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
        <section className="rounded-2xl border-2 border-accent bg-card p-5 space-y-4">
          <div>
            <h2 className="text-2xl font-bold">The technician is revising your quote</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You requested revisions on the previous quote. The technician is reviewing your feedback and preparing an updated quote. No repair work or charges will begin until you review and approve the revised quote.
            </p>
          </div>

          {r.clarification_note && (() => {
            const parsed = parseClarificationNote(r.clarification_note);
            return (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                  Your Revision Request
                </p>
                {parsed.reason && (
                  <p><span className="font-semibold text-muted-foreground">Reason:</span> <span className="font-medium text-foreground">{parsed.reason}</span></p>
                )}
                {parsed.explanation && (
                  <p className="rounded-lg bg-card/70 border border-amber-500/20 p-2.5 text-xs italic text-foreground leading-relaxed">
                    "{parsed.explanation}"
                  </p>
                )}
                {parsed.photo && (
                  <div className="pt-1">
                    <p className="text-xs font-semibold text-muted-foreground">Attached Photo:</p>
                    <ClickableImage
                      src={parsed.photo}
                      alt="Attached photo"
                      className="mt-1 h-20 w-20"
                      thumbnailClassName="h-20 w-20 object-cover rounded-md"
                    />
                  </div>
                )}
              </div>
            );
          })()}

          {viewQuote && (
            <details className="rounded-xl border border-border bg-muted/30 p-3.5">
              <summary className="cursor-pointer font-semibold text-sm text-foreground">
                View previous quote (v{viewQuote.version} · {inr(quoteTotals(viewQuote).total)})
              </summary>
              <div className="mt-3 pt-3 border-t border-border">
                <QuoteTable q={viewQuote} />
              </div>
            </details>
          )}
        </section>
      )}


      {r.status === "IN_PROGRESS" && r.is_testing && (
        <Card className="border-primary/40 space-y-2">
          <div className="flex items-center gap-2 font-bold text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-lg">Testing in progress</span>
          </div>
          <p className="text-sm text-muted-foreground">
            The technician is testing your machine under operational load as the final verification before completing the repair and saving it to service history.
          </p>
        </Card>
      )}

      {r.status === "IN_PROGRESS" && !r.is_testing && (
        <Card className="border-primary/30 space-y-2">
          <div className="flex items-center gap-2 font-bold text-primary">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
            </span>
            <span className="text-lg">Repair in progress</span>
          </div>
          <p className="text-sm text-muted-foreground">
            The technician is currently carrying out the approved repair work on your equipment.
          </p>
        </Card>
      )}

      {r.status === "COMPLETED" && (
        <section className="overflow-hidden rounded-2xl border-2 border-success bg-card">
          <div className="flex items-center gap-2 bg-success px-5 py-3 font-display text-lg font-bold text-primary-foreground">
            <CheckCircle2 className="h-5 w-5" /> Repair Complete & Saved to Service History
          </div>
          <div className="space-y-4 p-5">
            {(completion?.photo_url || completion?.photo) && (
              <ClickableImage
                src={completion.photo_url || completion.photo}
                alt="Completion proof"
                className="max-h-60 w-full"
                thumbnailClassName="max-h-60 w-full object-cover"
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
              Repair completed and saved to the machine's permanent service history.
            </p>
            {e && (
              <Link
                to="/farmer/equipment/$id"
                params={{ id: e.id }}
                search={{ from: "repair", repairId: r.id }}
                className={cn(btn.ghost, "w-full")}
              >
                View service history
              </Link>
            )}
          </div>
        </section>
      )}

      {assignedTechData && r.status !== "REQUESTED" && r.status !== "CANCELLED" && (
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

      {lastNote && r.status !== "COMPLETED" && r.status !== "CANCELLED" && (
        <Card>
          <Label>
            Latest note from technician · {ago(new Date(lastNote.created_at).getTime())} ago
          </Label>
          <p>{lastNote.note_text}</p>
        </Card>
      )}

      {/* Ticket Discussion */}
      <RepairChat
        repairId={r.id}
        ticketNumber={r.job_number || r.id}
        farmerId={r.farmer_id}
        farmerName={profile?.full_name || "Farmer"}
        technicianId={r.technician_id}
        technicianName={assignedTechData?.name}
      />

      <Card>
        <h2 className="mb-4 text-lg font-bold">Progress</h2>
        <Stepper
          r={
            {
              status: r.status,
              testing: r.is_testing,
              technicianId: r.technician_id,
              cancellation_previous_status: r.cancellation_previous_status,
            } as any
          }
        />
      </Card>

      {approvedQuote && ["IN_PROGRESS", "WAITING_FOR_PARTS"].includes(r.status) && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">Approved quote</h2>
          <QuoteTable q={toQuoteView(approvedQuote)} />
        </Card>
      )}

      {r.status !== "REQUESTED" && r.status !== "COMPLETED" && (
        <AssessmentCard r={{ assessment: assessmentObj } as any} compact />
      )}

      {r.photos && r.photos.length > 0 && (
        <Card className="space-y-2">
          <Label>Reported breakdown photos ({r.photos.length})</Label>
          <div className="flex flex-wrap gap-2 pt-1">
            {r.photos.map((p, i) => (
              <ClickableImage
                key={i}
                src={p}
                alt={`Breakdown photo ${i + 1}`}
                className="h-24 w-24"
                thumbnailClassName="h-24 w-24 object-cover"
              />
            ))}
          </div>
        </Card>
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

      {canCancelOrRequest && (
        <button
          type="button"
          onClick={openCancellationDialog}
          className="w-full py-3 text-sm text-muted-foreground hover:text-destructive underline transition-colors"
        >
          {isUnassignedRequested ? "Cancel request" : "Request cancellation"}
        </button>
      )}

      <Dialog open={cancellationDialogOpen} onOpenChange={setCancellationDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isUnassignedRequested ? "Cancel Repair Request" : "Request Repair Cancellation"}
            </DialogTitle>
            <DialogDescription>
              {isUnassignedRequested
                ? "Since no technician has been assigned to this ticket yet, your repair request will be cancelled immediately and your equipment will be restored to Operational status."
                : "This repair is currently active or assigned to a technician. Submitting this request will pause the repair and notify the Service Centre for administrative review. The repair is not cancelled until approved."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitCancellation} className="space-y-4 py-2">
            <div>
              <Label>Reason for cancellation</Label>
              <select
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                className={cn(input, "w-full cursor-pointer bg-background")}
                disabled={submittingCancellation}
              >
                {CANCELLATION_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>
                {isUnassignedRequested
                  ? "Additional details (optional)"
                  : "Explanation for Service Centre (optional)"}
              </Label>
              <textarea
                className={cn(input, "h-24 resize-none py-2 text-sm leading-relaxed")}
                maxLength={500}
                value={cancellationNote}
                onChange={(e) => setCancellationNote(e.target.value)}
                placeholder={
                  isUnassignedRequested
                    ? "Add any notes about why you are cancelling..."
                    : "Explain why you wish to cancel this active repair..."
                }
                disabled={submittingCancellation}
              />
            </div>

            {cancellationError && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{cancellationError}</span>
              </div>
            )}

            <DialogFooter className="mt-4 gap-2 sm:gap-0">
              <button
                type="button"
                disabled={submittingCancellation}
                onClick={() => setCancellationDialogOpen(false)}
                className={cn(btn.ghost, "h-11")}
              >
                {isUnassignedRequested ? "Keep Request" : "Keep Repair"}
              </button>
              <button
                type="submit"
                disabled={submittingCancellation || !cancellationReason}
                className={cn(
                  isUnassignedRequested
                    ? "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-5 font-semibold text-sm text-destructive-foreground hover:bg-destructive/90"
                    : cn(btn.amber, "h-11 text-sm"),
                  "disabled:opacity-50"
                )}
              >
                {submittingCancellation ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isUnassignedRequested ? "Cancelling…" : "Submitting…"}
                  </>
                ) : isUnassignedRequested ? (
                  "Confirm Cancellation"
                ) : (
                  "Submit Request"
                )}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
