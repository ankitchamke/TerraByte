import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Package,
  PackageSearch,
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, DateTimePicker, Label } from "@/components/tb";
import { formatEtaDateTime } from "@/lib/date-utils";
import { useRepairTicketRealtime, isUuid } from "@/hooks/use-repair-realtime";
import { supabase } from "@/integrations/supabase/client";
import { updatePartsEta } from "@/lib/services/repair-requests";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cancelPartRequest,
  getRepairPartRequests,
  getServiceCentreParts,
  requestServiceCentrePart,
  updatePartRequestEta,
  type ServiceCentrePart,
  type ServiceCentrePartRequestDetail,
} from "@/lib/services/parts-desk";
import { actions, fmtTime, inr, useTB } from "@/lib/tb-store";
import { cn } from "@/lib/utils";

export interface SourcingHoldItem {
  id: string;
  part: string;
  partId?: string | null;
  quantity?: number;
  reason?: string;
  eta?: string | null;
  status?: string;
  since?: string | number;
}

interface PartsPickupCardProps {
  repairId: string;
  repairStatus: string;
  isAssigned: boolean;
  partRequests?: ServiceCentrePartRequestDetail[];
  sourcingHolds?: SourcingHoldItem[];
  onOpenHoldWithPart?: (partName: string) => void;
  onUpdate?: () => Promise<void>;
}

export function PartsPickupCard({
  repairId,
  repairStatus,
  isAssigned,
  partRequests: propPartRequests,
  sourcingHolds: propSourcingHolds,
  onOpenHoldWithPart,
  onUpdate,
}: PartsPickupCardProps) {
  const tb = useTB();
  const [internalRequests, setInternalRequests] = useState<ServiceCentrePartRequestDetail[]>([]);
  const [internalSourcingHolds, setInternalSourcingHolds] = useState<SourcingHoldItem[]>([]);
  const [catalog, setCatalog] = useState<ServiceCentrePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");

  const requests = propPartRequests !== undefined ? propPartRequests : internalRequests;
  const sourcingHolds = propSourcingHolds !== undefined ? propSourcingHolds : internalSourcingHolds;

  // Request form state
  const [selectedPart, setSelectedPart] = useState<ServiceCentrePart | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [eta, setEta] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Update ETA state (Depot requisitions)
  const [updateEtaTarget, setUpdateEtaTarget] = useState<ServiceCentrePartRequestDetail | null>(null);
  const [editEta, setEditEta] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEta, setSavingEta] = useState(false);

  // Update ETA state (Sourcing holds)
  const [updateSourcingEtaTarget, setUpdateSourcingEtaTarget] = useState<SourcingHoldItem | null>(null);
  const [editSourcingEta, setEditSourcingEta] = useState("");
  const [editSourcingNotes, setEditSourcingNotes] = useState("");
  const [savingSourcingEta, setSavingSourcingEta] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!repairId) return;
    try {
      setLoading(true);
      const [reqsData, partsData] = await Promise.all([
        getRepairPartRequests(repairId).catch(() => []),
        getServiceCentreParts().catch(() => []),
      ]);
      setInternalRequests(reqsData);
      setCatalog(partsData);

      // Discover sourcing holds on this repair if not supplied by parent
      if (propSourcingHolds === undefined) {
        if (isUuid(repairId)) {
          const { data: rep } = await supabase
            .from("repair_requests")
            .select("parts_hold")
            .eq("id", repairId)
            .maybeSingle();
          if (rep?.parts_hold) {
            const ph = rep.parts_hold as Record<string, any>;
            const rawItems: any[] = Array.isArray(ph["items"])
              ? ph["items"]
              : ph["part"]
                ? [{ id: ph["part"], part: ph["part"], reason: ph["reason"], eta: ph["eta"], status: "PENDING" }]
                : [];
            const holds: SourcingHoldItem[] = rawItems
              .filter((it: any) => {
                const isDepot = reqsData.some(
                  (r) =>
                    r.id === it.id ||
                    r.id.toLowerCase() === (it.id || "").toLowerCase() ||
                    (it.partId && r.part_id === it.partId) ||
                    r.part?.name?.toLowerCase() === (it.part || "").toLowerCase(),
                );
                return !isDepot && (it.status === "PENDING" || !it.status);
              })
              .map((it: any) => ({
                id: it.id || it.part || "sourcing-hold",
                part: it.part || "Spare part",
                partId: it.partId ?? null,
                quantity: it.quantity ?? 1,
                reason: it.reason ?? undefined,
                eta: it.eta ?? null,
                status: it.status ?? "PENDING",
                since: it.since ?? undefined,
              }));
            setInternalSourcingHolds(holds);
          }
        } else {
          const rep = tb.repairs.find((x) => x.id === repairId || (x as any).jobNumber === repairId);
          if (rep?.parts?.items) {
            const rawDemoItems: any[] = rep.parts.items;
            const holds: SourcingHoldItem[] = rawDemoItems
              .filter((it: any) => {
                const isDepot = reqsData.some(
                  (r) =>
                    r.id === it.id ||
                    r.id.toLowerCase() === (it.id || "").toLowerCase() ||
                    (it.partId && r.part_id === it.partId) ||
                    r.part?.name?.toLowerCase() === (it.part || "").toLowerCase(),
                );
                return !isDepot && (it.status === "PENDING" || !it.status);
              })
              .map((it: any) => ({
                id: it.id || it.part || "sourcing-hold",
                part: it.part || "Spare part",
                partId: it.partId ?? null,
                quantity: it.quantity ?? 1,
                reason: it.reason ?? undefined,
                eta: it.eta ?? null,
                status: it.status ?? "PENDING",
                since: it.since ?? undefined,
              }));
            setInternalSourcingHolds(holds);
          }
        }
      }
    } catch (err: unknown) {
      console.error("[TerraByte] Failed to load parts pickup requests:", err);
    } finally {
      setLoading(false);
    }
  }, [repairId, propSourcingHolds, tb.repairs]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests, tb.serviceCentrePartRequests, tb.serviceCentreParts, tb.repairs]);

  // Scoped Realtime updates
  useRepairTicketRealtime({
    repairId,
    onUpdate: async () => {
      await loadRequests();
      if (onUpdate) {
        try {
          await onUpdate();
        } catch {
          // Non-fatal
        }
      }
    },
  });

  const filteredCatalog = useMemo(() => {
    if (!search.trim()) return catalog;
    const q = search.toLowerCase();
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.part_number.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.compatible_models.some((m) => m.toLowerCase().includes(q)),
    );
  }, [catalog, search]);

  const handleRequestPart = async () => {
    if (!selectedPart) return;
    if (quantity <= 0) {
      toast.error("Please enter a valid quantity.");
      return;
    }
    setSubmitting(true);
    try {
      await requestServiceCentrePart({
        repairRequestId: repairId,
        partId: selectedPart.id,
        quantity,
        notes: notes.trim() || undefined,
        eta: eta.trim() || undefined,
      });
      toast.success(
        `Pickup requested: ${quantity}x ${selectedPart.name}. Service Centre notified.`,
      );
      setModalOpen(false);
      setSelectedPart(null);
      setQuantity(1);
      setNotes("");
      setEta("");
      await loadRequests();
      if (onUpdate) await onUpdate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit part request.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    setCancellingId(requestId);
    try {
      await cancelPartRequest(requestId);
      toast.success("Part request cancelled.");
      await loadRequests();
      if (onUpdate) await onUpdate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to cancel request.";
      toast.error(msg);
    } finally {
      setCancellingId(null);
    }
  };

  const handleOpenUpdateEta = (req: ServiceCentrePartRequestDetail) => {
    setUpdateEtaTarget(req);
    setEditEta(req.estimated_arrival_at || "");
    setEditNotes(req.notes || "");
  };

  const handleSaveEta = async () => {
    if (!updateEtaTarget) return;
    setSavingEta(true);
    try {
      await updatePartRequestEta(updateEtaTarget.id, {
        estimatedArrivalAt: editEta.trim() || null,
        notes: editNotes.trim() || undefined,
      });
      toast.success(`Arrival ETA updated for ${updateEtaTarget.part?.name || "spare part"}.`);
      setUpdateEtaTarget(null);
      await loadRequests();
      if (onUpdate) await onUpdate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update ETA.";
      toast.error(msg);
    } finally {
      setSavingEta(false);
    }
  };

  const handleOpenSourcingEta = (sh: SourcingHoldItem) => {
    setUpdateSourcingEtaTarget(sh);
    setEditSourcingEta(sh.eta || "");
    setEditSourcingNotes(sh.reason || "");
  };

  const handleSaveSourcingEta = async () => {
    if (!updateSourcingEtaTarget || !repairId) return;
    setSavingSourcingEta(true);
    try {
      const isDemo =
        !isUuid(repairId) ||
        tb.repairs.some((x) => x.id === repairId || (x as any).jobNumber === repairId);

      if (isDemo) {
        actions.updatePartsEta(
          repairId,
          editSourcingEta.trim() || "ETA pending",
          "technician",
          updateSourcingEtaTarget.id,
        );
      }
      try {
        const noteVal = editSourcingNotes.trim();
        await updatePartsEta(repairId, {
          eta: editSourcingEta.trim() || "ETA pending",
          requestId: updateSourcingEtaTarget.id,
          itemId: updateSourcingEtaTarget.id,
          partName: updateSourcingEtaTarget.part,
          ...(noteVal ? { note: noteVal } : {}),
        });
      } catch (remoteErr) {
        if (!isDemo) throw remoteErr;
      }

      toast.success(`Sourcing ETA updated for ${updateSourcingEtaTarget.part}.`);
      setUpdateSourcingEtaTarget(null);
      await loadRequests();
      if (onUpdate) await onUpdate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update sourcing ETA.";
      toast.error(msg);
    } finally {
      setSavingSourcingEta(false);
    }
  };

  const canRequest =
    isAssigned &&
    ["IN_PROGRESS", "WAITING_FOR_PARTS", "ACCEPTED", "QUOTE_REVISED", "QUOTE_PENDING"].includes(
      repairStatus,
    );

  const hasHandedOffParts = requests.some((r) => r.status === "HANDED_OFF");

  return (
    <Card className="border-border/80">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Service Centre Parts Pickup</h2>
        </div>
        {canRequest && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setSelectedPart(null);
              setQuantity(1);
              setNotes("");
              setModalOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary/20"
          >
            <Plus className="h-3.5 w-3.5" /> Request Part
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Request components available at the Nagpur Service Centre depot. Service Centre staff will prepare and confirm physical handoff.
      </p>

      {/* Success banner if parts were handed off */}
      {hasHandedOffParts && (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 p-3 text-xs text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Parts Handed Off from Service Centre</p>
            <p className="text-success/90">
              One or more requested components have been confirmed handed off. Ready for installation on this machine.
            </p>
          </div>
        </div>
      )}

      {/* Field & External Sourcing Holds */}
      {sourcingHolds && sourcingHolds.length > 0 && (
        <div className="space-y-2.5 pt-4 border-t border-border/80">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <PackageSearch className="h-4 w-4 text-primary" />
            <span>Field &amp; External Sourcing Holds ({sourcingHolds.length})</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Components awaiting field delivery or external supplier sourcing. Not stocked in Nagpur depot inventory.
          </p>

          <div className="space-y-2">
            {sourcingHolds.map((sh, idx) => (
              <div
                key={`${sh.id || sh.part}-${idx}`}
                className="flex flex-col gap-2 rounded-xl border border-dashed border-border/80 bg-muted/30 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {sh.part} {sh.quantity ? `(Qty: ${sh.quantity})` : ""}
                    </span>
                    <span className="rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                      Sourcing Hold — Awaiting Arrival
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {sh.reason || "Waiting for delivery or sourcing"}
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                    <Clock className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-muted-foreground">Expected Arrival:</span>
                    <span className={cn("font-medium", sh.eta ? "text-primary font-semibold" : "text-muted-foreground italic")}>
                      {sh.eta ? formatEtaDateTime(sh.eta) : "ETA pending"}
                    </span>
                  </div>
                </div>

                {isAssigned && (
                  <div className="flex items-center gap-1.5 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleOpenSourcingEta(sh)}
                      className="rounded border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15"
                    >
                      Update ETA
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Existing Requests List */}
      {loading ? (
        <p className="py-2 text-xs text-muted-foreground">Checking parts requests…</p>
      ) : requests.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground italic">
          No parts requested from Service Centre for this repair.
        </p>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => (
            <div
              key={req.id}
              className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
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
                      ? "Awaiting Pickup Handoff"
                      : req.status === "HANDED_OFF"
                        ? "Handed Off"
                        : "Cancelled"}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  SKU: {req.part?.part_number || "—"} · Spec: {req.part?.spec || "Standard"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Requested {fmtTime(new Date(req.created_at).getTime())}
                  {req.handed_off_at && (
                    <> · Handed off {fmtTime(new Date(req.handed_off_at).getTime())}</>
                  )}
                </p>
                {req.part && req.part.stock_quantity === 0 && (
                  <span className="inline-block rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                    Out of Depot Stock
                  </span>
                )}
                {req.part && req.part.stock_quantity > 0 && req.part.stock_quantity < req.quantity && (
                  <span className="inline-block rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold text-warning-foreground">
                    Insufficient Stock ({req.part.stock_quantity} on hand, {req.quantity} needed)
                  </span>
                )}
                <div className="flex items-center gap-1.5 text-[11px]">
                  <Clock className="h-3 w-3 text-primary shrink-0" />
                  <span className="text-muted-foreground">Expected Arrival:</span>
                  <span className={cn("font-medium", req.estimated_arrival_at ? "text-primary font-semibold" : "text-muted-foreground italic")}>
                    {req.estimated_arrival_at ? formatEtaDateTime(req.estimated_arrival_at) : "ETA pending"}
                  </span>
                </div>
                {req.eta_updated_at && (
                  <p className="text-[10px] text-muted-foreground">
                    ETA set {req.eta_updater?.full_name ? `by ${req.eta_updater.full_name}` : ""} on {new Date(req.eta_updated_at).toLocaleDateString()}
                  </p>
                )}
                {req.notes && (
                  <p className="text-[11px] italic text-muted-foreground">
                    "{req.notes}"
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-center">
                {req.status === "PENDING" && isAssigned && (
                  <button
                    type="button"
                    onClick={() => handleOpenUpdateEta(req)}
                    className="rounded border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15"
                  >
                    Update ETA
                  </button>
                )}
                {req.status === "PENDING" && isAssigned && (
                  <button
                    type="button"
                    disabled={cancellingId === req.id}
                    onClick={() => handleCancelRequest(req.id)}
                    className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {cancellingId === req.id ? "Cancelling..." : "Cancel"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Field & External Sourcing Holds */}
      {sourcingHolds && sourcingHolds.length > 0 && (
        <div className="space-y-2.5 pt-4 border-t border-border/80">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <PackageSearch className="h-4 w-4 text-primary" />
            <span>Field &amp; External Sourcing Holds ({sourcingHolds.length})</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Components awaiting field delivery or external supplier sourcing. Not stocked in Nagpur depot inventory.
          </p>

          <div className="space-y-2">
            {sourcingHolds.map((sh, idx) => (
              <div
                key={`${sh.id || sh.part}-${idx}`}
                className="flex flex-col gap-2 rounded-xl border border-dashed border-border/80 bg-muted/30 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {sh.part} {sh.quantity ? `(Qty: ${sh.quantity})` : ""}
                    </span>
                    <span className="rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                      Sourcing Hold — Awaiting Arrival
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {sh.reason || "Waiting for delivery or sourcing"}
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                    <Clock className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-muted-foreground">Expected Arrival:</span>
                    <span className={cn("font-medium", sh.eta ? "text-primary font-semibold" : "text-muted-foreground italic")}>
                      {sh.eta ? formatEtaDateTime(sh.eta) : "ETA pending"}
                    </span>
                  </div>
                </div>

                {isAssigned && (
                  <div className="flex items-center gap-1.5 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleOpenSourcingEta(sh)}
                      className="rounded border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15"
                    >
                      Update ETA
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* REQUEST PART MODAL */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Service Centre Part</DialogTitle>
            <DialogDescription>
              Select a part from the Nagpur Service Centre depot. If unavailable, you can pause the repair and specify an arrival ETA.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search catalog by name, SKU, or model..."
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Catalog List */}
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {filteredCatalog.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No parts found matching "{search}".
                </p>
              ) : (
                filteredCatalog.map((part) => {
                  const isSelected = selectedPart?.id === part.id;
                  const inStock = part.stock_quantity > 0;

                  return (
                    <div
                      key={part.id}
                      onClick={() => setSelectedPart(part)}
                      className={cn(
                        "cursor-pointer rounded-xl border p-2.5 text-xs transition-all",
                        isSelected
                          ? "border-primary bg-primary/5 shadow-xs"
                          : "border-border hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-foreground">{part.name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {part.part_number} · {part.spec || "OEM"}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {part.compatible_models.map((m) => (
                              <span
                                key={m}
                                className="rounded bg-muted px-1.5 py-0.2 text-[10px]"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-[10px] font-bold",
                              inStock
                                ? "bg-success/15 text-success"
                                : "bg-warning/15 text-warning-foreground",
                            )}
                          >
                            {inStock ? `${part.stock_quantity} in stock` : "Out of stock"}
                          </span>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {inr(Number(part.unit_price))}
                          </p>
                        </div>
                      </div>

                      {/* Out-of-stock guidance */}
                      {!inStock && (
                        <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-warning-foreground">
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" /> Unavailable at depot
                          </span>
                          {onOpenHoldWithPart && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setModalOpen(false);
                                onOpenHoldWithPart(part.name);
                              }}
                              className="font-bold text-primary underline hover:text-primary/80"
                            >
                              Pause Repair & Set ETA →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Selected Part Form */}
            {selectedPart && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-foreground">
                    Selected: <b>{selectedPart.name}</b>
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {selectedPart.stock_quantity > 0
                      ? `Max: ${selectedPart.stock_quantity}`
                      : "Depot Sourcing"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Quantity</Label>
                    <input
                      type="number"
                      min="1"
                      max={selectedPart.stock_quantity > 0 ? selectedPart.stock_quantity : 99}
                      value={quantity}
                      onChange={(e) =>
                        setQuantity(
                          selectedPart.stock_quantity > 0
                            ? Math.min(
                                selectedPart.stock_quantity,
                                Math.max(1, parseInt(e.target.value) || 1),
                              )
                            : Math.max(1, parseInt(e.target.value) || 1),
                        )
                      }
                      className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Estimated Cost</Label>
                    <p className="mt-1.5 font-mono text-xs font-bold">
                      {inr(Number(selectedPart.unit_price) * quantity)}
                    </p>
                  </div>
                </div>

                <div>
                  <Label className="text-[11px]">Expected Arrival Time (Optional)</Label>
                  <DateTimePicker value={eta} onChange={setEta} />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    If arrival time is not yet known, leave empty to display "ETA pending".
                  </p>
                </div>

                <div>
                  <Label className="text-[11px]">Pickup Notes (Optional)</Label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Sourcing from regional depot / pickup with van"
                    className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                submitting ||
                !selectedPart ||
                quantity <= 0
              }
              onClick={handleRequestPart}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Pickup Request"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* UPDATE ETA MODAL (DEPOT) */}
      <Dialog open={Boolean(updateEtaTarget)} onOpenChange={(open) => !open && setUpdateEtaTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Coordinate Expected Arrival (ETA)</DialogTitle>
            <DialogDescription>
              Update expected delivery date &amp; time for {updateEtaTarget?.part?.name || "spare part"}. Updates repair hold timeline and farmer view in real time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <Label className="text-[11px]">Expected Arrival Date &amp; Time</Label>
              <DateTimePicker value={editEta} onChange={setEditEta} />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Select when the Service Centre depot expects this component to arrive.
              </p>
            </div>

            <div>
              <Label className="text-[11px]">Coordination Notes (Optional)</Label>
              <input
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="e.g. In transit from regional depot / courier delivery"
                className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              disabled={savingEta}
              onClick={() => setUpdateEtaTarget(null)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingEta}
              onClick={handleSaveEta}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {savingEta ? "Saving..." : "Save ETA"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* UPDATE ETA MODAL (SOURCING HOLD) */}
      <Dialog open={Boolean(updateSourcingEtaTarget)} onOpenChange={(open) => !open && setUpdateSourcingEtaTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Coordinate Sourcing Hold Arrival (ETA)</DialogTitle>
            <DialogDescription>
              Update expected delivery date &amp; time for {updateSourcingEtaTarget?.part || "component"}. Updates repair hold timeline and farmer view in real time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <Label className="text-[11px]">Expected Arrival Date &amp; Time</Label>
              <DateTimePicker value={editSourcingEta} onChange={setEditSourcingEta} />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Select when this field / externally-sourced component is expected to arrive.
              </p>
            </div>

            <div>
              <Label className="text-[11px]">Sourcing Notes (Optional)</Label>
              <input
                type="text"
                value={editSourcingNotes}
                onChange={(e) => setEditSourcingNotes(e.target.value)}
                placeholder="e.g. Sourced from external vendor, in transit..."
                className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              disabled={savingSourcingEta}
              onClick={() => setUpdateSourcingEtaTarget(null)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingSourcingEta}
              onClick={handleSaveSourcingEta}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {savingSourcingEta ? "Saving..." : "Save ETA"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
