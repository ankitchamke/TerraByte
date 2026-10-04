import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  Loader2,
  PackageSearch,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable } from "@/components/repair-parts";
import {
  btn,
  CallButton,
  Card,
  ClickableImage,
  ContextualBack,
  input,
  Label,
  StatusPill,
} from "@/components/tb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ago, inr, quoteTotals, STAFF_LABEL, useTB, type Quote, type Repair } from "@/lib/tb-store";
import { useAuth } from "@/lib/auth";
import type { Assessment } from "@/lib/assessment";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  getServiceHistoryForRepair,
  type ServiceHistoryRow,
} from "@/lib/services/service-history";
import {
  approveCancellation,
  cancelRepairRequest,
  getRepairRequestById,
  rejectCancellation,
  updatePartsEta,
  type RepairRequestDetail,
} from "@/lib/services/repair-requests";
import {
  assignTechnician,
  getEligibleTechnicians,
  type ScoredTechnicianMatch,
} from "@/lib/services/technicians";
import { QuoteComparison } from "@/components/quote-comparison";
import { RepairChat } from "@/components/repair-chat";
import {
  getQuotesForRepair,
  getQuoteVersions,
  type QuoteDetail,
  type QuoteVersionDetail,
} from "@/lib/services/quotes";

export const Route = createFileRoute("/admin/repair/$id")({
  head: () => meta("Repair detail", "Inspect, dispatch and unblock a repair."),
  component: AdminRepair,
});

const OVERDUE_MIN: Partial<Record<string, number>> = {
  REQUESTED: 20,
  ACCEPTED: 180,
  QUOTE_PENDING: 240,
  QUOTE_REVISED: 120,
  WAITING_FOR_PARTS: 24 * 60,
};

function checkOverdue(status: string, statusSince: string | number): boolean {
  const limit = OVERDUE_MIN[status];
  if (limit === undefined) return false;
  const statusSinceMs =
    typeof statusSince === "number" ? statusSince : new Date(statusSince).getTime();
  return Date.now() - statusSinceMs > limit * 60 * 1000;
}

function toQuoteView(q: QuoteDetail): Quote {
  return {
    parts: (q.quote_items || []).map((item) => ({
      name: item.part_name,
      spec: item.part_spec || "OEM Standard",
      qty: item.quantity,
      price: Number(item.unit_price),
      source: item.part_source || "In van stock",
    })),
    labourDesc: q.labour_description || "Inspection, repair and test run",
    labour: Number(q.labour_amount),
    taxPct: Number(q.tax_percent),
    eta: q.estimated_completion || "TBD",
    warranty: q.warranty_terms || "90 days on parts & labour",
    version: q.version,
    sentAt: new Date(q.created_at).getTime(),
  };
}

function formatActivityDate(dateVal: string | number): string {
  try {
    const d = typeof dateVal === "number" ? new Date(dateVal) : new Date(dateVal);
    const dayMonth = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
    return `${dayMonth}, ${time}`;
  } catch {
    return String(dateVal);
  }
}

function getActivityAction(status: string, note?: string | null): string {
  const n = (note || "").toLowerCase();
  switch (status) {
    case "REQUESTED":
      if (n.includes("technician assigned") || n.includes("dispatched")) return "Technician assigned";
      return "Breakdown reported";
    case "ACCEPTED":
      return "Technician accepted job";
    case "QUOTE_PENDING":
      if (n.includes("revised")) return "Quote revised";
      return "Quote formulated & sent";
    case "QUOTE_REVISION_REQUESTED":
      return "Farmer requested quote revision";
    case "QUOTE_APPROVED":
      return "Quote approved";
    case "IN_PROGRESS":
      if (n.includes("quote approved")) return "Quote approved";
      if (n.includes("resumed") || n.includes("arrived")) return "Repair resumed";
      return "Repair started";
    case "WAITING_FOR_PARTS":
      return "Paused for spare parts";
    case "TESTING":
      return "Testing under operational load started";
    case "TESTING_FAILED":
      return "Testing failed — returning to repair";
    case "COMPLETED":
      return "Repair complete & saved to service history";
    case "CANCELLED":
      if (n.includes("approved")) return "Cancellation approved by Service Centre";
      return "Repair cancelled";
    case "CANCELLATION_REQUESTED":
      return "Cancellation requested by farmer";
    case "REASSIGNED":
      return "Technician reassigned";
    case "NOTE":
      return "Technician note recorded";
    default:
      if (n.includes("declined")) return "Cancellation request declined";
      return status.replace(/_/g, " ").toLowerCase();
  }
}

function getActivityActor(
  item: { created_by_role?: string; created_by?: { full_name?: string; role?: string } | null; by?: string },
  farmerName?: string,
  techName?: string
): { name: string; role: string } {
  const rawRole = (item.created_by_role || item.created_by?.role || item.by || "").toLowerCase();
  let role = "Staff";
  if (rawRole === "farmer") role = "Farmer";
  else if (rawRole === "technician") role = "Technician";
  else if (rawRole === "admin" || rawRole === "service_centre") role = "Service Centre";

  let name = item.created_by?.full_name;
  if (!name) {
    if (rawRole === "farmer" && farmerName) name = farmerName;
    else if (rawRole === "technician" && techName) name = techName;
    else if (rawRole === "admin" || rawRole === "service_centre") name = "Service Centre Staff";
    else name = "Staff";
  }

  return { name, role };
}

function AdminRepair() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const s = useTB();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "service_centre" || (profile?.role as string) === "admin";

  const [dbRepair, setDbRepair] = useState<RepairRequestDetail | null>(null);
  const [quotes, setQuotes] = useState<QuoteDetail[]>([]);
  const [quoteVersions, setQuoteVersions] = useState<QuoteVersionDetail[]>([]);
  const [techMatches, setTechMatches] = useState<ScoredTechnicianMatch[]>([]);
  const [serviceRecord, setServiceRecord] = useState<ServiceHistoryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState("");
  const [updatingEta, setUpdatingEta] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [showAllActivity, setShowAllActivity] = useState(false);

  // Cancellation review dialog states
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approveRemarks, setApproveRemarks] = useState("");
  const [approveError, setApproveError] = useState<string | null>(null);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectExplanation, setRejectExplanation] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  const [reviewActionBusy, setReviewActionBusy] = useState<"approve" | "reject" | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Try loading from real Supabase database
      const realRepair = await getRepairRequestById(id).catch(() => null);

      if (realRepair) {
        setDbRepair(realRepair);

        // Pre-fill ETA if in WAITING_FOR_PARTS
        if (realRepair.parts_hold) {
          const ph = realRepair.parts_hold as Record<string, any>;
          setEta(ph["eta"] || "");
        }

        // Concurrently fetch quotes, quote versions, eligible technicians, and service history (if completed)
        const [quotesData, eligibleData, versionsData, shData] = await Promise.all([
          getQuotesForRepair(realRepair.id).catch(() => []),
          getEligibleTechnicians(realRepair.id).catch(() => []),
          getQuoteVersions(realRepair.id).catch(() => []),
          realRepair.status === "COMPLETED"
            ? getServiceHistoryForRepair(realRepair.id).catch(() => null)
            : Promise.resolve(null),
        ]);

        setQuotes(quotesData);
        setQuoteVersions(versionsData);
        setTechMatches(eligibleData);
        setServiceRecord(shData);
        return;
      }

      // 2. Fallback to mock store if legacy demo ticket
      const mockRepair = s.repairs.find((x) => x.id === id || (x as any).jobNumber === id);
      if (mockRepair) {
        setEta(mockRepair.parts?.eta ?? "");
        const mockSh = s.service.find((x) => x.repairId === id || x.repairId === mockRepair.id);
        if (mockSh) {
          setServiceRecord({
            id: mockSh.id,
            equipment_id: mockSh.equipmentId,
            repair_request_id: mockSh.repairId || mockRepair.id,
            service_date: new Date(mockSh.date).toISOString(),
            operating_hours: mockSh.hours,
            service_type: mockSh.type,
            issue_description: mockSh.issue,
            parts_replaced: mockSh.parts,
            labour_cost: mockSh.labour,
            total_cost: mockSh.total,
            technician_name: mockSh.technician,
            workshop_name: mockSh.workshop,
            technician_notes: mockSh.notes,
            maintenance_advice: mockSh.advice,
            downtime_hours: mockSh.downtimeH,
            invoice_reference: mockSh.invoice,
            created_at: new Date(mockSh.date).toISOString(),
          });
        } else {
          setServiceRecord(null);
        }
        return;
      }

      setError("Repair request not found");
    } catch (err: any) {
      console.error("[TerraByte] Failed to load repair details:", err);
      setError(err?.message || "Failed to load repair details");
    } finally {
      setLoading(false);
    }
  }, [id, s.repairs, s.service]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Real-time updates subscription on repair ticket
  useEffect(() => {
    if (!dbRepair?.id) return;
    const channel = supabase
      .channel(`admin-repair-${dbRepair.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "repair_requests", filter: `id=eq.${dbRepair.id}` },
        () => { void loadData(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "repair_timeline", filter: `repair_request_id=eq.${dbRepair.id}` },
        () => { void loadData(); }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [dbRepair?.id, loadData]);

  if (loading) {
    return (
      <div className="space-y-5">
        <ContextualBack to="/admin" label="Pipeline" />
        <div className="py-12 text-center text-muted-foreground">Loading repair details…</div>
      </div>
    );
  }

  // Handle fallback mock repair if Supabase returned null but mock store has it
  const mockR = !dbRepair ? s.repairs.find((x) => x.id === id || (x as any).jobNumber === id) : null;

  if (!dbRepair && !mockR) {
    return (
      <div className="space-y-5">
        <ContextualBack to="/admin" label="Pipeline" />
        <Card>
          <p className="text-muted-foreground">{error || "Repair ticket not found."}</p>
          <Link to="/admin" className="mt-3 inline-block font-semibold text-primary underline">
            Back to operations pipeline
          </Link>
        </Card>
      </div>
    );
  }

  // Bind values from Supabase (or fallback mock)
  const isReal = Boolean(dbRepair);
  const r = dbRepair!;
  const repairId = isReal ? r.id : mockR!.id;
  const jobNumber = isReal ? r.job_number || r.id : mockR!.id;
  const status = isReal ? r.status : mockR!.status;
  const statusSince = isReal ? (r.status_since || r.created_at || new Date().toISOString()) : mockR!.statusSince;
  const createdAtMs = isReal ? new Date(r.created_at).getTime() : mockR!.createdAt;
  const isTesting = isReal ? Boolean(r.is_testing) : Boolean(mockR!.testing);
  const location = isReal ? r.location : mockR!.location;
  const symptoms = isReal ? (Array.isArray(r.symptoms) ? r.symptoms : []) : mockR!.symptoms;
  const description = isReal ? r.description : mockR!.description;

  const equipmentMake = isReal
    ? r.equipment?.make || "Equipment"
    : s.equipment.find((x) => x.id === mockR!.equipmentId)?.make || "Equipment";
  const equipmentModel = isReal
    ? r.equipment?.model || ""
    : s.equipment.find((x) => x.id === mockR!.equipmentId)?.model || "";

  const farmerName = isReal
    ? r.farmer?.full_name || "Farmer"
    : s.farmers.find((x) => x.id === mockR!.farmerId)?.name || "Farmer";
  const farmerPhone = isReal
    ? r.farmer?.phone || ""
    : s.farmers.find((x) => x.id === mockR!.farmerId)?.phone || "";

  const technicianName = isReal
    ? r.technician?.full_name || null
    : s.technicians.find((x) => x.id === mockR!.technicianId)?.name || null;
  const technicianPhone = isReal
    ? r.technician?.phone || ""
    : s.technicians.find((x) => x.id === mockR!.technicianId)?.phone || "";

  const od = checkOverdue(status, statusSince);

  // Active Quote
  const pendingQuote = quotes.find((q) => q.status === "PENDING");
  const approvedQuote = quotes.find((q) => q.status === "APPROVED");
  const latestQuote = quotes[quotes.length - 1];
  const activeQuote = pendingQuote || approvedQuote || latestQuote;
  const viewQuote: Quote | undefined = isReal
    ? (activeQuote ? toQuoteView(activeQuote) : undefined)
    : mockR?.quote;

  // Completion details extraction
  const completionDetails = isReal
    ? (r.completion_details as {
        notes?: string;
        photo?: string | null;
        photo_url?: string | null;
        tested?: boolean;
        completed_at?: string;
      } | null)
    : mockR?.completion
    ? {
        notes: mockR.completion.notes,
        photo: mockR.completion.photo || null,
        photo_url: mockR.completion.photo || null,
        tested: true,
        completed_at: new Date(mockR.completion.at).toISOString(),
      }
    : null;

  const completionNotes = completionDetails?.notes;
  const completionProofPhoto = completionDetails?.photo_url || completionDetails?.photo;
  const completionTested = completionDetails?.tested ?? (status === "COMPLETED");
  const completionAt = completionDetails?.completed_at || (status === "COMPLETED" ? statusSince : null);

  const partsReplacedList: string[] =
    serviceRecord?.parts_replaced &&
    Array.isArray(serviceRecord.parts_replaced) &&
    serviceRecord.parts_replaced.length > 0
      ? (serviceRecord.parts_replaced as string[])
      : viewQuote?.parts
      ? viewQuote.parts.map((p) => (p.qty > 1 ? `${p.name} ×${p.qty}` : p.name))
      : [];

  // Parts Hold
  const partsHold = isReal
    ? (r.parts_hold as Record<string, any> | null)
    : (mockR?.parts as any);

  // Safeguarded preliminary assessment
  const rawAssessment = (r.assessment as any) || {};
  const assessmentObj: Assessment = {
    system: rawAssessment.system || "General Mechanical",
    possibleIssue: rawAssessment.possibleIssue || "Physical inspection required by technician on site",
    severity: (["Low", "Moderate", "Moderate to High", "High"].includes(rawAssessment.severity)
      ? rawAssessment.severity
      : "Moderate") as Assessment["severity"],
    advice: rawAssessment.advice || "Avoid heavy usage until inspected by a technician.",
    partsCategory: Array.isArray(rawAssessment.partsCategory) ? rawAssessment.partsCategory : [],
    skill: rawAssessment.skill || "Engine",
    confidence: typeof rawAssessment.confidence === "number" ? rawAssessment.confidence : 0.8,
    maintenanceAdvice: rawAssessment.maintenanceAdvice || "Periodic maintenance recommended.",
    source: "demo-rules",
  };

  // Adapted repair for AssessmentCard
  const adaptedRepair: Repair = isReal
    ? {
        id: jobNumber,
        equipmentId: r.equipment_id,
        farmerId: r.farmer_id,
        technicianId: r.technician_id,
        status: r.status,
        testing: Boolean(r.is_testing),
        symptoms,
        description: r.description || "",
        photos: Array.isArray(r.photos) ? r.photos : [],
        assessment: assessmentObj,
        createdAt: createdAtMs,
        statusSince: new Date(statusSince).getTime(),
        declinedBy: Array.isArray(r.declined_by) ? r.declined_by : [],
        notes: [],
        timeline: [],
        location: r.location || "",
      }
    : mockR!;

  // Activity Log timeline entries
  const timelineEntries = isReal
    ? (r.repair_timeline || [])
    : (mockR?.timeline || []).map((tl) => ({
        created_at: new Date(tl.at).toISOString(),
        status: tl.status,
        note: tl.note || null,
        created_by_role: tl.by,
        created_by: null,
      }));

  // Sort descending: newest activity at top (chronological activity log requirement)
  const sortedTimeline = [...timelineEntries].sort((a, b) => {
    const timeA = new Date((a as any).created_at || (a as any).at || 0).getTime();
    const timeB = new Date((b as any).created_at || (b as any).at || 0).getTime();
    return timeB - timeA;
  });

  const visibleTimeline = showAllActivity ? sortedTimeline : sortedTimeline.slice(0, 5);

  // Handle Technician Assignment
  const handleAssign = async (techProfileId: string, name: string) => {
    if (assigning) return;
    setAssigning(techProfileId);
    try {
      if (isReal) {
        await assignTechnician({
          repair_request_id: r.id,
          technician_id: techProfileId,
        });
      }
      toast.success(`Assigned to ${name}. Technician notified.`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to assign technician");
    } finally {
      setAssigning(null);
    }
  };

  // Handle Parts ETA Update
  const handleUpdateEta = async () => {
    if (!eta.trim() || updatingEta) return;
    setUpdatingEta(true);
    try {
      if (isReal) {
        await updatePartsEta(r.id, {
          eta: eta.trim(),
          note: "Parts ETA updated by Service Centre",
        });
      }
      toast.success("Parts ETA updated; farmer notified.");
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update parts ETA");
    } finally {
      setUpdatingEta(false);
    }
  };

  // Handle Repair Cancellation
  const handleCancel = async () => {
    if (cancelling) return;
    if (!confirm(`Cancel repair ticket ${jobNumber}?`)) return;
    setCancelling(true);
    try {
      if (isReal) {
        await cancelRepairRequest(r.id);
      }
      toast.success("Repair cancelled.");
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel repair");
    } finally {
      setCancelling(false);
    }
  };

  // Handle Cancellation Approval
  const handleConfirmApprove = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!r || reviewActionBusy) return;
    setReviewActionBusy("approve");
    setApproveError(null);
    try {
      if (isReal) {
        await approveCancellation(r.id, {
          adminResponse: approveRemarks.trim() || undefined,
        });
      }
      toast.success("Cancellation approved. Ticket cancelled.");
      setApproveDialogOpen(false);
      setApproveRemarks("");
      await loadData();
    } catch (err: any) {
      const msg = err?.message || "Failed to approve cancellation";
      setApproveError(msg);
      toast.error(msg);
    } finally {
      setReviewActionBusy(null);
    }
  };

  // Handle Cancellation Rejection
  const handleConfirmReject = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!r || reviewActionBusy) return;
    const trimmed = rejectExplanation.trim();
    if (!trimmed) {
      setRejectError("An administrative explanation is required to decline a cancellation request.");
      return;
    }
    setReviewActionBusy("reject");
    setRejectError(null);
    try {
      if (isReal) {
        await rejectCancellation(r.id, {
          adminResponse: trimmed,
        });
      }
      toast.success("Cancellation request declined. Repair resumed.");
      setRejectDialogOpen(false);
      setRejectExplanation("");
      await loadData();
    } catch (err: any) {
      const msg = err?.message || "Failed to decline cancellation";
      setRejectError(msg);
      toast.error(msg);
    } finally {
      setReviewActionBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <ContextualBack to="/admin" label="Pipeline" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-muted-foreground">
            {jobNumber} · opened {ago(createdAtMs)} ago
          </p>
          <h1 className="text-3xl font-bold">
            {equipmentMake} {equipmentModel}
          </h1>
          <p className="text-sm text-muted-foreground">
            {farmerName} · {location}
          </p>
        </div>
        <StatusPill r={{ status, testing: isTesting }} audience="staff" />
      </div>

      {status === "CANCELLATION_REQUESTED" && (
        <section className="overflow-hidden rounded-2xl border-2 border-warning bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-warning px-5 py-3.5 font-display text-lg font-bold text-warning-foreground">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 shrink-0" />
              <span>Cancellation Request Awaiting Service Centre Review</span>
            </div>
            <span className="rounded-full bg-warning-foreground/15 px-2.5 py-0.5 text-xs font-mono font-semibold text-warning-foreground">
              Work on hold
            </span>
          </div>

          <div className="space-y-4 p-5">
            <p className="text-sm text-foreground">
              The farmer has submitted a formal cancellation request for this repair ticket. Active physical repair work is temporarily paused pending your administrative decision.
            </p>

            <div className="grid gap-4 rounded-xl border border-warning/30 bg-warning/5 p-4 sm:grid-cols-2 text-sm">
              <div>
                <Label>Cancellation Reason</Label>
                <p className="text-base font-bold text-foreground">
                  {(isReal && r.cancellation_reason) || "Alternative arrangement / local repair"}
                </p>
              </div>
              <div>
                <Label>Requested Time</Label>
                <p className="font-semibold text-foreground">
                  {isReal && r.cancellation_requested_at
                    ? formatActivityDate(r.cancellation_requested_at)
                    : ago(new Date(statusSince).getTime()) + " ago"}
                </p>
              </div>
              <div>
                <Label>Previous Repair Status</Label>
                <p className="font-medium text-foreground">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-semibold">
                    {STAFF_LABEL[(isReal && r.cancellation_previous_status) || "ACCEPTED"] || "In progress"}
                  </span>
                </p>
              </div>
              <div>
                <Label>Assigned Technician</Label>
                <p className="font-medium text-foreground">
                  {technicianName ? (
                    <span>{technicianName} (work on hold)</span>
                  ) : (
                    <span className="text-muted-foreground italic">Unassigned</span>
                  )}
                </p>
              </div>
              {isReal && r.cancellation_note && (
                <div className="sm:col-span-2 pt-2 border-t border-warning/20">
                  <Label>Farmer Explanation / Note</Label>
                  <p className="rounded-lg bg-card/70 border border-warning/20 p-3 text-sm italic text-foreground">
                    "{r.cancellation_note}"
                  </p>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={Boolean(reviewActionBusy)}
                  onClick={() => {
                    setApproveRemarks("");
                    setApproveError(null);
                    setApproveDialogOpen(true);
                  }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-5 font-semibold text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Approve cancellation
                </button>
                <button
                  type="button"
                  disabled={Boolean(reviewActionBusy)}
                  onClick={() => {
                    setRejectExplanation("");
                    setRejectError(null);
                    setRejectDialogOpen(true);
                  }}
                  className={cn(btn.ghost, "h-11 px-5 text-sm font-semibold border-2 border-border hover:bg-muted disabled:opacity-50")}
                >
                  <XCircle className="h-4 w-4 text-destructive" />
                  Decline cancellation
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {status === "CANCELLED" && (
        <section className="overflow-hidden rounded-2xl border-2 border-border bg-card">
          <div className="flex items-center gap-2 bg-muted px-5 py-3 font-display text-lg font-bold text-foreground">
            <XCircle className="h-5 w-5 text-destructive" /> Repair Cancelled
          </div>
          <div className="space-y-3 p-5 text-sm">
            <p className="text-muted-foreground">
              This repair ticket was cancelled. Equipment status has been restored to Operational.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 rounded-xl bg-muted/40 p-4">
              <div>
                <Label>Cancellation Reason</Label>
                <p className="font-semibold text-foreground">
                  {(isReal && r.cancellation_reason) || "Cancelled"}
                </p>
              </div>
              <div>
                <Label>Resolution Status</Label>
                <p className="font-semibold text-muted-foreground">Closed</p>
              </div>
              {isReal && r.cancellation_note && (
                <div className="sm:col-span-2">
                  <Label>Farmer Note</Label>
                  <p className="italic text-muted-foreground">"{r.cancellation_note}"</p>
                </div>
              )}
              {isReal && r.cancellation_admin_response && (
                <div className="sm:col-span-2">
                  <Label>Service Centre Resolution Remarks</Label>
                  <p className="font-medium text-foreground bg-card border border-border rounded-lg p-3">
                    "{r.cancellation_admin_response}"
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {status === "COMPLETED" && (
        <section className="overflow-hidden rounded-2xl border-2 border-success bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-success px-5 py-3.5 font-display text-lg font-bold text-success-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>Repair Completed & Verified</span>
            </div>
            <span className="rounded-full bg-success-foreground/15 px-2.5 py-0.5 text-xs font-mono font-semibold text-success-foreground">
              Equipment Operational
            </span>
          </div>

          <div className="space-y-4 p-5">
            <p className="text-sm text-foreground">
              Work on this repair ticket has been finalized, tested under operational load, and signed off by the technician. Machinery has been returned to operational status and recorded in permanent service history.
            </p>

            {/* Proof Photo (if present) */}
            {completionProofPhoto && (
              <div>
                <Label>Completion Verification Photo</Label>
                <div className="mt-1">
                  <ClickableImage
                    src={completionProofPhoto}
                    alt="Completion verification photo"
                    className="max-h-64 w-full max-w-md rounded-xl border border-border shadow-xs"
                    thumbnailClassName="max-h-64 w-full max-w-md object-cover rounded-xl"
                  />
                </div>
              </div>
            )}

            <div className="grid gap-4 rounded-xl border border-success/30 bg-success/5 p-4 sm:grid-cols-2 text-sm">
              <div>
                <Label>Work Notes</Label>
                <p className="text-foreground font-medium whitespace-pre-wrap">
                  {completionNotes || "Repairs finalized and verified."}
                </p>
              </div>

              <div>
                <Label>Operational Testing</Label>
                <p className="flex items-center gap-1.5 font-semibold text-success">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {completionTested ? "Tested under operational load (Passed)" : "Verified & operational"}
                </p>
              </div>

              <div>
                <Label>Completion Timestamp</Label>
                <p className="font-semibold text-foreground">
                  {completionAt ? formatActivityDate(completionAt) : ago(new Date(statusSince).getTime()) + " ago"}
                </p>
              </div>

              <div>
                <Label>Signing Technician</Label>
                <p className="font-medium text-foreground">
                  {technicianName ? (
                    <span>{technicianName}</span>
                  ) : (
                    <span className="text-muted-foreground italic">Authorized Technician</span>
                  )}
                </p>
              </div>

              <div>
                <Label>Invoice Reference</Label>
                <p className="font-mono font-bold text-foreground">
                  {serviceRecord?.invoice_reference || `INV-${jobNumber}`}
                </p>
              </div>

              <div>
                <Label>Labour & Total Amount</Label>
                <p className="font-semibold text-foreground">
                  Labour: {inr(serviceRecord?.labour_cost ?? viewQuote?.labour ?? 0)} · Total:{" "}
                  <span className="font-display text-base font-bold text-foreground">
                    {inr(serviceRecord?.total_cost ?? (viewQuote ? quoteTotals(viewQuote).total : 0))}
                  </span>
                </p>
              </div>

              {partsReplacedList.length > 0 && (
                <div className="sm:col-span-2 pt-2 border-t border-success/20">
                  <Label>Parts Replaced</Label>
                  <p className="text-foreground font-medium">
                    {partsReplacedList.join(", ")}
                  </p>
                </div>
              )}

              <div className="sm:col-span-2 pt-2 border-t border-success/20 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label>Permanent Service History</Label>
                  <p className="font-mono text-xs text-muted-foreground">
                    {serviceRecord?.id
                      ? `Record ID: ${serviceRecord.id}`
                      : "Permanent equipment service record recorded upon completion."}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Immutable record locked
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {isReal && r.cancellation_admin_response && status !== "CANCELLED" && status !== "CANCELLATION_REQUESTED" && (
        <div className="rounded-xl border border-info/30 bg-info/10 p-4 text-sm space-y-1">
          <p className="font-semibold text-info flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> Previous Cancellation Request Declined
          </p>
          <p className="text-foreground text-xs">
            The previous cancellation request was declined by Service Centre with explanation:{" "}
            <span className="italic font-medium">"{r.cancellation_admin_response}"</span>. Repair work is actively continuing.
          </p>
        </div>
      )}

      {status === "QUOTE_REVISED" ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Quote revision requested by farmer · Technician response expected</span>
          </div>
          <p className="text-xs text-foreground">
            The farmer requested changes to the repair quote. The assigned technician ({technicianName || "Technician"}) is expected to submit a revised quote.
            <span className="text-muted-foreground"> · In revision for {ago(new Date(statusSince).getTime())}</span>
            {od && (
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                {" "}(Overdue — follow up with technician)
              </span>
            )}
          </p>
          {isReal && r.clarification_note && (
            <p className="mt-1 rounded-lg bg-card/70 border border-amber-500/20 p-2.5 text-xs italic text-foreground leading-relaxed">
              Farmer requested: "{r.clarification_note.split("\n")[0]}"
            </p>
          )}
        </div>
      ) : status !== "COMPLETED" && status !== "CANCELLED" && od ? (
        <p className="flex items-center gap-2 rounded-xl border-2 border-destructive bg-destructive/5 p-3 font-semibold text-destructive">
          <AlertOctagon className="h-5 w-5 shrink-0" /> Exception: in "{status.toLowerCase().replace(/_/g, " ")}" for{" "}
          {ago(new Date(statusSince).getTime())} — intervene.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          {/* Dispatch / Reassignment */}
          {status !== "COMPLETED" && status !== "CANCELLED" && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">
                {technicianName ? "Reassign technician" : "Dispatch technician"}
              </h2>
              <p className="mb-3 text-sm">
                Current: <b>{technicianName ?? "Unassigned"}</b>
                {isReal && r.declined_by && r.declined_by.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}· declined by {r.declined_by.length} {r.declined_by.length === 1 ? "technician" : "technicians"}
                  </span>
                )}
              </p>

              <div className="space-y-2">
                {techMatches.length > 0 ? (
                  techMatches
                    .filter((m) => m.technician.profile_id !== r.technician_id)
                    .map((m) => (
                      <div
                        key={m.technician.profile_id}
                        className="flex items-center gap-3 rounded-xl border border-border p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {m.technician.profile?.full_name}{" "}
                            <span className="font-mono text-xs text-muted-foreground">score {m.score}</span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.reasons.join(" · ") || "Verified technician"} ·{" "}
                            {m.technician.profile?.village || "Nagpur"} · ~{m.technician.eta_minutes ?? 45} min
                          </p>
                        </div>
                        <button
                          disabled={assigning === m.technician.profile_id}
                          onClick={() =>
                            void handleAssign(m.technician.profile_id, m.technician.profile?.full_name || "technician")
                          }
                          className="h-10 shrink-0 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                          {assigning === m.technician.profile_id ? "Assigning…" : "Assign"}
                        </button>
                      </div>
                    ))
                ) : (
                  <p className="text-sm text-muted-foreground italic py-1">
                    {status === "REQUESTED"
                      ? "Searching for eligible verified technicians in district…"
                      : "Technician assigned."}
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* Parts Blocker Card */}
          {partsHold && status === "WAITING_FOR_PARTS" && (
            <Card className="border-warning">
              <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
                <PackageSearch className="h-5 w-5 text-warning-foreground" /> Parts blocker
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label>Part</Label>
                  <p className="font-semibold">{partsHold.part || "Spare part"}</p>
                </div>
                <div>
                  <Label>Blocked for</Label>
                  <p className="font-semibold">{ago(new Date(partsHold.since || statusSince).getTime())}</p>
                </div>
                <div className="col-span-2">
                  <Label>Reason</Label>
                  <p>{partsHold.reason || "Waiting for delivery"}</p>
                </div>
                {partsHold.note && (
                  <p className="col-span-2 italic text-muted-foreground">"{partsHold.note}"</p>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  className={input}
                  placeholder="e.g. Tomorrow, 9:30 AM"
                  value={eta}
                  onChange={(ev) => setEta(ev.target.value)}
                />
                <button
                  disabled={updatingEta}
                  onClick={() => void handleUpdateEta()}
                  className={cn(btn.amber, "shrink-0")}
                >
                  {updatingEta ? "Updating…" : "Update ETA"}
                </button>
              </div>
            </Card>
          )}

          {/* Quote Version Comparison */}
          {quoteVersions.length >= 2 && (
            <QuoteComparison
              v1={quoteVersions[quoteVersions.length - 2]}
              v2={quoteVersions[quoteVersions.length - 1]}
            />
          )}

          {/* Quote Card */}
          {viewQuote && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Quote (v{viewQuote.version})</h2>
              <QuoteTable q={viewQuote} />
            </Card>
          )}

          {/* Preliminary Assessment */}
          <AssessmentCard r={adaptedRepair} />

          {/* Reported Breakdown Photos */}
          {isReal && (r.photos || []).length > 0 && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Reported breakdown photos ({r.photos.length})</Label>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {r.photos.map((p, i) => (
                  <ClickableImage
                    key={i}
                    src={p}
                    alt={`Breakdown photo ${i + 1}`}
                    className="h-24 w-24 rounded-xl border border-border shadow-xs"
                    thumbnailClassName="h-24 w-24 object-cover"
                  />
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {/* Contacts */}
          <Card>
            <h2 className="mb-3 text-lg font-bold">Contacts</h2>
            <div className="grid gap-2">
              {farmerPhone ? (
                <CallButton phone={farmerPhone} label={`Farmer · ${farmerName}`} />
              ) : (
                <p className="text-sm text-muted-foreground">Farmer: {farmerName} (No phone)</p>
              )}
              {technicianName && technicianPhone ? (
                <CallButton phone={technicianPhone} label={`Technician · ${technicianName}`} />
              ) : technicianName ? (
                <p className="text-sm text-muted-foreground">Technician: {technicianName}</p>
              ) : null}
            </div>
          </Card>

          {/* Farmer Report */}
          <Card>
            <Label>Farmer report</Label>
            <p className="text-sm font-semibold">{symptoms.join(", ")}</p>
            {description && <p className="mt-2 text-sm italic">"{description}"</p>}
          </Card>

          {/* Ticket Discussion */}
          {isReal && (
            <RepairChat
              repairId={r.id}
              ticketNumber={jobNumber}
              farmerId={r.farmer_id}
              farmerName={farmerName}
              technicianId={r.technician_id}
              technicianName={technicianName}
            />
          )}

          {/* Dedicated Chronological Repair Activity Log */}
          <Card className="space-y-3">
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => setActivityOpen(!activityOpen)}
            >
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">Repair activity log</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {sortedTimeline.length}
                </span>
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Toggle activity log"
              >
                {activityOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>

            {activityOpen && (
              <div className="pt-2">
                {sortedTimeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-2">No recorded events yet.</p>
                ) : (
                  <>
                    <div className={cn(sortedTimeline.length > 5 && "max-h-[380px] overflow-y-auto pr-1")}>
                      <ol className="relative space-y-4 border-l-2 border-border pl-4 ml-2">
                        {visibleTimeline.map((item, idx) => {
                          const { name, role } = getActivityActor(item as any, farmerName, technicianName || undefined);
                          const action = getActivityAction(item.status, item.note);
                          const isDestructive =
                            item.status === "TESTING_FAILED" || item.status === "CANCELLED";

                          return (
                            <li key={idx} className="relative">
                              <span
                                className={cn(
                                  "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full",
                                  isDestructive
                                    ? "bg-destructive ring-4 ring-destructive/20"
                                    : "bg-primary ring-4 ring-primary/20"
                                )}
                              />
                              <div>
                                <p className="font-mono text-xs text-muted-foreground">
                                  {formatActivityDate((item as any).created_at || (item as any).at)}
                                </p>
                                <p
                                  className={cn(
                                    "text-sm font-semibold",
                                    isDestructive ? "text-destructive font-bold" : "text-foreground"
                                  )}
                                >
                                  {action}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {name} · <span className="font-medium text-foreground/80">{role}</span>
                                </p>
                                {item.note && (
                                  <p className="mt-1 text-xs text-muted-foreground/90 bg-muted/40 rounded-lg p-2 italic">
                                    "{item.note}"
                                  </p>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </div>

                    {sortedTimeline.length > 5 && (
                      <button
                        type="button"
                        onClick={() => setShowAllActivity(!showAllActivity)}
                        className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                      >
                        {showAllActivity ? (
                          <>
                            <ChevronUp className="h-3.5 w-3.5" /> Show latest 5 events
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3.5 w-3.5" /> Show all {sortedTimeline.length} events
                          </>
                        )}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </Card>

          {/* Direct Admin Cancellation (Only for non-cancellation-requested active repairs) */}
          {status !== "COMPLETED" && status !== "CANCELLED" && status !== "CANCELLATION_REQUESTED" && (
            <button
              disabled={cancelling}
              onClick={() => void handleCancel()}
              className={cn(btn.ghost, "w-full text-destructive hover:bg-destructive/10")}
            >
              {cancelling ? "Cancelling…" : "Cancel repair"}
            </button>
          )}
        </div>
      </div>

      {/* Approve Cancellation Confirmation Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Repair Cancellation</DialogTitle>
            <DialogDescription>
              Are you sure you want to approve this cancellation request? This will mark the repair ticket as Cancelled, notify both the farmer and assigned technician, and restore equipment to Operational status (if no other active repairs exist).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmApprove} className="space-y-4 py-2">
            <div className="rounded-xl bg-muted/60 p-3.5 text-xs space-y-1.5 border border-border/50">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ticket:</span>
                <span className="font-mono font-bold text-foreground">{jobNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Farmer:</span>
                <span className="font-semibold text-foreground">{farmerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reason:</span>
                <span className="font-semibold text-foreground">
                  {(isReal && r.cancellation_reason) || "Alternative arrangement"}
                </span>
              </div>
            </div>

            <div>
              <Label>Administrative Resolution Remarks (Optional)</Label>
              <textarea
                className={cn(input, "h-20 resize-none py-2 text-sm leading-relaxed")}
                maxLength={500}
                value={approveRemarks}
                onChange={(e) => setApproveRemarks(e.target.value)}
                placeholder="e.g. Cancellation approved per farmer request; no parts or labour invoiced."
                disabled={reviewActionBusy === "approve"}
              />
            </div>

            {approveError && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{approveError}</span>
              </div>
            )}

            <DialogFooter className="mt-4 gap-2 sm:gap-0">
              <button
                type="button"
                disabled={reviewActionBusy === "approve"}
                onClick={() => setApproveDialogOpen(false)}
                className={cn(btn.ghost, "h-11")}
              >
                Go Back
              </button>
              <button
                type="submit"
                disabled={reviewActionBusy === "approve"}
                className={cn(
                  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-5 font-semibold text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                )}
              >
                {reviewActionBusy === "approve" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Approving…
                  </>
                ) : (
                  "Confirm & Cancel Repair"
                )}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Decline / Reject Cancellation Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Decline Cancellation Request</DialogTitle>
            <DialogDescription>
              Decline this cancellation request and resume repair work. The ticket will revert to its previous status (
              <strong>
                {STAFF_LABEL[(isReal && r.cancellation_previous_status) || "ACCEPTED"] || "previous status"}
              </strong>
              ), and both the farmer and assigned technician will be notified with your explanation.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmReject} className="space-y-4 py-2">
            <div>
              <Label>Reason for Declining (Required)</Label>
              <textarea
                className={cn(input, "h-24 resize-none py-2 text-sm leading-relaxed")}
                maxLength={500}
                value={rejectExplanation}
                onChange={(e) => {
                  setRejectExplanation(e.target.value);
                  if (rejectError) setRejectError(null);
                }}
                placeholder="Explain to the farmer why this cancellation request cannot be approved (e.g. custom parts already procured, technician on site)..."
                disabled={reviewActionBusy === "reject"}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                An explanation is required and will be sent directly to the farmer and technician.
              </p>
            </div>

            {rejectError && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{rejectError}</span>
              </div>
            )}

            <DialogFooter className="mt-4 gap-2 sm:gap-0">
              <button
                type="button"
                disabled={reviewActionBusy === "reject"}
                onClick={() => setRejectDialogOpen(false)}
                className={cn(btn.ghost, "h-11")}
              >
                Go Back
              </button>
              <button
                type="submit"
                disabled={reviewActionBusy === "reject" || !rejectExplanation.trim()}
                className={cn(btn.primary, "h-11 text-sm disabled:opacity-50")}
              >
                {reviewActionBusy === "reject" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Declining…
                  </>
                ) : (
                  "Decline & Resume Repair"
                )}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
