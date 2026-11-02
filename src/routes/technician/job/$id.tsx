import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Camera,
  Clock,
  Loader2,
  Lock,
  MapPin,
  PackageSearch,
  Plus,
  Trash2,
  Truck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable, Timeline } from "@/components/repair-parts";
import { DirectionsButton } from "@/components/directions-button";
import { OnDemandTranslation } from "@/components/on-demand-translation";
import { RouteEstimateCard } from "@/components/route-estimate-card";
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
import { fileToSmallDataUrl } from "@/lib/image";
import {
  actions,
  ago,
  fmtTime,
  inr,
  quoteTotals,
  STAFF_LABEL,
  useTB,
  type BlockerPartItem,
  type Quote,
  type QuotePart,
  type Repair,
} from "@/lib/tb-store";
import {
  formatEtaDateTime as formatEta,
  getEtaPresets,
  toDateTimeLocalString,
  valueToDateTimeLocal,
} from "@/lib/date-utils";
import { useAuth } from "@/lib/auth";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { useRepairTicketRealtime, isUuid } from "@/hooks/use-repair-realtime";
import {
  acceptRepairRequest,
  completeRepair,
  declineRepairRequest,
  failTesting,
  getRepairRequestById,
  resumeRepair,
  startTesting,
  updatePartsEta,
  waitForParts,
  getRepairDispatchLocation,
  normalizeRepairDoorstepUrgency,
  type RepairDispatchLocation,
  type RepairRequestDetail,
} from "@/lib/services/repair-requests";
import {
  addRepairNote,
  getRepairNotes,
  type RepairNoteWithAuthor,
} from "@/lib/services/repair-notes";
import { QuoteComparison } from "@/components/quote-comparison";
import { RepairChat } from "@/components/repair-chat";
import { PartsPickupCard } from "@/components/parts-pickup-card";
import {
  getRepairPartRequests,
  getServiceCentreParts,
  requestServiceCentrePart,
  syncPartRequestToQuoteLines,
  type ServiceCentrePart,
  type ServiceCentrePartRequestDetail,
} from "@/lib/services/parts-desk";
import {
  createQuote,
  getQuotesForRepair,
  getQuoteVersions,
  parseClarificationNote,
  reviseQuote,
  type CreateQuoteInput,
  type CreateQuoteItemInput,
  type QuoteDetail,
  type QuoteVersionDetail,
} from "@/lib/services/quotes";

export const Route = createFileRoute("/technician/job/$id")({
  head: () => meta("Job", "Repair job details and actions."),
  component: Job,
  errorComponent: ({ error, reset }) => {
    const err = error as Error | undefined;
    return (
      <div className="space-y-5 p-4">
        <ContextualBack to="/technician" label="Jobs" />
        <Card className="border-destructive text-destructive space-y-2">
          <p className="font-bold text-lg">Failed to load technician job</p>
          <p className="text-sm">
            {err?.message || "An unexpected error occurred while loading this job."}
          </p>
          {err?.stack && (
            <pre className="text-xs bg-muted/60 p-3 rounded-lg overflow-x-auto text-foreground font-mono">
              {err.stack}
            </pre>
          )}
          <button
            onClick={() => reset()}
            className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
        </Card>
      </div>
    );
  },
});

function toQuoteView(q: QuoteDetail): Quote {
  const sentAtMs = q.created_at ? new Date(q.created_at).getTime() : Date.now();
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
    sentAt: isNaN(sentAtMs) ? Date.now() : sentAtMs,
  };
}

function Job() {
  const { id } = Route.useParams();
  const { profile, ready } = useAuth();
  const nav = useNavigate();
  const tb = useTB();
  const hasLoadedRef = useRef(false);
  const [r, setR] = useState<RepairRequestDetail | null>(null);
  const [quotes, setQuotes] = useState<QuoteDetail[]>([]);
  const [quoteVersions, setQuoteVersions] = useState<QuoteVersionDetail[]>([]);
  const [notes, setNotes] = useState<RepairNoteWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [dispatchLocation, setDispatchLocation] = useState<RepairDispatchLocation | null>(null);
  const [partRequests, setPartRequests] = useState<ServiceCentrePartRequestDetail[]>([]);

  const loadData = useCallback(async () => {
    try {
      if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setError(null);
      let repairData = await getRepairRequestById(id).catch(() => null);
      if (!repairData) {
        // Fallback to demo store if it's a demo ticket (e.g. TB-5653 or in-memory ticket)
        const demo = tb.repairs.find((x) => x.id === id || (x as any).jobNumber === id);
        if (demo) {
          const eq = tb.equipment.find((e) => e.id === demo.equipmentId);
          const tech = tb.technicians.find((t) => t.id === demo.technicianId);
          const farmer = tb.farmers.find((f) => f.id === demo.farmerId);
          repairData = {
            id: demo.id,
            job_number: demo.id,
            farmer_id: demo.farmerId,
            technician_id: demo.technicianId || null,
            equipment_id: demo.equipmentId,
            status: demo.status,
            is_testing: Boolean(demo.testing),
            description: demo.description,
            symptoms: demo.symptoms,
            location: demo.location,
            created_at: new Date(demo.createdAt).toISOString(),
            updated_at: new Date(demo.statusSince || demo.createdAt).toISOString(),
            clarification_note: demo.clarification || null,
            parts_hold: demo.parts || null,
            completion_details: demo.completion || null,
            cancellation_reason: (demo as any).cancellation?.reason || null,
            cancellation_note: (demo as any).cancellation?.note || null,
            cancellation_requested_at: (demo as any).cancellation?.requestedAt
              ? new Date((demo as any).cancellation.requestedAt).toISOString()
              : null,
            service_type: demo.service_type || demo.serviceType || "DOORSTEP",
            urgency_level: demo.urgency_level || demo.urgencyLevel || "STANDARD",
            is_machine_stopped: Boolean(demo.is_machine_stopped ?? demo.isMachineStopped),
            preferred_time_slot: demo.preferred_time_slot || demo.preferredTimeSlot || null,
            field_landmark: demo.field_landmark || demo.fieldLandmark || null,
            equipment: eq
              ? {
                  id: eq.id,
                  farmer_id: eq.farmerId,
                  make: eq.make,
                  model: eq.model,
                  year: eq.year,
                  serial_number: eq.serial,
                  operating_hours: eq.hours,
                  photo_url: eq.photo || null,
                  status: eq.status,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              : null,
            farmer: farmer
              ? {
                  id: farmer.id,
                  full_name: farmer.name,
                  phone: farmer.phone,
                  village: farmer.village,
                }
              : null,
            technician: tech
              ? {
                  id: tech.id,
                  full_name: tech.name,
                  phone: tech.phone,
                  village: tech.workshop,
                }
              : null,
            repair_timeline: (demo.timeline || []).map((t, idx) => ({
              id: `tl-${idx}`,
              repair_request_id: demo.id,
              status: t.status,
              note: t.note || null,
              created_at: new Date(t.at).toISOString(),
              created_by_role: t.by,
              created_by_id: null,
              created_by: null,
            })),
          } as any;
        }
      }

      if (!repairData) {
        setR(null);
        setError("Repair job not found.");
        return;
      }
      const [quotesData, notesData, versionsData, dispatchLocData, reqsData] = await Promise.all([
        getQuotesForRepair(repairData.id).catch(() => []),
        getRepairNotes(repairData.id).catch(() => []),
        getQuoteVersions(repairData.id).catch(() => []),
        getRepairDispatchLocation(repairData.id).catch(() => null),
        getRepairPartRequests(repairData.id).catch(() => []),
      ]);
      setR(repairData);
      setQuotes(quotesData);
      setNotes(notesData);
      setQuoteVersions(versionsData);
      setDispatchLocation(dispatchLocData);
      setPartRequests(reqsData);
      hasLoadedRef.current = true;
    } catch (err: any) {
      console.error("[TerraByte] Failed to load job details:", err);
      if (!hasLoadedRef.current) {
        setError(err?.message || "Failed to load repair job");
      }
    } finally {
      setLoading(false);
    }
  }, [id, tb.repairs, tb.equipment, tb.technicians, tb.farmers]);

  useEffect(() => {
    void loadData();
  }, [
    loadData,
    tb.serviceCentrePartRequests,
    tb.serviceCentreParts,
    tb.repairs,
    tb.serviceCentrePartSales,
  ]);

  // Scoped Supabase Realtime synchronization with debounced coalescing
  useRepairTicketRealtime({
    repairId: r?.id || id,
    onUpdate: loadData,
  });

  if (loading) {
    return (
      <div className="space-y-5">
        <ContextualBack to="/technician" label="Jobs" />
        <div className="py-12 text-center text-muted-foreground">Loading job details…</div>
      </div>
    );
  }

  if (error || !r) {
    return (
      <div className="space-y-5">
        <ContextualBack to="/technician" label="Jobs" />
        <Card className="text-destructive">
          <p>{error || "Repair job not found."}</p>
          <Link to="/technician" className="mt-2 inline-block font-semibold text-primary underline">
            Back to jobs
          </Link>
        </Card>
      </div>
    );
  }

  if (!ready && !profile) {
    return (
      <div className="space-y-5">
        <ContextualBack to="/technician" label="Jobs" />
        <div className="py-12 text-center text-muted-foreground">Loading session…</div>
      </div>
    );
  }

  const isAssignedToMe = r.technician_id === profile?.id;
  const isUnassignedIncoming = !r.technician_id && r.status === "REQUESTED";
  const isStaffAuthorized =
    profile?.role === "service_centre" || isAssignedToMe || isUnassignedIncoming;

  if (!isStaffAuthorized && r.status !== "COMPLETED" && r.status !== "CANCELLED") {
    return (
      <div className="space-y-5">
        <ContextualBack to="/technician" label="Jobs" />
        <Card>
          This job isn't assigned to you.{" "}
          <Link to="/technician" className="font-semibold text-primary">
            Back to jobs
          </Link>
        </Card>
      </div>
    );
  }

  const e = r.equipment;
  const f = r.farmer;
  const createdAtMs = r.created_at ? new Date(r.created_at).getTime() : Date.now();
  const safeCreatedAtMs = isNaN(createdAtMs) ? Date.now() : createdAtMs;
  const statusSinceMs = r.status_since ? new Date(r.status_since).getTime() : safeCreatedAtMs;
  const safeStatusSinceMs = isNaN(statusSinceMs) ? safeCreatedAtMs : statusSinceMs;

  const demoRepair = tb.repairs.find(
    (x) =>
      x.id === id || (x as any).jobNumber === id || (r && (x.id === r.job_number || x.id === r.id)),
  );

  const pendingQuote = quotes.find(
    (q) =>
      q.status === "PENDING" &&
      ((q.quote_items && q.quote_items.length > 0) || Number(q.labour_amount || 0) > 0),
  );
  const approvedQuote = quotes.find((q) => q.status === "APPROVED");
  const latestQuote = quotes[quotes.length - 1];
  const activeQuote = pendingQuote || approvedQuote || latestQuote;
  const viewQuote = activeQuote ? toQuoteView(activeQuote) : demoRepair?.quote || undefined;

  const breakdownPhotos: string[] = Array.isArray(r.photos)
    ? r.photos.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : typeof r.photos === "string"
      ? (() => {
          const raw = (r.photos as string).trim();
          if (raw.startsWith("[") && raw.endsWith("]")) {
            try {
              const parsed = JSON.parse(raw);
              return Array.isArray(parsed)
                ? parsed.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                : [raw];
            } catch {
              return [raw];
            }
          }
          return raw ? [raw] : [];
        })()
      : [];

  const symptoms: string[] = Array.isArray(r.symptoms)
    ? r.symptoms.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : typeof r.symptoms === "string" && (r.symptoms as string).trim()
      ? [(r.symptoms as string).trim()]
      : [];

  const adaptedRepair: Repair = {
    id: r.job_number || r.id,
    equipmentId: r.equipment_id,
    farmerId: r.farmer_id,
    technicianId: r.technician_id || "",
    status: r.status,
    statusSince: safeStatusSinceMs,
    createdAt: safeCreatedAtMs,
    location: r.location,
    symptoms,
    description: r.description,
    photos: breakdownPhotos,
    assessment: (r.assessment as any) || {},
    ...(viewQuote ? { quote: viewQuote } : {}),
    ...(r.clarification_note ? { clarification: r.clarification_note } : {}),
    ...(r.parts_hold
      ? {
          parts: {
            part: (r.parts_hold as any).part || "Spare part",
            reason: (r.parts_hold as any).reason || "Parts hold",
            eta: (r.parts_hold as any).eta || "TBD",
            note: (r.parts_hold as any).note || "",
            items: Array.isArray((r.parts_hold as any).items) ? (r.parts_hold as any).items : [],
            allPartsArrived: Boolean((r.parts_hold as any).allPartsArrived),
            revisedCompletion:
              (r.parts_hold as any).revisedCompletion ||
              (r.parts_hold as any).revised_completion ||
              "",
            since:
              typeof (r.parts_hold as any).since === "number" && !isNaN((r.parts_hold as any).since)
                ? (r.parts_hold as any).since
                : new Date(
                    (r.parts_hold as any).since || r.status_since || safeCreatedAtMs,
                  ).getTime() || safeCreatedAtMs,
          },
        }
      : {}),
    ...(r.completion_details ? { completion: r.completion_details as any } : {}),
    testing: Boolean(r.is_testing),
    ...(r.verified_at ? { verifiedAt: new Date(r.verified_at).getTime() } : {}),
    declinedBy: r.declined_by || [],
    notes: (Array.isArray(notes) ? notes : []).map((n) => ({
      text: n.note_text || "",
      by: (n.author?.role === "admin"
        ? "admin"
        : n.author?.role === "farmer"
          ? "farmer"
          : "technician") as any,
      at: n.created_at ? new Date(n.created_at).getTime() : safeCreatedAtMs,
    })),
    timeline: (Array.isArray(r.repair_timeline) ? r.repair_timeline : []).map((tl) => ({
      status: tl.status as any,
      by: (tl.created_by_role === "admin"
        ? "admin"
        : tl.created_by_role === "farmer"
          ? "farmer"
          : "technician") as any,
      at: tl.created_at ? new Date(tl.created_at).getTime() : safeCreatedAtMs,
      note: tl.note || "",
    })),
  };

  return (
    <div className="space-y-5">
      <ContextualBack to="/technician" label="Jobs" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm text-muted-foreground">
            Job {r.job_number || r.id} · {ago(safeCreatedAtMs)} ago
          </p>
          <h1 className="text-3xl font-bold">{e ? `${e.make} ${e.model}` : "Equipment"}</h1>
          <p className="text-sm text-muted-foreground">
            {e?.type} · {e?.year} · {e?.operating_hours?.toLocaleString("en-IN")} hrs ·{" "}
            <span className="font-mono">{e?.serial_number}</span>
          </p>
        </div>
        <StatusPill r={{ status: r.status, testing: r.is_testing }} audience="staff" />
      </div>

      {/* Prominent Cancellation Work-Hold Banner (CANCELLATION_REQUESTED) */}
      {r.status === "CANCELLATION_REQUESTED" && (
        <section className="overflow-hidden rounded-2xl border-2 border-warning bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-warning px-5 py-3.5 font-display text-lg font-bold text-warning-foreground">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 shrink-0" />
              <span>Cancellation Request Under Review</span>
            </div>
            <span className="rounded-full bg-warning-foreground/15 px-2.5 py-0.5 text-xs font-mono font-semibold text-warning-foreground">
              Work on hold
            </span>
          </div>

          <div className="space-y-4 p-5">
            <p className="text-sm text-foreground">
              The farmer has submitted a formal cancellation request for repair ticket{" "}
              <b className="font-mono">{r.job_number || r.id}</b>. The Service Centre is currently
              reviewing the request.
            </p>

            <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Cancellation Reason</Label>
                  <p className="font-bold text-foreground">
                    {r.cancellation_reason || "Alternative arrangement / local repair"}
                  </p>
                </div>
                <div>
                  <Label>Requested Time</Label>
                  <p className="font-semibold text-foreground">
                    {r.cancellation_requested_at
                      ? formatEtaDateTime(r.cancellation_requested_at)
                      : ago(new Date(r.status_since).getTime()) + " ago"}
                  </p>
                </div>
                <div>
                  <Label>Previous Repair Status</Label>
                  <p className="font-medium text-foreground">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-semibold">
                      {STAFF_LABEL[r.cancellation_previous_status || "ACCEPTED"] || "In progress"}
                    </span>
                  </p>
                </div>
                <div>
                  <Label>Current Action Required</Label>
                  <p className="font-semibold text-warning-foreground">
                    Do not proceed with repair work
                  </p>
                </div>
              </div>

              {r.cancellation_note && (
                <div className="pt-2 border-t border-warning/20">
                  <Label>Farmer Explanation / Note</Label>
                  <p className="rounded-lg bg-card/70 border border-warning/20 p-3 text-sm italic text-foreground">
                    "{r.cancellation_note}"
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-xl bg-muted/60 p-3.5 text-xs text-muted-foreground border border-border/50 space-y-1">
              <p className="font-semibold text-foreground">Instructions while on hold:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>All active physical repair work and parts ordering are temporarily paused.</li>
                <li>
                  Normal repair progression actions (quotes, parts, testing, completion) are locked
                  until the Service Centre resolves the request.
                </li>
                <li>
                  You will receive a notification as soon as the Service Centre reaches a decision.
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Prominent Cancelled Banner (CANCELLED) */}
      {r.status === "CANCELLED" && (
        <section className="overflow-hidden rounded-2xl border-2 border-border bg-card">
          <div className="flex items-center gap-2 bg-muted px-5 py-3 font-display text-lg font-bold text-foreground">
            <XCircle className="h-5 w-5 text-destructive" /> Repair Cancelled
          </div>
          <div className="space-y-4 p-5 text-sm">
            <p className="text-foreground">
              This repair ticket was cancelled by the Service Centre upon farmer request. Equipment
              has been restored to Operational status. No further action is required.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 rounded-xl bg-muted/40 p-4">
              <div>
                <Label>Cancellation Reason</Label>
                <p className="font-semibold text-foreground">
                  {r.cancellation_reason || "Cancelled"}
                </p>
              </div>
              <div>
                <Label>Resolution Status</Label>
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

      {/* Declined / Resumed Notice */}
      {r.cancellation_admin_response &&
        r.status !== "CANCELLED" &&
        r.status !== "CANCELLATION_REQUESTED" && (
          <div className="rounded-xl border border-info/30 bg-info/10 p-4 text-sm space-y-1">
            <p className="font-semibold text-info flex items-center gap-1.5">
              <Clock className="h-4 w-4" /> Cancellation Request Declined · Work Resumed
            </p>
            <p className="text-foreground text-xs">
              The previous cancellation request was declined by the Service Centre with explanation:{" "}
              <span className="italic font-medium">"{r.cancellation_admin_response}"</span>. Repair
              work on this job has resumed.
            </p>
          </div>
        )}

      {/* Critical Field Stoppage Alert Banner */}
      {(() => {
        const norm = normalizeRepairDoorstepUrgency(r);
        if (
          norm.urgency_level === "CRITICAL" &&
          norm.is_machine_stopped &&
          r.status !== "CANCELLED" &&
          r.status !== "COMPLETED"
        ) {
          return (
            <div className="rounded-xl border-2 border-destructive/60 bg-destructive/10 p-4 text-sm space-y-1 shadow-xs">
              <p className="font-bold text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Field Operations Halted · Critical Field
                Stoppage
              </p>
              <p className="text-foreground text-xs leading-relaxed">
                Farmer reported that the machine is completely stopped in the field. Fieldwork is
                interrupted and requires prioritized technical intervention.
              </p>
            </div>
          );
        }
        return null;
      })()}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Farmer</Label>
            <p className="font-semibold">{f?.full_name || "Farmer"}</p>
            <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-1.5 mt-0.5">
              <span>{r.location}</span>
              {dispatchLocation ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <MapPin className="h-3 w-3" /> Exact GPS saved (
                  {formatGpsAccuracy(dispatchLocation.accuracy)})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <MapPin className="h-3 w-3" /> Coarse location only
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end justify-end">
            {f?.phone && r.status !== "CANCELLED" ? (
              <CallButton phone={f.phone} label="Call farmer" className="flex-1 sm:flex-initial" />
            ) : null}
            <DirectionsButton
              dispatchLocation={dispatchLocation}
              fallbackLocation={r.location}
              isAuthorized={r.technician_id === profile?.id || profile?.role === "service_centre"}
              className="flex-1 sm:flex-initial"
            />
          </div>
          {dispatchLocation && r.status !== "CANCELLED" && r.status !== "COMPLETED" && (
            <div className="sm:col-span-2 pt-1 border-t border-border/60">
              <RouteEstimateCard repairId={r.id} hasGpsLocation={Boolean(dispatchLocation)} />
            </div>
          )}

          {/* Phase 10.2 Service Logistics & Operational Urgency */}
          {(() => {
            const norm = normalizeRepairDoorstepUrgency(r);
            const isCriticalStopped = norm.urgency_level === "CRITICAL" && norm.is_machine_stopped;
            return (
              <div
                className={cn(
                  "sm:col-span-2 rounded-xl border p-4 space-y-3",
                  isCriticalStopped
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border/70 bg-muted/20",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Service Mode */}
                    {norm.service_type === "DOORSTEP" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                        <Truck className="h-3.5 w-3.5" /> Doorstep / On-Field Service
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground border border-border">
                        <Building2 className="h-3.5 w-3.5" /> Workshop Drop-off
                      </span>
                    )}

                    {/* Operational Urgency */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        norm.urgency_level === "CRITICAL"
                          ? "bg-destructive/15 text-destructive font-bold"
                          : norm.urgency_level === "HIGH"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold"
                            : norm.urgency_level === "STANDARD"
                              ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium"
                              : "bg-muted text-muted-foreground font-normal",
                      )}
                    >
                      {norm.urgency_level === "CRITICAL" && <AlertTriangle className="h-3 w-3" />}
                      Urgency:{" "}
                      {norm.urgency_level === "CRITICAL"
                        ? "Critical"
                        : norm.urgency_level === "HIGH"
                          ? "High"
                          : norm.urgency_level === "STANDARD"
                            ? "Standard"
                            : "Flexible"}
                    </span>

                    {/* Machine Stoppage Status */}
                    {norm.is_machine_stopped ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-bold text-destructive">
                        <AlertTriangle className="h-3 w-3" /> Machine Stopped in Field
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        Partial operation / Not stopped
                      </span>
                    )}
                  </div>

                  {norm.preferred_time_slot && (
                    <div className="text-xs font-medium text-muted-foreground">
                      Farmer Availability:{" "}
                      <span className="font-semibold text-foreground">
                        {norm.preferred_time_slot}
                      </span>
                    </div>
                  )}
                </div>

                {/* Field Landmark (Doorstep only / when present) */}
                {norm.service_type === "DOORSTEP" && Boolean(norm.field_landmark?.trim()) && (
                  <div className="rounded-lg bg-card border border-border p-3 text-xs space-y-1">
                    <p className="font-bold text-foreground flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-primary" /> Field Landmark & Access
                      Instructions
                    </p>
                    <p className="text-muted-foreground whitespace-pre-wrap">
                      {norm.field_landmark}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="sm:col-span-2">
            <Label>Reported symptoms</Label>
            <div className="flex flex-wrap gap-1.5">
              {symptoms.length > 0 ? (
                symptoms.map((x) => (
                  <span
                    key={x}
                    className="rounded-lg bg-destructive/10 px-2 py-1 text-sm font-semibold text-destructive"
                  >
                    {x}
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground italic">No symptoms specified</span>
              )}
            </div>
          </div>
          {r.description && (
            <div className="sm:col-span-2">
              <Label>Farmer's description</Label>
              <p>"{r.description}"</p>
              <OnDemandTranslation text={r.description} />
            </div>
          )}
          <div className="sm:col-span-2 space-y-2 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <Label className="uppercase text-xs tracking-wider text-muted-foreground font-bold">
                Reported breakdown photos
              </Label>
              {breakdownPhotos.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {breakdownPhotos.length} {breakdownPhotos.length === 1 ? "photo" : "photos"}
                </span>
              )}
            </div>
            {breakdownPhotos.length > 0 ? (
              <div className="flex flex-wrap gap-2.5 pt-1">
                {breakdownPhotos.map((p, i) => (
                  <ClickableImage
                    key={i}
                    src={p}
                    alt={`Breakdown photo ${i + 1}`}
                    className="h-24 w-24 rounded-xl border border-border shadow-xs"
                    thumbnailClassName="h-24 w-24 object-cover"
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic py-1">
                No photos attached by farmer
              </p>
            )}
          </div>
        </div>
      </Card>

      {r.status === "REQUESTED" &&
        (declineOpen ? (
          <DeclineBox
            repairId={r.id}
            onDone={() => nav({ to: "/technician" })}
            onCancel={() => setDeclineOpen(false)}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setDeclineOpen(true)} className={btn.ghost}>
              Decline job
            </button>
            <button
              disabled={accepting}
              onClick={async () => {
                setAccepting(true);
                try {
                  await acceptRepairRequest(r.id);
                  toast.success("Job accepted. Farmer notified.");
                  await loadData();
                } catch (err: any) {
                  toast.error(err?.message || "Failed to accept job");
                } finally {
                  setAccepting(false);
                }
              }}
              className={cn(btn.primary, "h-14 text-lg disabled:opacity-50")}
            >
              {accepting ? "Accepting…" : "Accept job"}
            </button>
          </div>
        ))}

      <AssessmentCard r={adaptedRepair} />

      {/* Read-only quotation context when on hold */}
      {r.status === "CANCELLATION_REQUESTED" && adaptedRepair.quote && (
        <Card className="opacity-90">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-bold">Quotation on hold</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-warning/15 text-warning-foreground border border-warning/30">
              Review pending
            </span>
          </div>
          <QuoteTable q={adaptedRepair.quote} />
        </Card>
      )}

      {/* Read-only parts hold context when on hold */}
      {r.status === "CANCELLATION_REQUESTED" && r.parts_hold && (
        <Card className="opacity-90">
          <Label>Parts order on hold</Label>
          <p className="mt-1 text-sm font-semibold text-foreground">
            Part: {(r.parts_hold as any).part || "Required part"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Parts procurement paused pending Service Centre decision.
          </p>
        </Card>
      )}

      {/* Read-only quotation context when cancelled */}
      {r.status === "CANCELLED" && adaptedRepair.quote && (
        <Card className="opacity-80">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-bold text-muted-foreground">Quotation (cancelled)</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
              Closed
            </span>
          </div>
          <QuoteTable q={adaptedRepair.quote} />
        </Card>
      )}

      {pendingQuote ? (
        <Card className="border-accent">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Lock className="h-4 w-4 text-accent" /> Quote v{pendingQuote.version} (Pending Farmer Review)
            </h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">
              Awaiting Farmer
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            This quotation has been submitted to the farmer. Repair work is locked until the farmer
            approves or requests changes.
          </p>
          <QuoteTable q={toQuoteView(pendingQuote)} />
          <div className="mt-4 pt-3 border-t border-border/60 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">Next Available Actions:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Wait for the farmer to review and approve the quote.</li>
              <li>
                If the farmer requests clarification or changes, status will advance to{" "}
                <b>Changes Requested</b> and you can submit a revised quote.
              </li>
              <li>
                Use the ticket chat below to discuss details or answer questions with the farmer.
              </li>
            </ul>
          </div>
        </Card>
      ) : (r.status === "ACCEPTED" || r.status === "QUOTE_REVISED") ? (
        <QuoteBuilder
          repairId={r.id}
          status={r.status}
          clarification={r.clarification_note}
          previousQuote={latestQuote}
          defaultPartName={(r.assessment as any)?.partsCategory?.[0] || ""}
          partRequests={partRequests}
          onDone={loadData}
        />
      ) : r.status === "WAITING_FOR_PARTS" && !approvedQuote ? (
        <QuoteBuilder
          repairId={r.id}
          status={r.status}
          clarification={r.clarification_note}
          previousQuote={latestQuote}
          defaultPartName={(r.assessment as any)?.partsCategory?.[0] || ""}
          partRequests={partRequests}
          onDone={loadData}
        />
      ) : r.status === "QUOTE_PENDING" ? (
        <Card className="border-accent">
          <p className="mb-3 flex items-center gap-2 font-semibold">
            <Lock className="h-4 w-4" /> Waiting for farmer approval — repair work is locked until
            approved.
          </p>
          {adaptedRepair.quote ? (
            <QuoteTable q={adaptedRepair.quote} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Quote submitted. Awaiting farmer response.
            </p>
          )}
        </Card>
      ) : null}

      {quoteVersions.length >= 2 &&
        quoteVersions[quoteVersions.length - 2] &&
        quoteVersions[quoteVersions.length - 1] && (
          <QuoteComparison
            v1={quoteVersions[quoteVersions.length - 2]}
            v2={quoteVersions[quoteVersions.length - 1]}
          />
        )}

      {!pendingQuote && approvedQuote && (
        <Card className="border-success/30 bg-card">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-bold flex items-center gap-2 text-foreground">
              Approved quote (v{approvedQuote.version})
            </h2>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-success/15 text-success border border-success/30">
              Authorized by Farmer
            </span>
          </div>
          <QuoteTable q={toQuoteView(approvedQuote)} />
        </Card>
      )}

      {r.status === "IN_PROGRESS" && !pendingQuote && (
        <InProgress
          repairId={r.id}
          r={adaptedRepair}
          notes={notes}
          onUpdate={loadData}
          isQuoteApproved={Boolean(approvedQuote)}
          hasPendingParts={
            partRequests.length > 0
              ? partRequests.some((pr) => pr.status === "PENDING")
              : Boolean(
                  (r.parts_hold as any)?.items?.some((it: any) => it.status === "PENDING") ||
                  (adaptedRepair.parts as any)?.items?.some((it: any) => it.status === "PENDING"),
                )
          }
        />
      )}

      {r.status === "WAITING_FOR_PARTS" && (
        <Waiting
          repairId={r.id}
          r={adaptedRepair}
          onUpdate={loadData}
          hasPendingQuote={Boolean(pendingQuote)}
          isQuoteApproved={Boolean(approvedQuote)}
          partRequests={partRequests}
        />
      )}

      {["IN_PROGRESS", "WAITING_FOR_PARTS", "ACCEPTED", "QUOTE_REVISED", "QUOTE_PENDING"].includes(
        r.status,
      ) && (
        <PartsPickupCard
          repairId={r.id}
          repairStatus={r.status}
          isAssigned={r.technician_id === profile?.id}
          partRequests={partRequests}
          sourcingHolds={(
            ((r.parts_hold as any)?.items || demoRepair?.parts?.items || []) as any[]
          ).filter((item: any) => {
            const isDepot = partRequests.some(
              (req) =>
                req.id === item.id ||
                req.id.toLowerCase() === (item.id || "").toLowerCase() ||
                (item.partId && req.part_id === item.partId) ||
                req.part?.name?.toLowerCase() === (item.part || "").toLowerCase(),
            );
            return !isDepot && (item.status === "PENDING" || !item.status);
          })}
          onUpdate={loadData}
        />
      )}

      {r.status === "COMPLETED" && (
        <Card className="border-success">
          <p className="font-bold text-success">
            Completed
            {adaptedRepair.quote ? ` · ${inr(quoteTotals(adaptedRepair.quote).total)}` : ""}
          </p>
          <p className="text-sm">
            {adaptedRepair.completion?.notes ||
              (r.completion_details as any)?.notes ||
              "Repair completed and verified."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Repair completed and recorded in equipment service history.
          </p>
        </Card>
      )}

      {/* Ticket Communication Thread */}
      <RepairChat
        repairId={r.id}
        ticketNumber={r.job_number || r.id}
        farmerId={r.farmer_id}
        farmerName={f?.full_name || "Farmer"}
        technicianId={r.technician_id}
        technicianName={profile?.full_name}
      />

      <details className="rounded-2xl border border-border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Status timeline</summary>
        <div className="mt-4">
          <ol className="space-y-3 text-sm">
            {(Array.isArray(r.repair_timeline) ? r.repair_timeline : [])
              .slice()
              .reverse()
              .map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <p>
                      <b className="font-mono text-xs">{e.status}</b>{" "}
                      <span className="text-muted-foreground">
                        ·{" "}
                        {e.created_by_role === "technician"
                          ? "Technician"
                          : e.created_by_role === "admin"
                            ? "Service Centre"
                            : "Farmer"}{" "}
                        ·{" "}
                        {fmtTime(e.created_at ? new Date(e.created_at).getTime() : safeCreatedAtMs)}
                      </span>
                    </p>
                    {e.note && <p className="text-muted-foreground">{e.note}</p>}
                  </div>
                </li>
              ))}
          </ol>
        </div>
      </details>
    </div>
  );
}

function DeclineBox({
  repairId,
  onDone,
  onCancel,
}: {
  repairId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleDecline = async () => {
    const finalReason = reason === "Other" ? other.trim() : reason;
    if (!finalReason) return;
    setSubmitting(true);
    try {
      await declineRepairRequest(repairId, finalReason);
      toast("Declined — returned to dispatch");
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Failed to decline job");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="space-y-3">
      <Label>Reason for declining</Label>
      <div className="grid grid-cols-2 gap-2">
        {["Out of service area", "Wrong specialization", "Fully booked", "Other"].map((x) => (
          <button
            key={x}
            onClick={() => setReason(x)}
            className={cn(
              "min-h-12 rounded-xl border-2 p-2 text-sm font-semibold",
              reason === x ? "border-primary bg-primary/10" : "border-border",
            )}
          >
            {x}
          </button>
        ))}
      </div>
      {reason === "Other" && (
        <input
          className={input}
          maxLength={120}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Reason"
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <button disabled={submitting} onClick={onCancel} className={btn.ghost}>
          Back
        </button>
        <button
          disabled={submitting || !reason || (reason === "Other" && !other.trim())}
          onClick={handleDecline}
          className={btn.amber}
        >
          {submitting ? "Declining…" : "Confirm decline"}
        </button>
      </div>
    </Card>
  );
}

const blankPart = (): QuotePart => ({
  name: "",
  spec: "",
  qty: 1,
  price: 0,
  source: "In van stock",
});

interface QuoteBuilderProps {
  repairId: string;
  status: string;
  clarification?: string | null;
  previousQuote?: QuoteDetail | null | undefined;
  defaultPartName?: string;
  partRequests?: ServiceCentrePartRequestDetail[];
  onDone: () => Promise<void>;
}

function QuoteBuilder({
  repairId,
  status,
  clarification,
  previousQuote,
  defaultPartName,
  partRequests,
  onDone,
}: QuoteBuilderProps) {
  const tb = useTB();
  const [submitting, setSubmitting] = useState(false);
  const [technicianExplanation, setTechnicianExplanation] = useState("");
  const [catalogParts, setCatalogParts] = useState<ServiceCentrePart[]>([]);
  const hasPreviousQuote = Boolean(
    previousQuote && (previousQuote.version > 0 || isUuid(previousQuote.id)),
  );

  useEffect(() => {
    void getServiceCentreParts()
      .then(setCatalogParts)
      .catch(() => {});
  }, []);

  // Automatically sync technician part requests into quote parts
  useEffect(() => {
    if (!partRequests || partRequests.length === 0) return;

    setQ((prev) => {
      let currentParts = [...prev.parts];

      for (const req of partRequests) {
        if (req.status === "CANCELLED") continue;
        const partInfo =
          req.part ||
          catalogParts.find((cp) => cp.id === req.part_id || cp.part_number === req.part_id);
        if (!partInfo && !req.part_id) continue;

        const targetId = req.part_id;
        const targetName = partInfo?.name || "Spare part";
        const targetPrice = partInfo ? Number(partInfo.unit_price) : 0;
        const targetSpec = partInfo?.spec || partInfo?.part_number || "";

        const matchIdx = currentParts.findIndex(
          (p) =>
            (p.catalogPartId && p.catalogPartId === targetId) ||
            p.name.trim().toLowerCase() === targetName.trim().toLowerCase() ||
            (targetSpec && (p.spec || "").trim().toLowerCase() === targetSpec.trim().toLowerCase()),
        );

        if (matchIdx >= 0 && currentParts[matchIdx]) {
          const prevItem = currentParts[matchIdx]!;
          currentParts[matchIdx] = {
            ...prevItem,
            name: prevItem.name,
            qty: req.quantity,
            price: targetPrice > 0 ? targetPrice : prevItem.price,
            spec: targetSpec || prevItem.spec,
            catalogPartId: targetId,
            source: "Nagpur Service Centre Depot",
          };
        } else {
          const newLine: QuotePart = {
            name: targetName,
            spec: targetSpec,
            qty: req.quantity,
            price: targetPrice,
            source: "Nagpur Service Centre Depot",
            catalogPartId: targetId,
          };
          if (
            currentParts.length === 1 &&
            currentParts[0] &&
            !currentParts[0].name.trim() &&
            currentParts[0].qty === 1
          ) {
            currentParts = [newLine];
          } else {
            currentParts.push(newLine);
          }
        }
      }

      return {
        ...prev,
        parts: currentParts,
      };
    });
  }, [partRequests]);
  const [q, setQ] = useState<Omit<Quote, "version" | "sentAt">>(() => {
    if (previousQuote) {
      return {
        parts: (previousQuote.quote_items || []).map((item) => ({
          name: item.part_name,
          spec: item.part_spec || "",
          qty: item.quantity,
          price: Number(item.unit_price),
          source: item.part_source || "In van stock",
          catalogPartId: item.catalog_part_id || null,
        })),
        labourDesc: previousQuote.labour_description || "Inspection, repair and test run",
        labour: Number(previousQuote.labour_amount),
        taxPct: Number(previousQuote.tax_percent),
        eta: previousQuote.estimated_completion || getEtaPresets()[2]?.iso || "",
        warranty: previousQuote.warranty_terms || "90 days on parts & labour",
      };
    }
    return {
      parts: defaultPartName ? [{ ...blankPart(), name: defaultPartName }] : [],
      labourDesc: "Inspection, repair and test run",
      labour: 800,
      taxPct: 0,
      eta: getEtaPresets()[2]?.iso || "",
      warranty: "90 days on parts & labour",
    };
  });

  const setPart = (i: number, p: Partial<QuotePart>) =>
    setQ((prev) => ({
      ...prev,
      parts: prev.parts.map((x, k) => (k === i ? { ...x, ...p } : x)),
    }));

  const filledParts = q.parts.filter((p) => p.name.trim().length > 0);
  const t = quoteTotals({ ...q, parts: filledParts, version: 0, sentAt: 0 });
  const valid =
    (filledParts.length === 0
      ? Number(q.labour) > 0
      : filledParts.every((p) => p.qty > 0 && p.price >= 0)) &&
    q.labourDesc.trim().length > 0 &&
    q.eta.trim().length > 0;

  const handleSend = async () => {
    if (!valid || submitting) return;

    const activeParts = q.parts.filter((p) => p.name.trim().length > 0);
    for (const p of activeParts) {
      if (p.catalogPartId && (!p.price || Number(p.price) <= 0 || isNaN(Number(p.price)))) {
        toast.error(
          `Catalog part "${p.name}" does not have a valid customer-facing selling price. Please contact Service Centre staff to verify catalog pricing.`,
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: CreateQuoteInput = {
        repair_request_id: repairId,
        labour_description: q.labourDesc.trim(),
        labour_amount: Number(q.labour),
        tax_percent: Number(q.taxPct),
        estimated_completion: q.eta.trim(),
        ...(q.warranty.trim() ? { warranty_terms: q.warranty.trim() } : {}),
        items: activeParts.map((p) => ({
          part_name: p.name.trim(),
          quantity: Number(p.qty),
          unit_price: Number(p.price),
          part_source: p.source,
          catalog_part_id: p.catalogPartId || null,
          ...(p.spec.trim() ? { part_spec: p.spec.trim() } : {}),
        })),
      };

      const isDemo =
        !isUuid(repairId) ||
        tb.repairs.some((x) => x.id === repairId || (x as any).jobNumber === repairId);

      const hasPreviousQuote = Boolean(
        previousQuote && (previousQuote.version > 0 || isUuid(previousQuote.id)),
      );

      if (isDemo) {
        actions.sendQuote(repairId, {
          parts: activeParts,
          labourDesc: q.labourDesc.trim(),
          labour: Number(q.labour),
          taxPct: Number(q.taxPct),
          eta: q.eta.trim(),
          warranty: q.warranty.trim(),
        });
        if (isUuid(repairId)) {
          try {
            if (hasPreviousQuote && isUuid(previousQuote!.id)) {
              await reviseQuote({
                ...payload,
                previous_quote_id: previousQuote!.id,
                technician_explanation: technicianExplanation.trim() || undefined,
              });
            } else {
              await createQuote(payload);
            }
          } catch {
            // Non-fatal remote sync in demo mode
          }
        }
        toast.success(hasPreviousQuote ? "Revised quote sent to farmer" : "Quote sent to farmer");
      } else if (hasPreviousQuote && previousQuote) {
        await reviseQuote({
          ...payload,
          previous_quote_id: previousQuote.id,
          technician_explanation: technicianExplanation.trim() || undefined,
        });
        toast.success("Revised quote sent to farmer");
      } else {
        await createQuote(payload);
        toast.success("Quote sent to farmer");
      }
      await onDone();
    } catch (err: any) {
      console.error("[TerraByte] Failed to send quote:", err);
      toast.error(err?.message || "Failed to send quote");
    } finally {
      setSubmitting(false);
    }
  };

  const parsedClarification = parseClarificationNote(clarification);

  return (
    <Card className="space-y-4 border-primary/40">
      <h2 className="text-xl font-bold">
        {status === "QUOTE_REVISED" ? "Revise quote" : "Create itemized quote"}
      </h2>
      {status === "QUOTE_REVISED" && (
        <section className="rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              Farmer requested quote revision{" "}
              {previousQuote ? `(Quote v${previousQuote.version})` : ""}
            </span>
          </div>
          {parsedClarification.reason && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Reason
              </p>
              <p className="text-base font-semibold text-foreground">
                {parsedClarification.reason}
              </p>
            </div>
          )}
          {parsedClarification.explanation && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Farmer message
              </p>
              <p className="mt-1 rounded-xl bg-card p-3 text-sm italic border border-border">
                "{parsedClarification.explanation}"
              </p>
            </div>
          )}
          {parsedClarification.photo && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Attached Photo
              </p>
              <ClickableImage
                src={parsedClarification.photo}
                alt="Farmer attachment"
                className="mt-1.5 h-28 w-28"
                thumbnailClassName="h-28 w-28 object-cover"
              />
            </div>
          )}
          {previousQuote && (
            <div className="rounded-xl border border-border bg-card p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between font-bold text-foreground">
                <span>Previous Quote v{previousQuote.version}</span>
                <span className="font-mono text-sm">
                  {inr(
                    previousQuote.totals?.totalAmount ??
                      (previousQuote.quote_items || []).reduce(
                        (s, it) => s + it.quantity * it.unit_price,
                        0,
                      ) + Number(previousQuote.labour_amount),
                  )}
                </span>
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-x-4">
                <span>
                  Parts:{" "}
                  {inr(
                    previousQuote.totals?.partsTotal ??
                      (previousQuote.quote_items || []).reduce(
                        (s, it) => s + it.quantity * it.unit_price,
                        0,
                      ),
                  )}
                </span>
                <span>Labour: {inr(Number(previousQuote.labour_amount))}</span>
                <span>Est: {formatEta(previousQuote.estimated_completion || "")}</span>
              </div>
            </div>
          )}
          <div className="pt-2 border-t border-amber-500/30 space-y-1.5">
            <Label>Technician Response / Revision Explanation</Label>
            <p className="text-xs text-muted-foreground">
              {parsedClarification.reason === "Please explain labour"
                ? "Farmer asked you to explain what is included in the labour charge."
                : "Explain changes made, revised part sourcing, or adjusted labour charges to the farmer."}
            </p>
            <textarea
              className={cn(input, "h-24 resize-none py-2 text-sm leading-relaxed bg-card")}
              placeholder={
                parsedClarification.reason === "Please explain labour"
                  ? "Detail what is included in the labour charge..."
                  : "Explain revisions made to parts, pricing, or labour..."
              }
              value={technicianExplanation}
              onChange={(e) => setTechnicianExplanation(e.target.value)}
            />
          </div>
        </section>
      )}
      {status !== "QUOTE_REVISED" && clarification && (
        <p className="rounded-xl bg-accent/20 p-3 text-sm">
          <b>Farmer note:</b> "{clarification}"
        </p>
      )}
      {q.parts.length === 0 && (
        <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-center space-y-1">
          <p className="text-sm font-semibold text-foreground">
            Labour & Inspection Quote (No parts added)
          </p>
          <p className="text-xs text-muted-foreground">
            You can send a labour-only quote without parts, or click "Add part" below to include
            spare components.
          </p>
        </div>
      )}
      {q.parts.map((p, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <Label>Part {i + 1}</Label>
            <button
              aria-label="Remove part"
              onClick={() => setQ({ ...q, parts: q.parts.filter((_, k) => k !== i) })}
              className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {catalogParts.length > 0 && (
            <div>
              <select
                aria-label="Select from Depot Catalog"
                className={cn(input, "h-10 min-h-[2.5rem] py-1.5 px-3 text-xs leading-normal cursor-pointer")}
                value={p.catalogPartId || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) {
                    setPart(i, { catalogPartId: null });
                    return;
                  }
                  const found = catalogParts.find((cp) => cp.id === val || cp.part_number === val);
                  if (found) {
                    setPart(i, {
                      name: found.name,
                      spec: found.spec || found.part_number,
                      price: Number(found.unit_price),
                      source: "Service Centre Depot",
                      catalogPartId: found.id,
                    });
                  }
                }}
              >
                <option value="">-- Custom / Unlisted part --</option>
                {catalogParts.map((cp) => (
                  <option key={cp.id} value={cp.id}>
                    {cp.name} ({cp.part_number}) — ₹{cp.unit_price} [{cp.stock_quantity} on hand]
                  </option>
                ))}
              </select>
            </div>
          )}
          <input
            className={input}
            placeholder="Part name"
            value={p.name}
            onChange={(e) => setPart(i, { name: e.target.value })}
          />
          <input
            className={input}
            placeholder="Part number / spec"
            value={p.spec}
            onChange={(e) => setPart(i, { spec: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Qty</Label>
              <input
                className={input}
                inputMode="numeric"
                value={p.qty}
                onChange={(e) => setPart(i, { qty: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Unit price ₹</Label>
                {Boolean(p.catalogPartId) && (
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Catalog price (fixed)
                  </span>
                )}
              </div>
              <input
                className={cn(
                  input,
                  Boolean(p.catalogPartId) &&
                    "bg-muted cursor-not-allowed opacity-90 font-medium select-none",
                )}
                inputMode="numeric"
                value={p.price}
                readOnly={Boolean(p.catalogPartId)}
                onChange={(e) => {
                  if (!p.catalogPartId) {
                    setPart(i, { price: Math.max(0, Number(e.target.value) || 0) });
                  }
                }}
              />
            </div>
          </div>
          <select
            className={input}
            value={p.source}
            onChange={(e) => setPart(i, { source: e.target.value })}
          >
            {[
              "In van stock",
              "Workshop stock",
              "Taluka distributor",
              "Order from OEM (2-3 days)",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
      ))}
      <button
        onClick={() => setQ({ ...q, parts: [...q.parts, blankPart()] })}
        className={cn(btn.ghost, "w-full")}
      >
        <Plus className="h-4 w-4" /> Add part
      </button>
      <div>
        <Label>Labour / service description</Label>
        <input
          className={input}
          value={q.labourDesc}
          onChange={(e) => setQ({ ...q, labourDesc: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Labour ₹</Label>
          <input
            className={input}
            inputMode="numeric"
            value={q.labour}
            onChange={(e) => setQ({ ...q, labour: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
        <div>
          <Label>GST %</Label>
          <select
            className={input}
            value={q.taxPct}
            onChange={(e) => setQ({ ...q, taxPct: Number(e.target.value) })}
          >
            {[0, 5, 12, 18].map((x) => (
              <option key={x} value={x}>
                {x}%
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Est. completion</Label>
          <DateTimePicker value={q.eta} onChange={(val) => setQ({ ...q, eta: val })} />
        </div>
        <div>
          <Label>Warranty</Label>
          <input
            className={input}
            value={q.warranty}
            onChange={(e) => setQ({ ...q, warranty: e.target.value })}
          />
        </div>
      </div>
      <dl className="rounded-xl bg-muted p-3 text-sm">
        <div className="flex justify-between">
          <dt>Parts</dt>
          <dd>{inr(t.parts)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Labour</dt>
          <dd>{inr(t.labour)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Tax</dt>
          <dd>{inr(t.tax)}</dd>
        </div>
        <div className="flex justify-between font-display text-xl font-bold">
          <dt>Total</dt>
          <dd>{inr(t.total)}</dd>
        </div>
      </dl>
      <button
        disabled={!valid || submitting}
        onClick={handleSend}
        className={cn(btn.primary, "h-14 w-full text-lg disabled:opacity-50")}
      >
        {submitting
          ? "Sending quote…"
          : hasPreviousQuote
            ? `Send revised quote (v${(previousQuote?.version ?? 1) + 1}) to farmer`
            : "Send quote to farmer"}
      </button>
    </Card>
  );
}

interface InProgressProps {
  repairId: string;
  r: Repair;
  notes: RepairNoteWithAuthor[];
  onUpdate: () => Promise<void>;
  isQuoteApproved?: boolean;
  hasPendingParts?: boolean;
}

function InProgress({
  repairId,
  r,
  notes,
  onUpdate,
  isQuoteApproved = true,
  hasPendingParts = false,
}: InProgressProps) {
  const isWorkLocked = !isQuoteApproved || hasPendingParts;
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"none" | "parts" | "complete" | "test_failed">("none");
  const [catalogParts, setCatalogParts] = useState<ServiceCentrePart[]>([]);
  const [p, setP] = useState(() => {
    const presets = getEtaPresets();
    const defaultPart = r.quote?.parts[0];
    return {
      part: defaultPart?.name ?? "",
      catalogPartId: defaultPart?.catalogPartId ?? "",
      quantity: defaultPart?.qty || 1,
      reason: "Not in van stock",
      eta: presets[1]?.iso || "",
      note: "",
      revisedCompletion: presets[2]?.iso || "",
    };
  });

  useEffect(() => {
    void getServiceCentreParts()
      .then((parts) => {
        setCatalogParts(parts);
        setP((prev) => {
          if (!prev.catalogPartId && prev.part) {
            const match = parts.find(
              (cp) => cp.name.trim().toLowerCase() === prev.part.trim().toLowerCase(),
            );
            if (match) {
              return { ...prev, catalogPartId: match.id };
            }
          }
          return prev;
        });
      })
      .catch(() => {});
  }, []);
  const [failReason, setFailReason] = useState("");
  const [final, setFinal] = useState("");
  const [photo, setPhoto] = useState("");
  const [tested, setTested] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleFailTesting = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await failTesting(repairId, {
        ...(failReason.trim() ? { reason: failReason.trim() } : {}),
      });
      setMode("none");
      setFailReason("");
      toast.success("Testing failure recorded. Returned to active repair.");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to record testing failure:", err);
      toast.error(err?.message || "Failed to record testing failure");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNote = async () => {
    if (!note.trim() || noteSubmitting) return;
    setNoteSubmitting(true);
    try {
      await addRepairNote(repairId, note.trim());
      setNote("");
      toast.success("Note saved and added to timeline");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to add note:", err);
      toast.error(err?.message || "Failed to add note");
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleWaitForParts = async () => {
    if (!p.part.trim() || !p.eta.trim() || !p.reason.trim() || submitting) return;
    setSubmitting(true);
    try {
      const effectiveCatalogPartId =
        p.catalogPartId ||
        catalogParts.find((cp) => cp.name.trim().toLowerCase() === p.part.trim().toLowerCase())?.id;

      if (effectiveCatalogPartId) {
        await requestServiceCentrePart({
          repairRequestId: repairId,
          partId: effectiveCatalogPartId,
          quantity: p.quantity || 1,
          notes: p.reason.trim(),
          eta: p.eta.trim(),
          revisedCompletion: p.revisedCompletion.trim() || undefined,
          farmerNote: p.note.trim() || undefined,
        });
      } else {
        await waitForParts(repairId, {
          part: p.part.trim(),
          reason: p.reason.trim(),
          eta: p.eta.trim(),
          quantity: p.quantity || 1,
          ...(p.revisedCompletion.trim() ? { revisedCompletion: p.revisedCompletion.trim() } : {}),
          ...(p.note.trim() ? { note: p.note.trim() } : {}),
        });
      }
      setMode("none");
      toast.success(
        effectiveCatalogPartId
          ? `Part requisition created for ${p.part.trim()}. Repair paused for parts.`
          : "Repair paused. Farmer notified of the delay.",
      );
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to pause for parts:", err);
      toast.error(err?.message || "Failed to pause repair");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartTesting = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await startTesting(repairId);
      toast.success("Testing started under operational load");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to start testing:", err);
      toast.error(err?.message || "Failed to start testing");
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async () => {
    if (!final.trim()) {
      toast.error("Please enter final repair notes.");
      return;
    }
    if (!tested) {
      toast.error("Please confirm that machine was tested under load.");
      return;
    }
    if (!r.testing) {
      toast.error("Please start machine testing before completing the repair.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await completeRepair(repairId, {
        notes: final.trim(),
        ...(photo ? { photo } : {}),
        tested: true,
      });
      setMode("none");
      toast.success("Repair completed. Added to machine history.");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to complete repair:", err);
      toast.error(err?.message || "Failed to complete repair");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <Label>Add technician note</Label>
        <div className="flex gap-2">
          <input
            className={input}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Injector removed, fuel line cleaned"
          />
          <button
            disabled={!note.trim() || noteSubmitting}
            onClick={handleAddNote}
            className={cn(btn.primary, "disabled:opacity-50")}
          >
            {noteSubmitting ? "Adding…" : "Add"}
          </button>
        </div>
      </Card>
      {notes.length > 0 && (
        <Card className="space-y-2">
          <Label>Technician work notes ({notes.length})</Label>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {notes.map((n) => (
              <div key={n.id} className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span className="font-semibold text-foreground">
                    {n.author?.full_name || "Technician"}
                  </span>
                  <span>{ago(new Date(n.created_at).getTime())} ago</span>
                </div>
                <p className="text-foreground leading-relaxed">{n.note_text}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
      {mode === "none" && (
        <div className="space-y-2">
          {isWorkLocked && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-warning/40 bg-warning/5 text-xs text-warning-foreground font-semibold">
              <Lock className="h-4 w-4 shrink-0 text-warning" />
              <span>
                {!isQuoteApproved
                  ? "Repair work is locked: Quotation is awaiting farmer approval."
                  : "Testing and sign-off are locked: Requested spare parts are awaiting delivery/handoff."}
              </span>
            </div>
          )}
          {r.testing && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 rounded-xl border border-primary/40 bg-primary/5">
              <span className="flex items-center gap-2 font-semibold text-primary">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                Testing in progress under operational load
              </span>
              <button
                type="button"
                onClick={() => setMode("test_failed")}
                className="text-xs font-bold text-destructive hover:underline px-3 py-1.5 rounded-lg border border-destructive/30 hover:bg-destructive/10 whitespace-nowrap"
              >
                Testing failed — resume repair
              </button>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <button onClick={() => setMode("parts")} className={cn(btn.amber, "h-14")}>
              <PackageSearch className="h-5 w-5" /> Waiting for parts
            </button>
            {!r.testing ? (
              <button
                disabled={submitting || isWorkLocked}
                onClick={handleStartTesting}
                className={cn(btn.ghost, "h-14 disabled:opacity-50")}
              >
                {submitting ? "Starting…" : "Start testing"}
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => setMode("test_failed")}
                className={cn(btn.urgent, "h-14 text-sm font-semibold")}
              >
                Testing failed — resume repair
              </button>
            )}
            <button
              disabled={isWorkLocked}
              onClick={() => {
                if (isWorkLocked) {
                  toast.error(
                    !isQuoteApproved
                      ? "Quotation awaiting farmer approval before work can continue."
                      : "Requested parts awaiting delivery/handoff.",
                  );
                  return;
                }
                if (!r.testing) {
                  toast.error("Please start machine testing before completing the repair.");
                  return;
                }
                setMode("complete");
              }}
              className={cn(btn.primary, "h-14 disabled:opacity-50")}
            >
              Complete & sign off
            </button>
          </div>
        </div>
      )}
      {mode === "test_failed" && (
        <Card className="space-y-3 border-destructive">
          <div className="flex items-center gap-2 text-lg font-bold text-destructive">
            <AlertCircle className="h-5 w-5" /> Testing failed — return to repair
          </div>
          <p className="text-sm text-muted-foreground">
            Operational testing identified an issue. Enter details below to return this machine to
            active repair work and notify the farmer.
          </p>
          <div>
            <Label>Issue observed during testing (optional)</Label>
            <textarea
              rows={3}
              className={input}
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              placeholder="e.g. Engine temperature still rising under load, secondary seal leak..."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={submitting}
              onClick={() => {
                setMode("none");
                setFailReason("");
              }}
              className={btn.ghost}
            >
              Cancel
            </button>
            <button
              disabled={submitting}
              onClick={handleFailTesting}
              className={cn(btn.urgent, "disabled:opacity-50")}
            >
              {submitting ? "Returning…" : "Confirm failure & resume repair"}
            </button>
          </div>
        </Card>
      )}
      {mode === "parts" && (
        <Card className="space-y-3 border-warning">
          <h3 className="text-lg font-bold">Pause: waiting for parts</h3>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Part required</Label>
              {p.catalogPartId && (
                <span className="text-[11px] font-semibold text-primary">
                  Service Centre Depot Catalog
                </span>
              )}
            </div>
            {catalogParts.length > 0 && (
              <div className="mb-2">
                <select
                  aria-label="Select from Depot Catalog"
                  className={cn(
                    input,
                    "h-10 min-h-[2.5rem] py-1.5 px-3 text-xs leading-normal cursor-pointer font-medium",
                  )}
                  value={p.catalogPartId || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      setP({ ...p, catalogPartId: "", part: "" });
                      return;
                    }
                    const found = catalogParts.find(
                      (cp) => cp.id === val || cp.part_number === val,
                    );
                    if (found) {
                      setP({
                        ...p,
                        catalogPartId: found.id,
                        part: found.name,
                      });
                    }
                  }}
                >
                  <option value="">-- Custom / Unlisted part --</option>
                  {catalogParts.map((cp) => {
                    const inStock = cp.stock_quantity > 0;
                    return (
                      <option key={cp.id} value={cp.id}>
                        {cp.name} ({cp.part_number}) — ₹{cp.unit_price} [
                        {inStock ? `${cp.stock_quantity} in stock` : "Out of stock"}]
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="sm:col-span-3">
                <input
                  className={input}
                  placeholder="Part name"
                  value={p.part}
                  onChange={(e) => {
                    const newName = e.target.value;
                    const matched = catalogParts.find(
                      (cp) => cp.name.trim().toLowerCase() === newName.trim().toLowerCase(),
                    );
                    setP({
                      ...p,
                      part: newName,
                      catalogPartId: matched ? matched.id : "",
                    });
                  }}
                />
              </div>
              <div>
                <input
                  type="number"
                  min={1}
                  className={input}
                  placeholder="Qty"
                  value={p.quantity}
                  onChange={(e) =>
                    setP({ ...p, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                />
              </div>
            </div>
          </div>
          <div>
            <Label>Reason</Label>
            <input
              className={input}
              value={p.reason}
              onChange={(e) => setP({ ...p, reason: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Expected arrival</Label>
              <DateTimePicker value={p.eta} onChange={(val) => setP({ ...p, eta: val })} />
            </div>
            <div className="space-y-1">
              <Label>Revised completion</Label>
              <DateTimePicker
                value={p.revisedCompletion}
                onChange={(val) => setP({ ...p, revisedCompletion: val })}
              />
            </div>
          </div>
          <div>
            <Label>Note for farmer (optional)</Label>
            <input
              className={input}
              value={p.note}
              onChange={(e) => setP({ ...p, note: e.target.value })}
              placeholder="Part is being picked up from Taluka distributor."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={submitting} onClick={() => setMode("none")} className={btn.ghost}>
              Cancel
            </button>
            <button
              disabled={!p.part.trim() || !p.eta.trim() || submitting}
              onClick={handleWaitForParts}
              className={cn(btn.amber, "disabled:opacity-50")}
            >
              {submitting ? "Pausing…" : "Pause repair"}
            </button>
          </div>
        </Card>
      )}
      {mode === "complete" && (
        <Card className="space-y-3 border-success">
          <h3 className="text-lg font-bold">Complete repair & sign off</h3>
          <p className="text-sm text-muted-foreground">
            Final sign-off on completed repair. This marks the equipment as Operational, saves the
            repair to permanent service history, and notifies the farmer and Service Centre.
          </p>
          <div>
            <Label>Final repair notes</Label>
            <textarea
              rows={3}
              className={input}
              maxLength={500}
              value={final}
              onChange={(e) => setFinal(e.target.value)}
              placeholder="Work performed, root cause found…"
            />
          </div>
          <label className={cn(btn.ghost, "w-full cursor-pointer")}>
            <Camera className="h-4 w-4" />
            {photo ? "Completion photo added ✓" : "Upload completion photo (optional)"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setPhoto(await fileToSmallDataUrl(f));
              }}
            />
          </label>
          <label className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-border p-3">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={tested}
              onChange={(e) => setTested(e.target.checked)}
            />{" "}
            Machine tested under load and working
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={submitting} onClick={() => setMode("none")} className={btn.ghost}>
              Cancel
            </button>
            <button
              disabled={!tested || !final.trim() || submitting}
              onClick={handleComplete}
              className={cn(btn.primary, "disabled:opacity-50")}
            >
              {submitting ? "Signing off…" : "Complete & sign off"}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

interface WaitingProps {
  repairId: string;
  r: Repair;
  onUpdate: () => Promise<void>;
  hasPendingQuote?: boolean;
  isQuoteApproved?: boolean;
  partRequests?: ServiceCentrePartRequestDetail[];
}

function Waiting({
  repairId,
  r,
  onUpdate,
  hasPendingQuote = false,
  isQuoteApproved = false,
  partRequests = [],
}: WaitingProps) {
  const tb = useTB();
  const parts = r.parts || {
    part: "Spare part",
    reason: "Waiting for parts",
    eta: "Tomorrow",
    note: "",
    revisedCompletion: "",
    since: Date.now(),
  };
  const [eta, setEta] = useState(parts.eta);
  const [submitting, setSubmitting] = useState(false);

  const handleUpdateEta = async () => {
    if (!eta.trim() || submitting) return;
    setSubmitting(true);
    try {
      await updatePartsEta(repairId, { eta: eta.trim() });
      toast("ETA updated for farmer");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to update parts ETA:", err);
      toast.error(err?.message || "Failed to update ETA");
    } finally {
      setSubmitting(false);
    }
  };

  const isDemo =
    !isUuid(repairId) ||
    tb.repairs.some((x) => x.id === repairId || (x as any).jobNumber === repairId);

  const handleResume = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (isDemo) {
        actions.resume(repairId);
        if (isUuid(repairId)) {
          try {
            await resumeRepair(repairId);
          } catch {
            // Non-fatal remote sync in demo mode
          }
        }
      } else {
        await resumeRepair(repairId);
      }
      toast.success(
        hasPendingQuote ? "Parts hold cleared. Awaiting farmer approval on quote." : "Work resumed",
      );
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to resume repair:", err);
      toast.error(err?.message || "Failed to resume repair");
    } finally {
      setSubmitting(false);
    }
  };

  const partsItems: BlockerPartItem[] = Array.isArray(parts.items) ? parts.items : [];
  const hasPendingItems =
    partsItems.length > 0 ? partsItems.some((it) => it.status === "PENDING") : true;
  const allArrived = Boolean(parts.allPartsArrived) || (partsItems.length > 0 && !hasPendingItems);

  return (
    <Card className="space-y-3 border-warning">
      <p className="flex items-center gap-2 text-lg font-bold">
        <PackageSearch className="h-5 w-5" /> Paused for {parts.part}
      </p>

      {partsItems.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
          <Label className="text-xs font-bold text-foreground">
            Required Blocking Components ({partsItems.length})
          </Label>
          <div className="space-y-1.5">
            {partsItems.map((item, idx) => {
              const isDone = item.status === "HANDED_OFF" || item.status === "RESOLVED";
              const matchingReq = (partRequests || []).find(
                (pr) =>
                  pr.id === item.id ||
                  pr.part_id === item.partId ||
                  pr.part?.name?.trim().toLowerCase() === item.part.trim().toLowerCase(),
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
                      {item.part} {item.quantity ? `(Qty: ${item.quantity})` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{item.reason}</p>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {isDepotReq
                        ? "Service Centre Depot Requisition"
                        : "Field / External Sourcing Hold"}
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
                        ? "Handed Off / Ready"
                        : isDepotReq
                          ? isOutOfStock
                            ? "Out of Depot Stock — Awaiting Arrival"
                            : isInsufficient
                              ? "Insufficient Stock — Awaiting Arrival"
                              : "Awaiting Handoff"
                          : "Sourcing Hold — Awaiting Arrival"}
                    </span>
                    {item.eta && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        ETA: {formatEta(item.eta)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {parts.reason} · paused {ago(parts.since)} ago
        </p>
      )}

      {allArrived && (
        <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-xs font-semibold text-success flex items-center gap-2">
          <span>✓ All requested parts have been handed off from Nagpur Service Centre.</span>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Expected arrival</Label>
        <div className="flex gap-2">
          <DateTimePicker value={eta} onChange={(val) => setEta(val)} />
          <button
            disabled={!eta.trim() || submitting}
            onClick={handleUpdateEta}
            className={cn(btn.ghost, "h-11 shrink-0 whitespace-nowrap disabled:opacity-50")}
          >
            {submitting ? "Updating…" : "Update ETA"}
          </button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Current: <b className="text-foreground">{formatEta(parts.eta)}</b>
          </span>
        </div>
      </div>
      <button
        disabled={submitting}
        onClick={handleResume}
        className={cn(btn.primary, "h-14 w-full text-lg disabled:opacity-50")}
      >
        {submitting
          ? "Resuming…"
          : hasPendingQuote
            ? "Parts received — Awaiting farmer approval"
            : "Parts received — Resume repair"}
      </button>
    </Card>
  );
}
