import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  DollarSign,
  History,
  MapPin,
  Package,
  PackageSearch,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, ContextualBack, DateTimePicker, Label } from "@/components/tb";
import { formatEtaDateTime } from "@/lib/date-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePartsDeskRealtime, isUuid } from "@/hooks/use-repair-realtime";
import { meta } from "@/lib/seo";
import {
  adjustPartStock,
  confirmPartHandoff,
  getAllPartRequests,
  getPartSales,
  getServiceCentreParts,
  getStockAuditLog,
  receiveStock,
  returnPart,
  updatePartRequestEta,
  type PartSaleDetail,
  type ServiceCentrePart,
  type ServiceCentrePartRequestDetail,
  type StockAuditLogDetail,
} from "@/lib/services/parts-desk";
import { supabase } from "@/integrations/supabase/client";
import { updatePartsEta } from "@/lib/services/repair-requests";
import { actions, fmtTime, inr, useTB } from "@/lib/tb-store";
import { cn } from "@/lib/utils";

export interface SourcingHoldDetail {
  id: string;
  repairId: string;
  jobNumber: string;
  part: string;
  partId?: string | null;
  quantity: number;
  reason: string;
  eta: string;
  status: string;
  since: string | number;
  technicianName?: string;
  location?: string;
}

export const Route = createFileRoute("/admin/parts-desk")({
  head: () =>
    meta(
      "Parts Desk",
      "Manage spare-parts inventory, review technician requests, and track repair sales.",
    ),
  component: PartsDesk,
});

type Tab = "requests" | "inventory" | "movements" | "sales";

function PartsDesk() {
  const tb = useTB();
  const [tab, setTab] = useState<Tab>("requests");
  const [parts, setParts] = useState<ServiceCentrePart[]>([]);
  const [requests, setRequests] = useState<ServiceCentrePartRequestDetail[]>([]);
  const [auditLog, setAuditLog] = useState<StockAuditLogDetail[]>([]);
  const [sales, setSales] = useState<PartSaleDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Filters for Movements & Sales
  const [movementFilter, setMovementFilter] = useState<string>("ALL");
  const [salesPartFilter, setSalesPartFilter] = useState<string>("ALL");
  const [salesDateFilter, setSalesDateFilter] = useState<"all" | "7d" | "30d">("all");

  // Handoff confirmation modal state
  const [handoffTarget, setHandoffTarget] = useState<ServiceCentrePartRequestDetail | null>(null);
  const [confirmingHandoff, setConfirmingHandoff] = useState(false);

  // Stock adjustment modal state
  const [adjustTarget, setAdjustTarget] = useState<ServiceCentrePart | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(1);
  const [adjustType, setAdjustType] = useState<"add" | "remove">("add");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  // Receive stock delivery modal state
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [receivePartId, setReceivePartId] = useState("");
  const [receiveQty, setReceiveQty] = useState(1);
  const [receiveReason, setReceiveReason] = useState("");
  const [receiving, setReceiving] = useState(false);

  // Return unused part modal state
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnRepairId, setReturnRepairId] = useState("");
  const [returnPartId, setReturnPartId] = useState("");
  const [returnQty, setReturnQty] = useState(1);
  const [returnReason, setReturnReason] = useState("");
  const [returning, setReturning] = useState(false);

  // Update ETA modal state
  const [etaTarget, setEtaTarget] = useState<ServiceCentrePartRequestDetail | null>(null);
  const [sourcingHoldTarget, setSourcingHoldTarget] = useState<SourcingHoldDetail | null>(null);
  const [sourcingHolds, setSourcingHolds] = useState<SourcingHoldDetail[]>([]);
  const [newEta, setNewEta] = useState("");
  const [etaNotes, setEtaNotes] = useState("");
  const [updatingEta, setUpdatingEta] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [partsData, requestsData, auditData, salesData] = await Promise.all([
        getServiceCentreParts().catch(() => []),
        getAllPartRequests().catch(() => []),
        getStockAuditLog().catch(() => []),
        getPartSales().catch(() => []),
      ]);
      setParts(partsData);
      setRequests(requestsData);
      setAuditLog(auditData);
      setSales(salesData);

      // Extract active sourcing holds across repairs in WAITING_FOR_PARTS
      const discoveredHolds: SourcingHoldDetail[] = [];
      try {
        const { data: waitingRepairs } = await supabase
          .from("repair_requests")
          .select("id, job_number, parts_hold, location, technician:technician_id(full_name)")
          .not("parts_hold", "is", null)
          .in("status", ["WAITING_FOR_PARTS", "IN_PROGRESS", "QUOTE_PENDING", "ACCEPTED"]);

        if (waitingRepairs) {
          for (const rep of waitingRepairs) {
            const ph = (rep.parts_hold as Record<string, any>) || {};
            const rawItems: any[] = Array.isArray(ph["items"])
              ? (ph["items"] as any[])
              : ph["part"]
                ? [{ id: ph["part"], part: ph["part"], reason: ph["reason"], eta: ph["eta"], status: "PENDING" }]
                : [];
            for (const it of rawItems) {
              if (it.status === "PENDING" || !it.status) {
                const isDepotReq = requestsData.some(
                  (req) =>
                    req.id === it.id ||
                    req.id.toLowerCase() === (it.id || "").toLowerCase() ||
                    (it.partId && req.part_id === it.partId),
                );
                if (!isDepotReq) {
                  discoveredHolds.push({
                    id: it.id || it.part,
                    repairId: rep.id,
                    jobNumber: rep.job_number || rep.id,
                    part: it.part || "Spare part",
                    partId: it.partId || null,
                    quantity: it.quantity || 1,
                    reason: it.reason || ph["reason"] || "Waiting for parts delivery",
                    eta: it.eta || ph["eta"] || "ETA pending",
                    status: "PENDING",
                    since: it.since || ph["since"] || Date.now(),
                    technicianName: (rep.technician as any)?.full_name || "Assigned Technician",
                    location: rep.location || "Field location",
                  });
                }
              }
            }
          }
        }
      } catch {
        // Non-fatal remote query error
      }

      // Also inspect local/demo store repairs
      try {
        const demoWaiting = tb.repairs.filter(
          (r) =>
            r.parts &&
            ["WAITING_FOR_PARTS", "IN_PROGRESS", "QUOTE_PENDING", "ACCEPTED"].includes(r.status),
        );
        for (const rep of demoWaiting) {
          const repParts = rep.parts as any;
          const rawItems: any[] = Array.isArray(repParts?.items)
            ? repParts.items
            : repParts?.part
              ? [{ id: repParts.part, part: repParts.part, reason: repParts.reason, eta: repParts.eta, status: "PENDING" }]
              : [];
          for (const it of rawItems) {
            if (it.status === "PENDING" || !it.status) {
              const isDepotReq = requestsData.some(
                (req) =>
                  req.id === it.id ||
                  req.id.toLowerCase() === (it.id || "").toLowerCase() ||
                  (it.partId && req.part_id === it.partId),
              );
              const alreadyFound = discoveredHolds.some(
                (sh) =>
                  sh.repairId === rep.id &&
                  (sh.id === it.id || sh.part.toLowerCase() === (it.part || "").toLowerCase()),
              );
              if (!isDepotReq && !alreadyFound) {
                discoveredHolds.push({
                  id: it.id || it.part,
                  repairId: rep.id,
                  jobNumber: (rep as any).jobNumber || rep.id,
                  part: it.part || "Spare part",
                  partId: it.partId || null,
                  quantity: it.quantity || 1,
                  reason: it.reason || repParts?.reason || "Waiting for parts delivery",
                  eta: it.eta || repParts?.eta || "ETA pending",
                  status: "PENDING",
                  since: it.since || repParts?.since || Date.now(),
                  technicianName: "Ramesh Kumar",
                  location: rep.location || "Katol, Nagpur",
                });
              }
            }
          }
        }
      } catch {
        // Non-fatal
      }
      setSourcingHolds(discoveredHolds);

      if (partsData.length > 0 && partsData[0] && !receivePartId) {
        setReceivePartId(partsData[0].id);
        setReturnPartId(partsData[0].id);
      }
    } catch (err: unknown) {
      console.error("[TerraByte] Failed to load Parts Desk data:", err);
      const msg = err instanceof Error ? err.message : "Failed to load Parts Desk records.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [receivePartId, tb.repairs]);

  useEffect(() => {
    loadData();
  }, [
    loadData,
    tb.serviceCentreParts,
    tb.serviceCentrePartRequests,
    tb.serviceCentreStockAudit,
    tb.serviceCentrePartSales,
    tb.repairs,
  ]);

  // Keep Parts Desk records synchronized via Supabase Realtime across all active tabs/devices
  usePartsDeskRealtime({
    onUpdate: loadData,
  });

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === "PENDING"),
    [requests],
  );

  const totalOnHand = useMemo(
    () => parts.reduce((sum, p) => sum + p.stock_quantity, 0),
    [parts],
  );

  const totalIssued = useMemo(
    () =>
      auditLog
        .filter((a) => a.movement_type === "ISSUED_TO_REPAIR")
        .reduce((sum, a) => sum + Math.abs(a.change_quantity), 0),
    [auditLog],
  );

  const totalSalesRevenue = useMemo(
    () => sales.reduce((sum, s) => sum + Number(s.total_amount), 0),
    [sales],
  );

  const lowStockCount = useMemo(
    () => parts.filter((p) => p.stock_quantity <= 2).length,
    [parts],
  );

  const filteredParts = useMemo(() => {
    if (!search.trim()) return parts;
    const q = search.toLowerCase();
    return parts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.part_number.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.location && p.location.toLowerCase().includes(q)) ||
        p.compatible_models.some((m) => m.toLowerCase().includes(q)),
    );
  }, [parts, search]);

  const filteredMovements = useMemo(() => {
    let list = auditLog;
    if (movementFilter !== "ALL") {
      list = list.filter((a) => a.movement_type === movementFilter);
    }
    return list;
  }, [auditLog, movementFilter]);

  const filteredSales = useMemo(() => {
    let list = sales;
    if (salesPartFilter !== "ALL") {
      list = list.filter((s) => s.part_id === salesPartFilter);
    }
    if (salesDateFilter === "7d") {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      list = list.filter((s) => new Date(s.sold_at).getTime() >= cutoff);
    } else if (salesDateFilter === "30d") {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      list = list.filter((s) => new Date(s.sold_at).getTime() >= cutoff);
    }
    return list;
  }, [sales, salesPartFilter, salesDateFilter]);

  const handleConfirmHandoff = async () => {
    if (!handoffTarget) return;
    setConfirmingHandoff(true);
    try {
      const res = await confirmPartHandoff(handoffTarget.id);
      const isSaleText = res.is_sale ? " (Recorded as sale against approved quote)" : "";
      toast.success(
        `Handoff confirmed: ${handoffTarget.part?.name} handed to technician.${isSaleText}`,
      );
      setHandoffTarget(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to confirm handoff.";
      toast.error(msg);
    } finally {
      setConfirmingHandoff(false);
    }
  };

  const handleAdjustStock = async () => {
    if (!adjustTarget) return;
    if (!adjustReason.trim()) {
      toast.error("Please provide a reason for the stock adjustment.");
      return;
    }
    const delta = adjustType === "add" ? Math.abs(adjustQty) : -Math.abs(adjustQty);
    setAdjusting(true);
    try {
      await adjustPartStock({
        partId: adjustTarget.id,
        changeQuantity: delta,
        reason: adjustReason.trim(),
      });
      toast.success(
        `Stock adjusted for ${adjustTarget.name} (${delta > 0 ? `+${delta}` : delta}).`,
      );
      setAdjustTarget(null);
      setAdjustReason("");
      setAdjustQty(1);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to adjust stock.";
      toast.error(msg);
    } finally {
      setAdjusting(false);
    }
  };

  const handleReceiveStock = async () => {
    if (!receivePartId) return;
    if (receiveQty <= 0) {
      toast.error("Please enter a valid positive quantity.");
      return;
    }
    setReceiving(true);
    try {
      await receiveStock({
        partId: receivePartId,
        quantity: receiveQty,
        reason: receiveReason.trim() || "Supplier shipment received",
      });
      toast.success("Stock delivery received into depot.");
      setReceiveModalOpen(false);
      setReceiveQty(1);
      setReceiveReason("");
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record stock delivery.";
      toast.error(msg);
    } finally {
      setReceiving(false);
    }
  };

  const handleReturnPart = async () => {
    if (!returnPartId) return;
    if (!returnRepairId.trim()) {
      toast.error("Please specify the repair job reference (e.g. TB-8841).");
      return;
    }
    if (returnQty <= 0) {
      toast.error("Please enter a valid positive quantity.");
      return;
    }
    setReturning(true);
    try {
      await returnPart({
        repairRequestId: returnRepairId.trim(),
        partId: returnPartId,
        quantity: returnQty,
        reason: returnReason.trim() || "Unused component returned from repair",
      });
      toast.success("Unused part returned back to depot stock.");
      setReturnModalOpen(false);
      setReturnQty(1);
      setReturnReason("");
      setReturnRepairId("");
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to process part return.";
      toast.error(msg);
    } finally {
      setReturning(false);
    }
  };

  const handleOpenUpdateEta = (req: ServiceCentrePartRequestDetail) => {
    setSourcingHoldTarget(null);
    setEtaTarget(req);
    setNewEta(req.estimated_arrival_at || "");
    setEtaNotes(req.notes || "");
  };

  const handleOpenSourcingHoldEta = (sh: SourcingHoldDetail) => {
    setEtaTarget(null);
    setSourcingHoldTarget(sh);
    setNewEta(sh.eta || "");
    setEtaNotes(sh.reason || "");
  };

  const handleSaveEta = async () => {
    if (!etaTarget && !sourcingHoldTarget) return;
    setUpdatingEta(true);
    try {
      if (etaTarget) {
        await updatePartRequestEta(etaTarget.id, {
          estimatedArrivalAt: newEta.trim() || null,
          notes: etaNotes.trim() || undefined,
        });
        toast.success(`Arrival ETA updated for ${etaTarget.part?.name || "spare part"}.`);
        setEtaTarget(null);
      } else if (sourcingHoldTarget) {
        const isDemo =
          !isUuid(sourcingHoldTarget.repairId) ||
          tb.repairs.some(
            (x) =>
              x.id === sourcingHoldTarget.repairId ||
              (x as any).jobNumber === sourcingHoldTarget.repairId,
          );
        if (isDemo) {
          actions.updatePartsEta(
            sourcingHoldTarget.repairId,
            newEta.trim() || "ETA pending",
            "admin",
            sourcingHoldTarget.id,
          );
        }
        try {
          await updatePartsEta(sourcingHoldTarget.repairId, {
            eta: newEta.trim() || "ETA pending",
            requestId: sourcingHoldTarget.id,
          });
        } catch {
          // If remote DB missing or demo-only
        }
        if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
          try {
            const bc = new BroadcastChannel("terrabyte_demo_store_sync");
            bc.postMessage({ type: "STORE_UPDATED", event: "part_eta_updated" });
            bc.close();
          } catch {
            // Ignore
          }
        }
        toast.success(`Sourcing ETA updated for ${sourcingHoldTarget.part}.`);
        setSourcingHoldTarget(null);
      }
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update ETA.";
      toast.error(msg);
    } finally {
      setUpdatingEta(false);
    }
  };

  return (
    <div className="space-y-6">
      <ContextualBack to="/admin" label="Back to operations triage" />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Service Centre Parts Desk
            </h1>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              Nagpur Central Hub
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Nagpur Central Depot · Manage inventory, pickup requisitions, stock movements, and repair sales.
          </p>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/10">
          <p className="text-sm font-semibold text-destructive">{error}</p>
        </Card>
      )}

      {/* Overview Stat Cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                On Hand (Depot)
              </p>
              <p className="mt-1 font-display text-2xl font-bold">{totalOnHand} units</p>
            </div>
            <span className="rounded-xl bg-primary/15 p-2.5 text-primary">
              <Package className="h-5 w-5" />
            </span>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Pending Pickups
              </p>
              <p className="mt-1 font-display text-2xl font-bold">
                {pendingRequests.length}
              </p>
            </div>
            <span className="rounded-xl bg-warning/15 p-2.5 text-warning-foreground">
              <Clock className="h-5 w-5" />
            </span>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Issued to Repairs
              </p>
              <p className="mt-1 font-display text-2xl font-bold">{totalIssued} units</p>
            </div>
            <span className="rounded-xl bg-accent/20 p-2.5 text-foreground">
              <TrendingUp className="h-5 w-5" />
            </span>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Fulfilled Quote Value (Sales)
              </p>
              <p className="mt-1 font-display text-2xl font-bold">{inr(totalSalesRevenue)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Parts issued against approved quotes · Payment collection is not recorded
              </p>
            </div>
            <span className="rounded-xl bg-success/15 p-2.5 text-success">
              <DollarSign className="h-5 w-5" />
            </span>
          </div>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setTab("requests")}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            tab === "requests"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Technician Requests ({pendingRequests.length})
        </button>

        <button
          type="button"
          onClick={() => setTab("inventory")}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            tab === "inventory"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Depot Inventory ({parts.length})
        </button>

        <button
          type="button"
          onClick={() => setTab("movements")}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            tab === "movements"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Stock Movements ({auditLog.length})
        </button>

        <button
          type="button"
          onClick={() => setTab("sales")}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            tab === "sales"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Repair Sales & History ({sales.length})
        </button>
      </div>

      {/* TAB 1: TECHNICIAN REQUISITIONS */}
      {tab === "requests" && (
        <div className="space-y-4">
          {pendingRequests.length === 0 ? (
            <Card className="py-12 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
              <p className="mt-3 font-semibold">No pending pickup requests</p>
              <p className="text-sm text-muted-foreground">
                All technician parts requests have been fulfilled or cancelled.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((req) => (
                <Card
                  key={req.id}
                  className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-primary">
                        {req.part?.part_number}
                      </span>
                      <h3 className="font-bold">{req.part?.name}</h3>
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                        Qty: {req.quantity}
                      </span>
                      {req.part && req.part.stock_quantity === 0 && (
                        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                          Out of Depot Stock
                        </span>
                      )}
                      {req.part && req.part.stock_quantity > 0 && req.part.stock_quantity < req.quantity && (
                        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                          Insufficient Stock ({req.part.stock_quantity} available)
                        </span>
                      )}
                      {req.part?.location && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Shelf: {req.part.location}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs mt-1">
                      <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-muted-foreground">Expected Arrival:</span>
                      <span className={cn("font-medium", req.estimated_arrival_at ? "text-primary font-semibold" : "text-muted-foreground italic")}>
                        {req.estimated_arrival_at ? formatEtaDateTime(req.estimated_arrival_at) : "ETA pending"}
                      </span>
                    </div>
                    {req.eta_updated_at && (
                      <p className="text-[11px] text-muted-foreground">
                        ETA set {req.eta_updater?.full_name ? `by ${req.eta_updater.full_name}` : ""} on {new Date(req.eta_updated_at).toLocaleDateString()}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Assigned repair:{" "}
                      <Link
                        to="/admin/repair/$id"
                        params={{ id: req.repair?.id || req.repair_request_id }}
                        className="font-semibold text-foreground underline"
                      >
                        {req.repair?.job_number || req.repair_request_id}
                      </Link>{" "}
                      · Requested by {req.requester?.full_name || "Assigned Technician"}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <MapPin className="h-3 w-3 text-primary shrink-0" />
                      <span>Service Location: <span className="font-medium text-foreground">{req.repair?.location || "Field breakdown location"}</span></span>
                    </p>
                    {req.notes && (
                      <p className="text-xs italic text-muted-foreground">
                        Note: "{req.notes}"
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenUpdateEta(req)}
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/5 px-3 text-xs font-semibold text-primary hover:bg-primary/15"
                    >
                      Update ETA
                    </button>
                    {req.part && req.part.stock_quantity >= req.quantity ? (
                      <button
                        type="button"
                        onClick={() => setHandoffTarget(req)}
                        className="inline-flex h-9 items-center justify-center rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                      >
                        Confirm Handoff
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        title="Stock Unavailable: Insufficient depot inventory. Receive depot delivery before confirming handoff."
                        className="inline-flex h-9 items-center justify-center rounded-xl bg-muted px-4 text-xs font-bold text-muted-foreground opacity-50 cursor-not-allowed"
                      >
                        Handoff Locked (Out of Stock)
                      </button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* FIELD & EXTERNAL SOURCING HOLDS */}
          {sourcingHolds.length > 0 && (
            <div className="space-y-3 pt-6 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    <PackageSearch className="h-4 w-4 text-primary" />
                    Field &amp; External Sourcing Holds ({sourcingHolds.length})
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Required components on field repairs awaiting delivery or external sourcing. Not held in depot stock.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {sourcingHolds.map((sh, idx) => (
                  <Card
                    key={`${sh.repairId}-${sh.id}-${idx}`}
                    className="flex flex-col gap-4 border-dashed border-border/80 bg-muted/20 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-bold text-foreground">{sh.part}</h4>
                        <span className="rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-xs font-semibold">
                          External Sourcing Hold
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground font-medium">
                          Awaiting Arrival
                        </span>
                        {sh.quantity > 1 && (
                          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                            Qty: {sh.quantity}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs mt-1">
                        <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-muted-foreground">Expected Arrival:</span>
                        <span className={cn("font-medium", sh.eta ? "text-primary font-semibold" : "text-muted-foreground italic")}>
                          {sh.eta ? formatEtaDateTime(sh.eta) : "ETA pending"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Assigned repair:{" "}
                        <Link
                          to="/admin/repair/$id"
                          params={{ id: sh.repairId }}
                          className="font-semibold text-foreground underline"
                        >
                          {sh.jobNumber}
                        </Link>{" "}
                        · Technician: {sh.technicianName}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <MapPin className="h-3 w-3 text-primary shrink-0" />
                        <span>Service Location: <span className="font-medium text-foreground">{sh.location}</span></span>
                      </p>
                      {sh.reason && (
                        <p className="text-xs italic text-muted-foreground">
                          Note: "{sh.reason}"
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenSourcingHoldEta(sh)}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/5 px-3 text-xs font-semibold text-primary hover:bg-primary/15"
                      >
                        Update ETA
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: INVENTORY CATALOG */}
      {tab === "inventory" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by part name, SKU, spec, category, model, shelf location..."
                className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReceiveModalOpen(true)}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-success px-3.5 text-xs font-bold text-success-foreground hover:bg-success/90"
              >
                <ArrowDownLeft className="h-4 w-4" />
                Receive Delivery
              </button>

              <button
                type="button"
                onClick={() => setReturnModalOpen(true)}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-xs font-bold hover:bg-muted"
              >
                <RotateCcw className="h-3.5 w-3.5 text-primary" />
                Return Part
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Part Name & SKU</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Compatible Machines</th>
                    <th className="px-4 py-3">Shelf Location</th>
                    <th className="px-4 py-3">Unit Price</th>
                    <th className="px-4 py-3 text-center">On Hand</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredParts.map((part) => (
                    <tr key={part.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-semibold">
                        <p>{part.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {part.part_number} · {part.spec || "OEM"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs">{part.category}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {part.compatible_models.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        {part.location || "Depot Main Floor"}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold">
                        {inr(Number(part.unit_price))}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "inline-block rounded-full px-2.5 py-0.5 text-xs font-bold",
                            part.stock_quantity === 0
                              ? "bg-destructive/15 text-destructive"
                              : part.stock_quantity <= 2
                                ? "bg-warning/15 text-warning-foreground"
                                : "bg-success/15 text-success",
                          )}
                        >
                          {part.stock_quantity} on hand
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setAdjustTarget(part);
                            setAdjustQty(1);
                            setAdjustType("add");
                            setAdjustReason("");
                          }}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                        >
                          Adjust Stock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: STOCK MOVEMENTS LEDGER */}
      {tab === "movements" && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">Stock Movement Audit Ledger</h2>
              </div>

              {/* Movement Type Filter Pills */}
              <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
                {["ALL", "RECEIVED", "ISSUED_TO_REPAIR", "RETURNED", "ADJUSTMENT"].map(
                  (type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setMovementFilter(type)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 transition-colors",
                        movementFilter === type
                          ? "bg-primary text-primary-foreground"
                          : "border border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {type === "ALL"
                        ? "All Movements"
                        : type === "RECEIVED"
                          ? "Received"
                          : type === "ISSUED_TO_REPAIR"
                            ? "Issued to Repair"
                            : type === "RETURNED"
                              ? "Returned"
                              : "Adjustments"}
                    </button>
                  ),
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              Immutable ledger of all incoming stock receipts, repair issues, unused returns, and manual adjustments.
            </p>

            {filteredMovements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No stock movements matching the selected filter.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-muted/40 uppercase text-muted-foreground font-semibold">
                    <tr>
                      <th className="px-3 py-2">Timestamp</th>
                      <th className="px-3 py-2">Part</th>
                      <th className="px-3 py-2">Movement Type</th>
                      <th className="px-3 py-2">Change</th>
                      <th className="px-3 py-2">Previous → New</th>
                      <th className="px-3 py-2">Related Repair</th>
                      <th className="px-3 py-2">Reason / Note</th>
                      <th className="px-3 py-2">Staff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredMovements.map((log) => (
                      <tr key={log.id}>
                        <td className="px-3 py-2 text-muted-foreground">
                          {fmtTime(new Date(log.created_at).getTime())}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {log.part?.name || "Part"}
                          {log.part?.part_number && (
                            <span className="block font-mono text-[10px] text-muted-foreground">
                              {log.part.part_number}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase",
                              log.movement_type === "RECEIVED"
                                ? "bg-success/15 text-success"
                                : log.movement_type === "ISSUED_TO_REPAIR"
                                  ? "bg-primary/15 text-primary"
                                  : log.movement_type === "RETURNED"
                                    ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
                                    : "bg-muted text-muted-foreground",
                            )}
                          >
                            {log.movement_type || "ADJUSTMENT"}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono font-bold">
                          <span
                            className={
                              log.change_quantity > 0
                                ? "text-success"
                                : "text-destructive"
                            }
                          >
                            {log.change_quantity > 0
                              ? `+${log.change_quantity}`
                              : log.change_quantity}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {log.previous_stock} → {log.new_stock}
                        </td>
                        <td className="px-3 py-2">
                          {log.repair_request_id ? (
                            <span className="font-mono text-primary font-semibold">
                              {log.repair_request_id}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 capitalize">{log.reason}</td>
                        <td className="px-3 py-2">{log.actor?.full_name || "Staff"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 4: REPAIR SALES & HISTORY */}
      {tab === "sales" && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold">Repair Sales & Sourcing History</h2>
                <p className="text-xs text-muted-foreground">
                  Durable sales records counting parts physically issued against farmer-approved quotes.
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={salesPartFilter}
                  onChange={(e) => setSalesPartFilter(e.target.value)}
                  className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="ALL">All Catalog Parts</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.part_number})
                    </option>
                  ))}
                </select>

                <div className="flex rounded-lg border border-border p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setSalesDateFilter("all")}
                    className={cn(
                      "rounded px-2.5 py-1 transition-colors",
                      salesDateFilter === "all"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    All Time
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalesDateFilter("30d")}
                    className={cn(
                      "rounded px-2.5 py-1 transition-colors",
                      salesDateFilter === "30d"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Last 30 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalesDateFilter("7d")}
                    className={cn(
                      "rounded px-2.5 py-1 transition-colors",
                      salesDateFilter === "7d"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Last 7 Days
                  </button>
                </div>
              </div>
            </div>

            {filteredSales.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <CheckCircle2 className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="font-semibold text-sm">No repair sales recorded yet</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  A technician handoff is an issue to a repair. It is counted as a sale only when it is physically handed off against a farmer-approved quote line identifying this catalog part.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-muted/40 uppercase text-muted-foreground font-semibold">
                    <tr>
                      <th className="px-3 py-2">Sale Date</th>
                      <th className="px-3 py-2">Part Name & SKU</th>
                      <th className="px-3 py-2">Qty Sold</th>
                      <th className="px-3 py-2">Quote Price (Snapshot)</th>
                      <th className="px-3 py-2">Total Amount</th>
                      <th className="px-3 py-2">Repair Job</th>
                      <th className="px-3 py-2">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredSales.map((s) => (
                      <tr key={s.id}>
                        <td className="px-3 py-2 text-muted-foreground">
                          {fmtTime(new Date(s.sold_at).getTime())}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          <p>{s.part?.name || "Part"}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {s.part?.part_number} · {s.part?.spec || "OEM"}
                          </p>
                        </td>
                        <td className="px-3 py-2 font-bold font-mono">
                          {s.quantity} units
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {inr(Number(s.unit_price))}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-success">
                          {inr(Number(s.total_amount))}
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold text-primary">
                          <Link
                            to="/admin/repair/$id"
                            params={{ id: s.repair?.id || s.repair_request_id }}
                            className="underline"
                          >
                            {s.repair?.job_number || s.repair_request_id}
                          </Link>
                          <div className="text-[11px] font-normal text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3 text-primary shrink-0" />
                            <span>{s.repair?.location || "Katol, Nagpur"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {s.actor?.full_name || "Staff"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* CONFIRM HANDOFF MODAL */}
      <Dialog
        open={Boolean(handoffTarget)}
        onOpenChange={(open) => !open && setHandoffTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Part Handoff</DialogTitle>
            <DialogDescription>
              Confirm physical handoff of the component to the technician. This will atomically decrement depot stock.
            </DialogDescription>
          </DialogHeader>

          {handoffTarget && (
            <div className="space-y-3 py-2 text-sm">
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="font-bold">{handoffTarget.part?.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  SKU: {handoffTarget.part?.part_number} · Spec: {handoffTarget.part?.spec}
                </p>
                <div className="mt-2 flex justify-between text-xs">
                  <span>Quantity to Hand Off:</span>
                  <span className="font-bold">{handoffTarget.quantity} units</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Current Depot Stock:</span>
                  <span className="font-bold">{handoffTarget.part?.stock_quantity} units</span>
                </div>
              </div>

              <div className="rounded-xl bg-primary/10 p-3 text-xs text-primary">
                Technician <b>{handoffTarget.requester?.full_name}</b> will be notified that the component is ready for installation on repair <b>{handoffTarget.repair?.job_number}</b>.
              </div>
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              disabled={confirmingHandoff}
              onClick={() => setHandoffTarget(null)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={confirmingHandoff}
              onClick={handleConfirmHandoff}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {confirmingHandoff ? "Confirming..." : "Confirm Physical Handoff"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RECEIVE STOCK DELIVERY MODAL */}
      <Dialog open={receiveModalOpen} onOpenChange={setReceiveModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Receive Stock Delivery</DialogTitle>
            <DialogDescription>
              Record incoming tractor spare parts received at the Nagpur Service Centre depot.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label>Spare Part</Label>
              <select
                value={receivePartId}
                onChange={(e) => setReceivePartId(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.part_number}) — {p.stock_quantity} currently on hand
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Quantity Received</Label>
              <input
                type="number"
                min="1"
                value={receiveQty}
                onChange={(e) => setReceiveQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <Label>Supplier Delivery Note / PO Reference</Label>
              <input
                type="text"
                value={receiveReason}
                onChange={(e) => setReceiveReason(e.target.value)}
                placeholder="e.g. Received from Bosch Taluka Distributor (PO-8821)"
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              disabled={receiving}
              onClick={() => setReceiveModalOpen(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={receiving}
              onClick={handleReceiveStock}
              className="rounded-lg bg-success px-4 py-2 text-sm font-bold text-success-foreground hover:bg-success/90 disabled:opacity-50"
            >
              {receiving ? "Recording..." : "Confirm Stock Receipt"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RETURN UNUSED PART MODAL */}
      <Dialog open={returnModalOpen} onOpenChange={setReturnModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Return Unused Part to Depot</DialogTitle>
            <DialogDescription>
              Record an unused component returned from a field repair back into central depot inventory.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label>Repair Job Reference</Label>
              <input
                type="text"
                value={returnRepairId}
                onChange={(e) => setReturnRepairId(e.target.value)}
                placeholder="e.g. TB-8841"
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <Label>Component Returned</Label>
              <select
                value={returnPartId}
                onChange={(e) => setReturnPartId(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.part_number})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Quantity Returned</Label>
              <input
                type="number"
                min="1"
                value={returnQty}
                onChange={(e) => setReturnQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <Label>Reason for Return</Label>
              <input
                type="text"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="e.g. Secondary gasket unused; returned in sealed packaging"
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              disabled={returning}
              onClick={() => setReturnModalOpen(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={returning || !returnRepairId.trim()}
              onClick={handleReturnPart}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {returning ? "Processing..." : "Confirm Part Return"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADJUST STOCK MODAL */}
      <Dialog
        open={Boolean(adjustTarget)}
        onOpenChange={(open) => !open && setAdjustTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Depot Stock</DialogTitle>
            <DialogDescription>
              Record an inventory adjustment for {adjustTarget?.name}. An audit entry will be logged.
            </DialogDescription>
          </DialogHeader>

          {adjustTarget && (
            <div className="space-y-4 py-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustType("add")}
                  className={cn(
                    "flex-1 rounded-lg py-2 text-xs font-bold transition-colors",
                    adjustType === "add"
                      ? "bg-success text-success-foreground"
                      : "border border-border text-muted-foreground",
                  )}
                >
                  <Plus className="inline mr-1 h-3.5 w-3.5" /> Incoming Stock (Add)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustType("remove")}
                  className={cn(
                    "flex-1 rounded-lg py-2 text-xs font-bold transition-colors",
                    adjustType === "remove"
                      ? "bg-destructive text-destructive-foreground"
                      : "border border-border text-muted-foreground",
                  )}
                >
                  <Minus className="inline mr-1 h-3.5 w-3.5" /> Defect / Write-Off (Deduct)
                </button>
              </div>

              <div>
                <Label>Quantity to {adjustType === "add" ? "add" : "deduct"}</Label>
                <input
                  type="number"
                  min="1"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <Label>Reason for adjustment (Required for audit log)</Label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Physical inventory count recount, shelf damaged box"
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="rounded-xl bg-muted/60 p-3 text-xs">
                <span>Calculated new stock level: </span>
                <b className="font-mono">
                  {adjustTarget.stock_quantity} {adjustType === "add" ? "+" : "-"} {adjustQty} ={" "}
                  {adjustType === "add"
                    ? adjustTarget.stock_quantity + adjustQty
                    : Math.max(0, adjustTarget.stock_quantity - adjustQty)}{" "}
                  units
                </b>
              </div>
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              disabled={adjusting}
              onClick={() => setAdjustTarget(null)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={adjusting || !adjustReason.trim()}
              onClick={handleAdjustStock}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {adjusting ? "Saving..." : "Save Stock Adjustment"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* UPDATE ETA MODAL */}
      <Dialog
        open={Boolean(etaTarget || sourcingHoldTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEtaTarget(null);
            setSourcingHoldTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Coordinate Expected Arrival (ETA)</DialogTitle>
            <DialogDescription>
              Set or update expected delivery date &amp; time for{" "}
              {etaTarget?.part?.name || sourcingHoldTarget?.part || "spare part"}. Updates the repair hold and farmer view in real time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Expected Arrival Date &amp; Time</Label>
              <DateTimePicker value={newEta} onChange={setNewEta} />
              <p className="mt-1 text-xs text-muted-foreground">
                Set when component arrival or delivery is expected.
              </p>
            </div>

            <div>
              <Label className="text-xs">Sourcing / Coordination Notes (Optional)</Label>
              <input
                type="text"
                value={etaNotes}
                onChange={(e) => setEtaNotes(e.target.value)}
                placeholder="e.g. Sourced from regional depot / supplier transit confirmed"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              disabled={updatingEta}
              onClick={() => {
                setEtaTarget(null);
                setSourcingHoldTarget(null);
              }}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={updatingEta}
              onClick={handleSaveEta}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {updatingEta ? "Saving..." : "Save ETA"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Minus({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 12h14" />
    </svg>
  );
}
