import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertOctagon,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  PackageSearch,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable } from "@/components/repair-parts";
import {
  btn,
  CallButton,
  Card,
  ClickableImage,
  input,
  Label,
  StatusPill,
} from "@/components/tb";
import { ago, useTB, type Quote, type Repair } from "@/lib/tb-store";
import type { Assessment } from "@/lib/assessment";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelRepairRequest,
  getRepairRequestById,
  updatePartsEta,
  type RepairRequestDetail,
} from "@/lib/services/repair-requests";
import {
  assignTechnician,
  getEligibleTechnicians,
  type ScoredTechnicianMatch,
} from "@/lib/services/technicians";
import { getQuotesForRepair, type QuoteDetail } from "@/lib/services/quotes";

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
      return "Repair completed & ready for handover";
    case "CANCELLED":
      return "Repair cancelled";
    case "REASSIGNED":
      return "Technician reassigned";
    case "NOTE":
      return "Technician note recorded";
    default:
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

  const [dbRepair, setDbRepair] = useState<RepairRequestDetail | null>(null);
  const [quotes, setQuotes] = useState<QuoteDetail[]>([]);
  const [techMatches, setTechMatches] = useState<ScoredTechnicianMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState("");
  const [updatingEta, setUpdatingEta] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [showAllActivity, setShowAllActivity] = useState(false);

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

        // Concurrently fetch quotes and eligible technicians
        const [quotesData, eligibleData] = await Promise.all([
          getQuotesForRepair(realRepair.id).catch(() => []),
          getEligibleTechnicians(realRepair.id).catch(() => []),
        ]);

        setQuotes(quotesData);
        setTechMatches(eligibleData);
        return;
      }

      // 2. Fallback to mock store if legacy demo ticket
      const mockRepair = s.repairs.find((x) => x.id === id || (x as any).jobNumber === id);
      if (mockRepair) {
        setEta(mockRepair.parts?.eta ?? "");
        return;
      }

      setError("Repair request not found");
    } catch (err: any) {
      console.error("[TerraByte] Failed to load repair details:", err);
      setError(err?.message || "Failed to load repair details");
    } finally {
      setLoading(false);
    }
  }, [id, s.repairs]);

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
        <Link to="/admin" className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Pipeline
        </Link>
        <div className="py-12 text-center text-muted-foreground">Loading repair details…</div>
      </div>
    );
  }

  // Handle fallback mock repair if Supabase returned null but mock store has it
  const mockR = !dbRepair ? s.repairs.find((x) => x.id === id || (x as any).jobNumber === id) : null;

  if (!dbRepair && !mockR) {
    return (
      <div className="space-y-5">
        <Link to="/admin" className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Pipeline
        </Link>
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

  return (
    <div className="space-y-5">
      <Link
        to="/admin"
        className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Pipeline
      </Link>

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

      {od && (
        <p className="flex items-center gap-2 rounded-xl border-2 border-destructive bg-destructive/5 p-3 font-semibold text-destructive">
          <AlertOctagon className="h-5 w-5 shrink-0" /> Exception: in "{status.toLowerCase().replace(/_/g, " ")}" for{" "}
          {ago(new Date(statusSince).getTime())} — intervene.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          {/* Dispatch / Reassignment */}
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

          {/* Cancellation */}
          {status !== "COMPLETED" && status !== "CANCELLED" && (
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
    </div>
  );
}
