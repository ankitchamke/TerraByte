import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  Loader2,
  MapPin,
  Package,
  PackageSearch,
  Wrench,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable } from "@/components/repair-parts";
import { VisualDefectDiagnosticViewer } from "@/components/diagnostics/visual-defect-diagnostic-viewer";
import { DirectionsButton } from "@/components/directions-button";
import { formatGpsAccuracy } from "@/lib/location";
import {
  btn,
  CallButton,
  Card,
  ClickableImage,
  ContextualBack,
  DateTimePicker,
  formatEtaDateTime,
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
import {
  actions,
  ago,
  fmtTime,
  inr,
  quoteTotals,
  STAFF_LABEL,
  useTB,
  type Quote,
  type Repair,
} from "@/lib/tb-store";
import { useAuth } from "@/lib/auth";
import type { Assessment } from "@/lib/assessment";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { useRepairTicketRealtime } from "@/hooks/use-repair-realtime";
import {
  confirmPartHandoff,
  getRepairPartRequests,
  updatePartRequestEta,
  type ServiceCentrePartRequestDetail,
} from "@/lib/services/parts-desk";
import { getServiceHistoryForRepair, type ServiceHistoryRow } from "@/lib/services/service-history";
import {
  approveCancellation,
  cancelRepairRequest,
  getRepairRequestById,
  rejectCancellation,
  updatePartsEta,
  getRepairDispatchLocation,
  type RepairDispatchLocation,
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
import { AdminHandoverCard } from "@/components/handover/admin-handover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { WorkshopCheckinDialog } from "@/components/facilities/workshop-checkin-dialog";
import {
  CustodyReceiptModal,
  type CustodyReceiptData,
} from "@/components/facilities/custody-receipt-modal";
import {
  ExtendReservationDialog,
  RerouteWorkshopDialog,
  ReleaseEquipmentDialog,
} from "@/components/facilities/workshop-admin-dialogs";

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
    const time = d.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${dayMonth}, ${time}`;
  } catch {
    return String(dateVal);
  }
}

function getActivityAction(status: string, note?: string | null): string {
  const n = (note || "").toLowerCase();
  switch (status) {
    case "REQUESTED":
      if (n.includes("technician assigned") || n.includes("dispatched"))
        return "Technician assigned";
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
  item: {
    created_by_role?: string;
    created_by?: { full_name?: string; role?: string } | null;
    by?: string;
  },
  farmerName?: string,
  techName?: string,
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
  const [dispatchLocation, setDispatchLocation] = useState<RepairDispatchLocation | null>(null);
  const [partRequests, setPartRequests] = useState<ServiceCentrePartRequestDetail[]>([]);
  const [confirmingHandoffId, setConfirmingHandoffId] = useState<string | null>(null);

  // Coordinate Part ETA state
  const [partEtaTarget, setPartEtaTarget] = useState<ServiceCentrePartRequestDetail | null>(null);
  const [partNewEta, setPartNewEta] = useState("");
  const [partEtaNotes, setPartEtaNotes] = useState("");
  const [updatingPartEta, setUpdatingPartEta] = useState(false);

  // Coordinate Sourcing Hold ETA state
  const [sourcingEtaTarget, setSourcingEtaTarget] = useState<any | null>(null);
  const [sourcingNewEta, setSourcingNewEta] = useState("");
  const [updatingSourcingEta, setUpdatingSourcingEta] = useState(false);

  // Workshop drop-off state (Phase 14 M4)
  const [facilityDetail, setFacilityDetail] = useState<{
    id: string;
    name: string;
    village: string;
    tahsil: string;
    phone?: string | null;
    owner_name?: string | null;
  } | null>(null);
  const [reservationDetail, setReservationDetail] = useState<{
    id: string;
    status: string;
    expires_at: string;
    renewal_count: number;
  } | null>(null);

  // Workshop dialog triggers
  const [showCheckinDialog, setShowCheckinDialog] = useState(false);
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [showRerouteDialog, setShowRerouteDialog] = useState(false);
  const [showReleaseDialog, setShowReleaseDialog] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const hasLoadedRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      if (!hasLoadedRef.current) {
        setLoading(true);
      }
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

        // Concurrently fetch quotes, quote versions, eligible technicians, service history, dispatch location, and parts requests
        const [quotesData, eligibleData, versionsData, shData, dispatchLocData, reqsData] =
          await Promise.all([
            getQuotesForRepair(realRepair.id).catch(() => []),
            getEligibleTechnicians(realRepair.id).catch(() => []),
            getQuoteVersions(realRepair.id).catch(() => []),
            realRepair.status === "COMPLETED"
              ? getServiceHistoryForRepair(realRepair.id).catch(() => null)
              : Promise.resolve(null),
            getRepairDispatchLocation(realRepair.id).catch(() => null),
            getRepairPartRequests(realRepair.id).catch(() => []),
          ]);

        setQuotes(quotesData);
        setQuoteVersions(versionsData);
        setTechMatches(eligibleData);
        setServiceRecord(shData);
        setDispatchLocation(dispatchLocData);
        setPartRequests(reqsData);

        // Fetch Workshop Drop-off facility & bay reservation details
        if (realRepair.delivery_mode === "WORKSHOP_DROPOFF" && realRepair.facility_id) {
          const [facRes, resRes] = await Promise.all([
            supabase
              .from("repair_facilities")
              .select("id, name, village, tahsil, phone, owner_name")
              .eq("id", realRepair.facility_id)
              .maybeSingle()
              .then((x) => x.data)
              .catch(() => null),
            supabase
              .from("facility_bay_reservations")
              .select("id, status, expires_at, renewal_count")
              .eq("repair_request_id", realRepair.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
              .then((x) => x.data)
              .catch(() => null),
          ]);
          setFacilityDetail(facRes);
          setReservationDetail(resRes);
        } else {
          setFacilityDetail(null);
          setReservationDetail(null);
        }

        hasLoadedRef.current = true;
        return;
      }

      // 2. Fallback to mock store if legacy demo ticket
      const mockRepair = s.repairs.find((x) => x.id === id || (x as any).jobNumber === id);
      if (mockRepair) {
        setEta(mockRepair.parts?.eta ?? "");
        const mockSh = s.service.find((x) => x.repairId === id || x.repairId === mockRepair.id);
        const reqsData = await getRepairPartRequests(mockRepair.id).catch(() => []);
        setPartRequests(reqsData);
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
            demo_code: null,
            created_at: new Date(mockSh.date).toISOString(),
          });
        } else {
          setServiceRecord(null);
        }
        hasLoadedRef.current = true;
        return;
      }

      if (!hasLoadedRef.current) {
        setError("Repair request not found");
      }
    } catch (err: any) {
      console.error("[TerraByte] Failed to load repair details:", err);
      if (!hasLoadedRef.current) {
        setError(err?.message || "Failed to load repair details");
      }
    } finally {
      setLoading(false);
    }
  }, [id, s.repairs, s.service, s.serviceCentrePartRequests, s.serviceCentreParts]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Scoped Supabase Realtime synchronization with debounced coalescing
  useRepairTicketRealtime({
    repairId: dbRepair?.id || id,
    onUpdate: loadData,
  });

  const handleOpenPartEta = (req: ServiceCentrePartRequestDetail) => {
    setPartEtaTarget(req);
    setPartNewEta(req.estimated_arrival_at || "");
    setPartEtaNotes(req.notes || "");
  };

  const handleSavePartEta = async () => {
    if (!partEtaTarget) return;
    setUpdatingPartEta(true);
    try {
      await updatePartRequestEta(partEtaTarget.id, {
        estimatedArrivalAt: partNewEta.trim() || null,
        notes: partEtaNotes.trim() || undefined,
      });
      toast.success(`Arrival ETA updated for ${partEtaTarget.part?.name || "spare part"}.`);
      setPartEtaTarget(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update ETA.";
      toast.error(msg);
    } finally {
      setUpdatingPartEta(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <ContextualBack to="/admin" label="Pipeline" />
        <div className="py-12 text-center text-muted-foreground">Loading repair details…</div>
      </div>
    );
  }

  // Handle fallback mock repair if Supabase returned null but mock store has it
  const mockR = !dbRepair
    ? s.repairs.find((x) => x.id === id || (x as any).jobNumber === id)
    : null;

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
  const statusSince = isReal
    ? r.status_since || r.created_at || new Date().toISOString()
    : mockR!.statusSince;
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
    ? activeQuote
      ? toQuoteView(activeQuote)
      : undefined
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
  const completionTested = completionDetails?.tested ?? status === "COMPLETED";
  const completionAt =
    completionDetails?.completed_at || (status === "COMPLETED" ? statusSince : null);

  const partsReplacedList: string[] =
    serviceRecord?.parts_replaced &&
    Array.isArray(serviceRecord.parts_replaced) &&
    serviceRecord.parts_replaced.length > 0
      ? (serviceRecord.parts_replaced as string[])
      : viewQuote?.parts
        ? viewQuote.parts.map((p) => (p.qty > 1 ? `${p.name} ×${p.qty}` : p.name))
        : [];

  // Parts Hold
  const partsHold = isReal ? (r.parts_hold as Record<string, any> | null) : (mockR?.parts as any);

  // Field & External Sourcing Holds (blocker items with no matching depot requisition row)
  const rawHoldItems: any[] = !partsHold
    ? []
    : Array.isArray(partsHold.items)
      ? partsHold.items
      : partsHold.part
        ? [
            {
              id: partsHold.part,
              part: partsHold.part,
              reason: partsHold.reason,
              eta: partsHold.eta,
              status: "PENDING",
            },
          ]
        : [];
  const sourcingHolds = rawHoldItems.filter((it: any) => {
    const isDone = it.status === "HANDED_OFF" || it.status === "RESOLVED";
    if (isDone) return false;
    const isDepotReq = (partRequests || []).some(
      (pr) =>
        pr.id === it.id ||
        (it.partId && pr.part_id === it.partId) ||
        (pr.part?.name &&
          it.part &&
          pr.part.name.trim().toLowerCase() === it.part.trim().toLowerCase()),
    );
    return !isDepotReq;
  });

  // Safeguarded preliminary assessment
  const rawAssessment = (r.assessment as any) || {};
  const assessmentObj: Assessment = {
    system: rawAssessment.system || "General Mechanical",
    possibleIssue:
      rawAssessment.possibleIssue || "Physical inspection required by technician on site",
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
    ? r.repair_timeline || []
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
      } else {
        actions.updatePartsEta(jobNumber, eta.trim(), "admin");
      }
      toast.success("Parts ETA updated; farmer notified.");
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update parts ETA");
    } finally {
      setUpdatingEta(false);
    }
  };

  // Handle Sourcing Hold ETA Update
  const handleSaveSourcingEta = async () => {
    if (!sourcingEtaTarget) return;
    setUpdatingSourcingEta(true);
    try {
      if (isReal) {
        await updatePartsEta(r.id, {
          itemId: sourcingEtaTarget.id,
          partName: sourcingEtaTarget.part,
          eta: sourcingNewEta.trim() || "ETA pending",
          note: "Sourcing hold ETA updated by Service Centre",
        });
      } else {
        actions.updatePartsEta(
          jobNumber,
          sourcingNewEta.trim() || "ETA pending",
          "admin",
          sourcingEtaTarget.id,
        );
      }
      toast.success(`Arrival ETA updated for ${sourcingEtaTarget.part}.`);
      setSourcingEtaTarget(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update sourcing hold ETA.";
      toast.error(msg);
    } finally {
      setUpdatingSourcingEta(false);
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
      setRejectError(
        "An administrative explanation is required to decline a cancellation request.",
      );
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
          <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-1.5 mt-0.5">
            <span>
              {farmerName} · {location}
            </span>
            {dispatchLocation && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <MapPin className="h-3 w-3" /> Exact GPS saved (
                {formatGpsAccuracy(dispatchLocation.accuracy)})
              </span>
            )}
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
              The farmer has submitted a formal cancellation request for this repair ticket. Active
              physical repair work is temporarily paused pending your administrative decision.
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
                    {STAFF_LABEL[(isReal && r.cancellation_previous_status) || "ACCEPTED"] ||
                      "In progress"}
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
                  className={cn(
                    btn.ghost,
                    "h-11 px-5 text-sm font-semibold border-2 border-border hover:bg-muted disabled:opacity-50",
                  )}
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

      {/* Workshop Drop-Off Cancelled In Bay Banner (Phase 14 M4) */}
      {isReal &&
        r.delivery_mode === "WORKSHOP_DROPOFF" &&
        status === "CANCELLED" &&
        r.dropped_off_at &&
        r.handover_status !== "RELEASED" && (
          <section className="overflow-hidden rounded-2xl border-2 border-warning bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-warning px-5 py-3.5 font-display text-lg font-bold text-warning-foreground">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span>Cancelled Equipment Physically Occupying Bay</span>
              </div>
              <Badge className="bg-warning-foreground text-warning text-xs font-mono font-semibold">
                Bay Occupancy Held
              </Badge>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-foreground">
                This repair ticket was cancelled, but the machinery is physically in the workshop
                bay at <strong>{facilityDetail?.name || "the workshop"}</strong> (Receipt:{" "}
                <code className="font-mono font-bold">{r.drop_off_receipt_number || "RCP-TB"}</code>
                ). Physical bay occupancy remains committed until staff records customer pickup and
                release.
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/40">
                {r.drop_off_receipt_number && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => setShowReceiptModal(true)}
                  >
                    View Custody Receipt
                  </Button>
                )}
                <Button
                  size="sm"
                  className="text-xs gap-1.5 bg-warning text-warning-foreground hover:bg-warning/90"
                  onClick={() => setShowReleaseDialog(true)}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Record Equipment Physical Release
                </Button>
              </div>
            </div>
          </section>
        )}

      {/* Workshop Drop-Off & Bay Capacity Card (Phase 14 M4) */}
      {isReal && r.delivery_mode === "WORKSHOP_DROPOFF" && (
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h3 className="text-base font-bold">Workshop Drop-Off & Bay Capacity</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Assigned Facility: <strong>{facilityDetail?.name || "Workshop"}</strong> (
                {facilityDetail?.village}, {facilityDetail?.tahsil})
              </p>
            </div>
            {r.dropped_off_at ? (
              <Badge className="bg-success text-success-foreground text-xs gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> In Workshop Bay (
                {r.handover_status || "RECEIVED"})
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-xs text-amber-600 border-amber-600/40 bg-amber-600/5 gap-1"
              >
                <Clock className="h-3.5 w-3.5" /> Awaiting Physical Drop-Off
              </Badge>
            )}
          </div>

          {r.dropped_off_at ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                  <span className="text-muted-foreground uppercase text-[10px] font-semibold">
                    Receipt Number
                  </span>
                  <p className="font-mono font-bold text-foreground">
                    {r.drop_off_receipt_number || "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                  <span className="text-muted-foreground uppercase text-[10px] font-semibold">
                    Drop-Off Time
                  </span>
                  <p className="font-semibold text-foreground">
                    {new Date(r.dropped_off_at).toLocaleString("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                  <span className="text-muted-foreground uppercase text-[10px] font-semibold">
                    Custody Status
                  </span>
                  <p className="font-semibold text-foreground">{r.handover_status || "RECEIVED"}</p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={() => setShowReceiptModal(true)}
                >
                  View / Print Custody Receipt
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                  <span className="text-muted-foreground uppercase text-[10px] font-semibold">
                    Reservation Status
                  </span>
                  <p className="font-semibold text-foreground">
                    {reservationDetail?.status || "RESERVED"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                  <span className="text-muted-foreground uppercase text-[10px] font-semibold">
                    Expires At
                  </span>
                  <p className="font-semibold text-amber-600">
                    {reservationDetail?.expires_at
                      ? new Date(reservationDetail.expires_at).toLocaleString("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "24 hours from report"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                  <span className="text-muted-foreground uppercase text-[10px] font-semibold">
                    Renewals
                  </span>
                  <p className="font-semibold text-foreground">
                    {reservationDetail?.renewal_count || 0} times renewed
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/40">
                {reservationDetail && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => setShowExtendDialog(true)}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Admin Extend Reservation
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={() => setShowRerouteDialog(true)}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Reroute to Different Workshop
                </Button>
                <Button
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={() => setShowCheckinDialog(true)}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Check In Equipment
                </Button>
              </div>
            </div>
          )}
        </Card>
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
              Work on this repair ticket has been finalized, tested under operational load, and
              signed off by the technician. Machinery has been returned to operational status and
              recorded in permanent service history.
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
                  {completionTested
                    ? "Tested under operational load (Passed)"
                    : "Verified & operational"}
                </p>
              </div>

              <div>
                <Label>Completion Timestamp</Label>
                <p className="font-semibold text-foreground">
                  {completionAt
                    ? formatActivityDate(completionAt)
                    : ago(new Date(statusSince).getTime()) + " ago"}
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
                    {inr(
                      serviceRecord?.total_cost ?? (viewQuote ? quoteTotals(viewQuote).total : 0),
                    )}
                  </span>
                </p>
              </div>

              {partsReplacedList.length > 0 && (
                <div className="sm:col-span-2 pt-2 border-t border-success/20">
                  <Label>Parts Replaced</Label>
                  <p className="text-foreground font-medium">{partsReplacedList.join(", ")}</p>
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

      {status === "COMPLETED" && dbRepair && (
        <AdminHandoverCard
          repair={dbRepair}
          quote={approvedQuote || (quotes.length > 0 ? quotes[0] : null)}
          onUpdate={loadData}
        />
      )}

      {isReal &&
        r.cancellation_admin_response &&
        status !== "CANCELLED" &&
        status !== "CANCELLATION_REQUESTED" && (
          <div className="rounded-xl border border-info/30 bg-info/10 p-4 text-sm space-y-1">
            <p className="font-semibold text-info flex items-center gap-1.5">
              <Clock className="h-4 w-4" /> Previous Cancellation Request Declined
            </p>
            <p className="text-foreground text-xs">
              The previous cancellation request was declined by Service Centre with explanation:{" "}
              <span className="italic font-medium">"{r.cancellation_admin_response}"</span>. Repair
              work is actively continuing.
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
            The farmer requested changes to the repair quote. The assigned technician (
            {technicianName || "Technician"}) is expected to submit a revised quote.
            <span className="text-muted-foreground">
              {" "}
              · In revision for {ago(new Date(statusSince).getTime())}
            </span>
            {od && (
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                {" "}
                (Overdue — follow up with technician)
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
          <AlertOctagon className="h-5 w-5 shrink-0" /> Exception: in "
          {status.toLowerCase().replace(/_/g, " ")}" for {ago(new Date(statusSince).getTime())} —
          intervene.
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
                    {" "}
                    · declined by {r.declined_by.length}{" "}
                    {r.declined_by.length === 1 ? "technician" : "technicians"}
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
                            <span className="font-mono text-xs text-muted-foreground">
                              score {m.score}
                            </span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.reasons.join(" · ") || "Verified technician"} ·{" "}
                            {m.technician.profile?.village || "Nagpur"} ·{" "}
                            {m.routingStatus === "NO_COORDINATES" ? (
                              <span>Distance Unavailable</span>
                            ) : m.routingStatus === "OUTAGE" || m.distanceKm == null ? (
                              <span>Road Distance Temporarily Unavailable</span>
                            ) : (
                              <span>
                                {m.distanceKm} km · ~{m.etaMin} min
                                {m.routingStatus === "EXTENDED" ||
                                (m.distanceKm != null && m.distanceKm > 50) ? (
                                  <span className="ml-1 text-warning-foreground font-semibold">
                                    (Extended Travel)
                                  </span>
                                ) : null}
                              </span>
                            )}
                          </p>
                        </div>
                        <button
                          disabled={assigning === m.technician.profile_id}
                          onClick={() =>
                            void handleAssign(
                              m.technician.profile_id,
                              m.technician.profile?.full_name || "technician",
                            )
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

              {partsHold.items && partsHold.items.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3 mb-3">
                  <Label className="text-xs font-bold text-foreground">
                    Required Blocking Parts ({partsHold.items.length})
                  </Label>
                  <div className="space-y-1.5">
                    {partsHold.items.map((it: any, idx: number) => {
                      const isDone = it.status === "HANDED_OFF" || it.status === "RESOLVED";
                      const matchingReq = (partRequests || []).find(
                        (pr) =>
                          pr.id === it.id ||
                          pr.part_id === it.partId ||
                          pr.part?.name?.trim().toLowerCase() === it.part.trim().toLowerCase(),
                      );
                      const isDepotReq = Boolean(matchingReq);
                      const isOutOfStock =
                        matchingReq && matchingReq.part && matchingReq.part.stock_quantity === 0;
                      const isInsufficient =
                        matchingReq &&
                        matchingReq.part &&
                        matchingReq.part.stock_quantity > 0 &&
                        matchingReq.part.stock_quantity < matchingReq.quantity;

                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs rounded-lg bg-background/80 p-2.5 border border-border/60"
                        >
                          <div className="space-y-0.5">
                            <p className="font-semibold text-foreground">
                              {it.part} {it.quantity ? `(Qty: ${it.quantity})` : ""}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{it.reason}</p>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {isDepotReq ? "Depot Requisition" : "Field / External Sourcing Hold"}
                            </span>
                          </div>
                          <div className="text-right space-y-1">
                            <span
                              className={cn(
                                "inline-block rounded-full px-2 py-0.5 text-[10px] font-bold",
                                isDone
                                  ? "bg-success/20 text-success"
                                  : isDepotReq
                                    ? isOutOfStock
                                      ? "bg-destructive/15 text-destructive"
                                      : isInsufficient
                                        ? "bg-warning/20 text-warning-foreground"
                                        : "bg-warning/20 text-warning-foreground"
                                    : "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30",
                              )}
                            >
                              {isDone
                                ? "Handed Off"
                                : isDepotReq
                                  ? isOutOfStock
                                    ? "Out of Depot Stock — Awaiting Arrival"
                                    : isInsufficient
                                      ? "Insufficient Stock — Awaiting Arrival"
                                      : "Awaiting Handoff"
                                  : "Sourcing Hold — Awaiting Arrival"}
                            </span>
                            {it.eta && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                ETA: {formatEtaDateTime(it.eta)}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <Label>Part</Label>
                    <p className="font-semibold">{partsHold.part || "Spare part"}</p>
                  </div>
                  <div>
                    <Label>Blocked for</Label>
                    <p className="font-semibold">
                      {ago(new Date(partsHold.since || statusSince).getTime())}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <Label>Reason</Label>
                    <p>{partsHold.reason || "Waiting for delivery"}</p>
                  </div>
                  {partsHold.note && (
                    <p className="col-span-2 italic text-muted-foreground">"{partsHold.note}"</p>
                  )}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <div className="flex-1">
                  <DateTimePicker value={eta} onChange={(val) => setEta(val)} />
                </div>
                <button
                  disabled={updatingEta || !eta.trim()}
                  onClick={() => void handleUpdateEta()}
                  className={cn(btn.amber, "shrink-0 h-11 px-4")}
                >
                  {updatingEta ? "Updating…" : "Update ETA"}
                </button>
              </div>
            </Card>
          )}

          {/* Service Centre Parts Requests */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">Service Centre Parts Requests</h2>
              </div>
              <Link
                to="/admin/parts-desk"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Open Parts Desk →
              </Link>
            </div>

            <p className="text-xs text-muted-foreground mb-3">
              Spare parts requested by technician from Nagpur Service Centre depot stock.
            </p>

            {partRequests.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground italic">
                No parts requested from Service Centre for this repair.
              </p>
            ) : (
              <div className="space-y-2.5">
                {partRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/40 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {req.part?.name || "Spare part"} (Qty: {req.quantity})
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold",
                            req.status === "PENDING"
                              ? "bg-warning/20 text-warning-foreground"
                              : req.status === "HANDED_OFF"
                                ? "bg-success/20 text-success"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {req.status === "PENDING"
                            ? "Awaiting Handoff"
                            : req.status === "HANDED_OFF"
                              ? "Handed Off"
                              : "Cancelled"}
                        </span>
                        {req.part && req.part.stock_quantity === 0 && (
                          <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">
                            Out of Depot Stock
                          </span>
                        )}
                        {req.part &&
                          req.part.stock_quantity > 0 &&
                          req.part.stock_quantity < req.quantity && (
                            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning-foreground">
                              Insufficient Stock ({req.part.stock_quantity} available)
                            </span>
                          )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                        <Clock className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-muted-foreground">Expected Arrival:</span>
                        <span
                          className={cn(
                            "font-medium",
                            req.estimated_arrival_at
                              ? "text-primary font-semibold"
                              : "text-muted-foreground italic",
                          )}
                        >
                          {req.estimated_arrival_at
                            ? formatEtaDateTime(req.estimated_arrival_at)
                            : "ETA pending"}
                        </span>
                      </div>
                      {req.eta_updated_at && (
                        <p className="text-[10px] text-muted-foreground">
                          ETA set{" "}
                          {req.eta_updater?.full_name ? `by ${req.eta_updater.full_name}` : ""} on{" "}
                          {new Date(req.eta_updated_at).toLocaleDateString()}
                        </p>
                      )}
                      <p className="font-mono text-[11px] text-muted-foreground">
                        SKU: {req.part?.part_number || "—"} · Spec: {req.part?.spec || "Standard"}
                        {req.part?.location ? ` · Shelf: ${req.part.location}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Requested by {req.requester?.full_name || "Technician"} ·{" "}
                        {fmtTime(new Date(req.created_at).getTime())}
                        {req.handed_off_at && (
                          <>
                            {" "}
                            · Handed off by {req.handed_off_by || "Admin"} (
                            {fmtTime(new Date(req.handed_off_at).getTime())})
                          </>
                        )}
                      </p>
                      {req.notes && (
                        <p className="text-[11px] italic text-muted-foreground">"{req.notes}"</p>
                      )}
                    </div>

                    {req.status === "PENDING" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenPartEta(req)}
                          className="inline-flex h-8 items-center rounded-lg border border-primary/30 bg-primary/5 px-2.5 text-xs font-semibold text-primary hover:bg-primary/15"
                        >
                          Update ETA
                        </button>
                        {req.part && req.part.stock_quantity >= req.quantity ? (
                          <button
                            type="button"
                            disabled={confirmingHandoffId === req.id}
                            onClick={async () => {
                              setConfirmingHandoffId(req.id);
                              try {
                                const res = await confirmPartHandoff(req.id);
                                toast.success(
                                  `Confirmed handoff: ${res.quantity}x ${res.part_name}. On-hand stock updated.`,
                                );
                                await loadData();
                              } catch (err: any) {
                                toast.error(err?.message || "Failed to confirm handoff.");
                              } finally {
                                setConfirmingHandoffId(null);
                              }
                            }}
                            className="inline-flex h-8 items-center rounded-lg bg-success px-3 text-xs font-semibold text-success-foreground hover:bg-success/90 disabled:opacity-50"
                          >
                            {confirmingHandoffId === req.id ? "Confirming…" : "Confirm Handoff"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            title="Cannot hand off part: Insufficient or zero depot stock available."
                            className="inline-flex h-8 items-center rounded-lg bg-muted px-3 text-xs font-semibold text-muted-foreground cursor-not-allowed opacity-60"
                          >
                            Handoff Locked (Out of Stock)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Field & External Sourcing Holds */}
            {sourcingHolds.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border/60">
                <div className="flex items-center gap-1.5 mb-2">
                  <MapPin className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Field &amp; External Sourcing Holds ({sourcingHolds.length})
                  </h3>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2.5">
                  Parts sourced externally or held in the field. Coordinate arrival ETA directly
                  below. Handoff is locked until received into depot inventory.
                </p>
                <div className="space-y-2">
                  {sourcingHolds.map((sh: any, idx: number) => (
                    <div
                      key={sh.id || idx}
                      className="flex flex-col gap-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {sh.part} {sh.quantity ? `(Qty: ${sh.quantity})` : ""}
                          </span>
                          <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300 border border-blue-500/30">
                            Sourcing Hold — Awaiting Arrival
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                          <Clock className="h-3 w-3 text-primary shrink-0" />
                          <span className="text-muted-foreground">Expected Arrival:</span>
                          <span
                            className={cn(
                              "font-medium",
                              sh.eta
                                ? "text-primary font-semibold"
                                : "text-muted-foreground italic",
                            )}
                          >
                            {sh.eta ? formatEtaDateTime(sh.eta) : "ETA pending"}
                          </span>
                        </div>
                        {sh.reason && (
                          <p className="text-[11px] italic text-muted-foreground">"{sh.reason}"</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setSourcingEtaTarget(sh);
                            setSourcingNewEta(sh.eta || "");
                          }}
                          className="inline-flex h-8 items-center rounded-lg border border-primary/30 bg-primary/5 px-2.5 text-xs font-semibold text-primary hover:bg-primary/15"
                        >
                          Update ETA
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Quote Version Comparison */}
          {quoteVersions.length >= 2 &&
            quoteVersions[quoteVersions.length - 2] &&
            quoteVersions[quoteVersions.length - 1] && (
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

          {/* Visual Defect Diagnostics (Gemini Multimodal AI & Interactive Defect Canvas) */}
          {(Boolean((r.assessment as any)?.visualDiagnostics) ||
            (r.photos && r.photos.length > 0)) && (
            <VisualDefectDiagnosticViewer
              repairId={r.id}
              visualDiagnostics={(r.assessment as any)?.visualDiagnostics}
              photos={r.photos || []}
              equipment={
                r.equipment
                  ? { make: r.equipment.make, model: r.equipment.model, year: r.equipment.year }
                  : undefined
              }
              userRole="admin"
              onRefresh={loadData}
            />
          )}

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
          {/* Contacts & Dispatch */}
          <Card>
            <h2 className="mb-3 text-lg font-bold">Contacts & Directions</h2>
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
              <DirectionsButton
                dispatchLocation={dispatchLocation}
                fallbackLocation={location}
                label="Get directions"
              />
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
                {activityOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </div>

            {activityOpen && (
              <div className="pt-2">
                {sortedTimeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-2">
                    No recorded events yet.
                  </p>
                ) : (
                  <>
                    <div
                      className={cn(
                        sortedTimeline.length > 5 && "max-h-[380px] overflow-y-auto pr-1",
                      )}
                    >
                      <ol className="relative space-y-4 border-l-2 border-border pl-4 ml-2">
                        {visibleTimeline.map((item, idx) => {
                          const { name, role } = getActivityActor(
                            item as any,
                            farmerName,
                            technicianName || undefined,
                          );
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
                                    : "bg-primary ring-4 ring-primary/20",
                                )}
                              />
                              <div>
                                <p className="font-mono text-xs text-muted-foreground">
                                  {formatActivityDate((item as any).created_at || (item as any).at)}
                                </p>
                                <p
                                  className={cn(
                                    "text-sm font-semibold",
                                    isDestructive
                                      ? "text-destructive font-bold"
                                      : "text-foreground",
                                  )}
                                >
                                  {action}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {name} ·{" "}
                                  <span className="font-medium text-foreground/80">{role}</span>
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
                            <ChevronDown className="h-3.5 w-3.5" /> Show all {sortedTimeline.length}{" "}
                            events
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
          {status !== "COMPLETED" &&
            status !== "CANCELLED" &&
            status !== "CANCELLATION_REQUESTED" && (
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
              Are you sure you want to approve this cancellation request? This will mark the repair
              ticket as Cancelled, notify both the farmer and assigned technician, and restore
              equipment to Operational status (if no other active repairs exist).
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
                  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-5 font-semibold text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors",
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
              Decline this cancellation request and resume repair work. The ticket will revert to
              its previous status (
              <strong>
                {STAFF_LABEL[(isReal && r.cancellation_previous_status) || "ACCEPTED"] ||
                  "previous status"}
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

      {/* UPDATE PART ETA MODAL */}
      <Dialog
        open={Boolean(partEtaTarget)}
        onOpenChange={(open) => !open && setPartEtaTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Coordinate Expected Arrival (ETA)</DialogTitle>
            <DialogDescription>
              Set or update expected delivery date &amp; time for{" "}
              {partEtaTarget?.part?.name || "spare part"}. Updates the repair hold and farmer delay
              status in real time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Expected Arrival Date &amp; Time</Label>
              <DateTimePicker value={partNewEta} onChange={setPartNewEta} />
              <p className="mt-1 text-xs text-muted-foreground">
                Set when supplier delivery or restock is expected at the Service Centre depot.
              </p>
            </div>

            <div>
              <Label className="text-xs">Coordination Notes (Optional)</Label>
              <input
                type="text"
                value={partEtaNotes}
                onChange={(e) => setPartEtaNotes(e.target.value)}
                placeholder="e.g. Sourced from regional depot / courier delivery"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              disabled={updatingPartEta}
              onClick={() => setPartEtaTarget(null)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={updatingPartEta}
              onClick={handleSavePartEta}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {updatingPartEta ? "Saving..." : "Save ETA"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* UPDATE SOURCING HOLD ETA MODAL */}
      <Dialog
        open={Boolean(sourcingEtaTarget)}
        onOpenChange={(open) => !open && setSourcingEtaTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Coordinate Sourcing Hold Expected Arrival</DialogTitle>
            <DialogDescription>
              Set or update expected arrival date &amp; time for{" "}
              {sourcingEtaTarget?.part || "spare part"}. Updates the repair hold and farmer delay
              status in real time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Expected Arrival Date &amp; Time</Label>
              <DateTimePicker value={sourcingNewEta} onChange={setSourcingNewEta} />
              <p className="mt-1 text-xs text-muted-foreground">
                Set when field or external supplier delivery is expected. Physical depot handoff is
                locked.
              </p>
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              disabled={updatingSourcingEta}
              onClick={() => setSourcingEtaTarget(null)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={updatingSourcingEta}
              onClick={handleSaveSourcingEta}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {updatingSourcingEta ? "Saving..." : "Save ETA"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WORKSHOP DROP-OFF DIALOGS (Phase 14 M4) */}
      {showCheckinDialog && isReal && (
        <WorkshopCheckinDialog
          open={showCheckinDialog}
          onOpenChange={setShowCheckinDialog}
          repair={{
            id: r.id,
            job_number: jobNumber,
            equipment_make: equipmentMake,
            equipment_model: equipmentModel,
            farmer_name: farmerName,
            farmer_phone: farmerPhone,
            facility_id: r.facility_id,
          }}
          facilityName={facilityDetail?.name || "Workshop"}
          onSuccess={() => void loadData()}
        />
      )}

      {showReceiptModal && isReal && r.drop_off_receipt_number && (
        <CustodyReceiptModal
          open={showReceiptModal}
          onOpenChange={setShowReceiptModal}
          data={{
            receiptNumber: r.drop_off_receipt_number,
            droppedOffAt: r.dropped_off_at || new Date().toISOString(),
            jobNumber: jobNumber,
            equipmentMake: equipmentMake,
            equipmentModel: equipmentModel,
            farmerName: farmerName,
            farmerPhone: farmerPhone,
            facilityName: facilityDetail?.name || "Workshop",
            facilityAddress: facilityDetail
              ? `${facilityDetail.village}, ${facilityDetail.tahsil}`
              : undefined,
          }}
        />
      )}

      {showExtendDialog && isReal && reservationDetail && (
        <ExtendReservationDialog
          open={showExtendDialog}
          onOpenChange={setShowExtendDialog}
          reservationId={reservationDetail.id}
          jobNumber={jobNumber}
          onSuccess={() => void loadData()}
        />
      )}

      {showRerouteDialog && isReal && (
        <RerouteWorkshopDialog
          open={showRerouteDialog}
          onOpenChange={setShowRerouteDialog}
          repairRequestId={r.id}
          currentFacilityId={r.facility_id}
          jobNumber={jobNumber}
          onSuccess={() => void loadData()}
        />
      )}

      {showReleaseDialog && isReal && (
        <ReleaseEquipmentDialog
          open={showReleaseDialog}
          onOpenChange={setShowReleaseDialog}
          repairRequestId={r.id}
          jobNumber={jobNumber}
          equipmentSummary={`${equipmentMake} ${equipmentModel}`}
          farmerName={farmerName}
          onSuccess={() => void loadData()}
        />
      )}
    </div>
  );
}
