import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Package,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, ContextualBack, Label } from "@/components/tb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { meta } from "@/lib/seo";
import {
  adjustPartStock,
  confirmPartHandoff,
  getAllPartRequests,
  getServiceCentreParts,
  getStockAuditLog,
  type ServiceCentrePart,
  type ServiceCentrePartRequestDetail,
  type StockAuditLogDetail,
} from "@/lib/services/parts-desk";
import { fmtTime, inr } from "@/lib/tb-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/parts-desk")({
  head: () =>
    meta(
      "Parts Desk",
      "Manage spare-parts inventory, review technician requests, and confirm pickup handoffs.",
    ),
  component: PartsDesk,
});

type Tab = "requests" | "inventory" | "audit";

function PartsDesk() {
  const [tab, setTab] = useState<Tab>("requests");
  const [parts, setParts] = useState<ServiceCentrePart[]>([]);
  const [requests, setRequests] = useState<ServiceCentrePartRequestDetail[]>([]);
  const [auditLog, setAuditLog] = useState<StockAuditLogDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Handoff confirmation modal state
  const [handoffTarget, setHandoffTarget] = useState<ServiceCentrePartRequestDetail | null>(null);
  const [confirmingHandoff, setConfirmingHandoff] = useState(false);

  // Stock adjustment modal state
  const [adjustTarget, setAdjustTarget] = useState<ServiceCentrePart | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(1);
  const [adjustType, setAdjustType] = useState<"add" | "remove">("add");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [partsData, requestsData, auditData] = await Promise.all([
        getServiceCentreParts().catch(() => []),
        getAllPartRequests().catch(() => []),
        getStockAuditLog().catch(() => []),
      ]);
      setParts(partsData);
      setRequests(requestsData);
      setAuditLog(auditData);
    } catch (err: unknown) {
      console.error("[TerraByte] Failed to load Parts Desk data:", err);
      const msg = err instanceof Error ? err.message : "Failed to load Parts Desk records.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === "PENDING"),
    [requests],
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
        p.compatible_models.some((m) => m.toLowerCase().includes(q)),
    );
  }, [parts, search]);

  const handleConfirmHandoff = async () => {
    if (!handoffTarget) return;
    setConfirmingHandoff(true);
    try {
      await confirmPartHandoff(handoffTarget.id);
      toast.success(
        `Handoff confirmed: ${handoffTarget.part?.name} handed to technician.`,
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
            Manage spare parts inventory, review technician pickup requests, and confirm physical handoffs.
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Pending Handoffs
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
                Cataloged Parts
              </p>
              <p className="mt-1 font-display text-2xl font-bold">{parts.length}</p>
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
                Low Stock Alerts
              </p>
              <p className="mt-1 font-display text-2xl font-bold">{lowStockCount}</p>
            </div>
            <span className="rounded-xl bg-destructive/15 p-2.5 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
          </div>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b border-border pb-2">
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
          onClick={() => setTab("audit")}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            tab === "audit"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Stock Audit Log
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
              {pendingRequests.map((req) => {
                const stock = req.part?.stock_quantity ?? 0;
                const canFulfill = stock >= req.quantity;

                return (
                  <Card key={req.id} className="transition-all">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/admin/repair/$id"
                            params={{ id: req.repair?.id || req.repair_request_id }}
                            className="font-mono text-sm font-bold text-primary hover:underline"
                          >
                            {req.repair?.job_number || "Repair Ticket"}
                          </Link>
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {req.repair?.location || "Nagpur"}
                          </span>
                          <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning-foreground">
                            Pickup Requested
                          </span>
                        </div>

                        <p className="text-base font-bold">
                          {req.part?.name || "Spare part"}
                          {req.part?.spec && (
                            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                              ({req.part.spec})
                            </span>
                          )}
                        </p>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            Requested by:{" "}
                            <b>{req.requester?.full_name || "Assigned Technician"}</b>
                          </span>
                          <span>Requested: {fmtTime(new Date(req.created_at).getTime())}</span>
                          <span>SKU: {req.part?.part_number || "—"}</span>
                        </div>

                        {req.notes && (
                          <p className="mt-2 text-xs italic text-muted-foreground">
                            Note: "{req.notes}"
                          </p>
                        )}
                      </div>

                      <div className="flex flex-row items-center justify-between gap-4 border-t border-border pt-3 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                        <div className="text-right">
                          <p className="text-sm font-semibold">
                            Qty Requested: <span className="font-bold">{req.quantity}</span>
                          </p>
                          <p className="text-xs">
                            Available in Depot:{" "}
                            <span
                              className={cn(
                                "font-bold",
                                canFulfill ? "text-success" : "text-destructive",
                              )}
                            >
                              {stock} units
                            </span>
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={!canFulfill}
                          onClick={() => setHandoffTarget(req)}
                          className={cn(
                            "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-bold transition-colors",
                            canFulfill
                              ? "bg-primary text-primary-foreground hover:bg-primary/90"
                              : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
                          )}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Confirm Handoff
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Fulfilled / Historical Requests Accordion */}
          {requests.some((r) => r.status !== "PENDING") && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Recent Handoff History
              </p>
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {requests
                  .filter((r) => r.status !== "PENDING")
                  .slice(0, 5)
                  .map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between p-3 text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold">
                          {req.repair?.job_number || "Repair"}
                        </span>{" "}
                        — {req.part?.name} (Qty {req.quantity})
                        <span className="ml-2 text-muted-foreground">
                          to {req.requester?.full_name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-success/15 px-2 py-0.5 font-semibold text-success">
                          {req.status}
                        </span>
                        <span className="text-muted-foreground">
                          {req.handed_off_at
                            ? fmtTime(new Date(req.handed_off_at).getTime())
                            : ""}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: INVENTORY CATALOG */}
      {tab === "inventory" && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by part name, SKU, category, or tractor model..."
              className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Part Name & SKU</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Compatible Machines</th>
                    <th className="px-4 py-3">Unit Price</th>
                    <th className="px-4 py-3 text-center">Available Stock</th>
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
                          {part.stock_quantity} units
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

      {/* TAB 3: AUDIT LOG */}
      {tab === "audit" && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <History className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">Stock Movement Audit Ledger</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Immutable ledger of all parts handoffs, incoming stock deliveries, and manual adjustments.
            </p>

            {auditLog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock adjustments recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-muted/40 uppercase text-muted-foreground font-semibold">
                    <tr>
                      <th className="px-3 py-2">Timestamp</th>
                      <th className="px-3 py-2">Part</th>
                      <th className="px-3 py-2">Change</th>
                      <th className="px-3 py-2">Previous → New</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2">Logged By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditLog.map((log) => (
                      <tr key={log.id}>
                        <td className="px-3 py-2 text-muted-foreground">
                          {fmtTime(new Date(log.created_at).getTime())}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {log.part?.name || "Part"}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold">
                          <span
                            className={
                              log.change_quantity > 0
                                ? "text-success"
                                : "text-destructive"
                            }
                          >
                            {log.change_quantity > 0 ? `+${log.change_quantity}` : log.change_quantity}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {log.previous_stock} → {log.new_stock}
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
                  placeholder="e.g. Distributor stock shipment received, damaged in transit"
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
