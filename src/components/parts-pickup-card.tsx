import {
  AlertTriangle,
  CheckCircle2,
  Package,
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, Label } from "@/components/tb";
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
  type ServiceCentrePart,
  type ServiceCentrePartRequestDetail,
} from "@/lib/services/parts-desk";
import { fmtTime, inr } from "@/lib/tb-store";
import { cn } from "@/lib/utils";

interface PartsPickupCardProps {
  repairId: string;
  repairStatus: string;
  isAssigned: boolean;
  onOpenHoldWithPart?: (partName: string) => void;
  onUpdate?: () => Promise<void>;
}

export function PartsPickupCard({
  repairId,
  repairStatus,
  isAssigned,
  onOpenHoldWithPart,
  onUpdate,
}: PartsPickupCardProps) {
  const [requests, setRequests] = useState<ServiceCentrePartRequestDetail[]>([]);
  const [catalog, setCatalog] = useState<ServiceCentrePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Request form state
  const [selectedPart, setSelectedPart] = useState<ServiceCentrePart | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!repairId) return;
    try {
      setLoading(true);
      const [reqsData, partsData] = await Promise.all([
        getRepairPartRequests(repairId).catch(() => []),
        getServiceCentreParts().catch(() => []),
      ]);
      setRequests(reqsData);
      setCatalog(partsData);
    } catch (err: unknown) {
      console.error("[TerraByte] Failed to load parts pickup requests:", err);
    } finally {
      setLoading(false);
    }
  }, [repairId]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

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
      });
      toast.success(
        `Pickup requested: ${quantity}x ${selectedPart.name}. Service Centre notified.`,
      );
      setModalOpen(false);
      setSelectedPart(null);
      setQuantity(1);
      setNotes("");
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

  const canRequest =
    isAssigned &&
    ["IN_PROGRESS", "WAITING_FOR_PARTS", "ACCEPTED", "QUOTE_REVISED"].includes(
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
                {req.notes && (
                  <p className="text-[11px] italic text-muted-foreground">
                    "{req.notes}"
                  </p>
                )}
              </div>

              {req.status === "PENDING" && isAssigned && (
                <button
                  type="button"
                  disabled={cancellingId === req.id}
                  onClick={() => handleCancelRequest(req.id)}
                  className="self-end rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground sm:self-center"
                >
                  {cancellingId === req.id ? "Cancelling..." : "Cancel"}
                </button>
              )}
            </div>
          ))}
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
            {selectedPart && selectedPart.stock_quantity > 0 && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-foreground">
                    Selected: <b>{selectedPart.name}</b>
                  </span>
                  <span className="font-mono text-muted-foreground">
                    Max: {selectedPart.stock_quantity}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Quantity</Label>
                    <input
                      type="number"
                      min="1"
                      max={selectedPart.stock_quantity}
                      value={quantity}
                      onChange={(e) =>
                        setQuantity(
                          Math.min(
                            selectedPart.stock_quantity,
                            Math.max(1, parseInt(e.target.value) || 1),
                          ),
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
                  <Label className="text-[11px]">Pickup Notes (Optional)</Label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Picking up with van this afternoon"
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
                selectedPart.stock_quantity === 0 ||
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
    </Card>
  );
}
