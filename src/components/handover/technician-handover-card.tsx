import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  FileCheck2,
  HandCoins,
  Loader2,
  Lock,
  Package,
  ShieldCheck,
  Truck,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Card, Label, StatusPill, btn, input } from "@/components/tb";
import { cn } from "@/lib/utils";
import {
  APPROVED_OFFLINE_PAYMENT_METHODS,
  authorizeEquipmentHandover,
  deriveHandoverReadiness,
  executeEquipmentHandoverRelease,
  recordOfflinePaymentClearance,
  type OfflinePaymentMethod,
} from "@/lib/services/handover";
import type { QuoteDetail } from "@/lib/services/quotes";
import type { RepairRequestDetail } from "@/lib/services/repair-requests";

export interface TechnicianHandoverCardProps {
  repair: RepairRequestDetail;
  quote?: QuoteDetail | null | undefined;
  onUpdate: () => Promise<void>;
  className?: string | undefined;
}

export function TechnicianHandoverCard({
  repair,
  quote,
  onUpdate,
  className,
}: TechnicianHandoverCardProps) {
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<OfflinePaymentMethod>("CASH_ON_DELIVERY");
  const [paymentReference, setPaymentReference] = useState("");
  const [clearanceNotes, setClearanceNotes] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const readiness = deriveHandoverReadiness({ repair, quote });
  const handoverStatus = repair.handover_status || "PENDING";
  const isConfirmed = Boolean(repair.farmer_collection_confirmed);

  const handleRecordPayment = async () => {
    if (
      ["DIRECT_UPI", "DIRECT_BANK_TRANSFER", "OFFLINE_CHEQUE"].includes(paymentMethod) &&
      !paymentReference.trim()
    ) {
      toast.error("Payment reference (UTR/Transaction ID/Cheque No.) is required.");
      return;
    }

    setSubmitting(true);
    try {
      await recordOfflinePaymentClearance({
        repairId: repair.id,
        paymentMethod,
        paymentReference: paymentReference.trim() || undefined,
        notes: clearanceNotes.trim() || undefined,
      });

      setShowPaymentModal(false);
      setPaymentReference("");
      setClearanceNotes("");
      toast.success("Offline payment clearance recorded successfully.");
      await onUpdate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to record payment clearance";
      console.error("[TerraByte] Payment clearance error:", err);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAuthorizeHandover = async () => {
    if (!readiness.canAuthorize) {
      toast.error(
        `Handover cannot be authorized: ${readiness.missingConditions.join(", ") || "Prerequisites not met."}`,
      );
      return;
    }

    setSubmitting(true);
    try {
      await authorizeEquipmentHandover({ repairId: repair.id });
      toast.success("Equipment handover authorized. Pickup location shared with farmer.");
      await onUpdate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to authorize handover";
      console.error("[TerraByte] Handover authorization error:", err);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecuteRelease = async () => {
    setSubmitting(true);
    try {
      await executeEquipmentHandoverRelease({
        repairId: repair.id,
        releaseNotes: releaseNotes.trim() || undefined,
      });

      setShowReleaseModal(false);
      setReleaseNotes("");
      toast.success("Equipment physically released. Farmer custody confirmation requested.");
      await onUpdate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to release equipment";
      console.error("[TerraByte] Equipment release error:", err);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className={cn("space-y-4 border-border", className)}>
      {/* Header with Status Pill */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          <h3 className="font-bold text-foreground text-base">Equipment Handover & Custody</h3>
        </div>
        <div className="flex items-center gap-2">
          {isConfirmed ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Custody Confirmed by Farmer
            </span>
          ) : handoverStatus === "RELEASED" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
              <Truck className="h-3.5 w-3.5" />
              Equipment Released
            </span>
          ) : handoverStatus === "AUTHORIZED" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <UserCheck className="h-3.5 w-3.5" />
              Authorized for Pickup
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Pending Authorization
            </span>
          )}
        </div>
      </div>

      {/* Readiness Preconditions Checklist */}
      <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Handover Authorization Gates
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {/* Gate 1: Load Test */}
          <div className="flex items-center gap-2">
            {readiness.loadTestPassed ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            )}
            <span
              className={
                readiness.loadTestPassed ? "text-foreground" : "text-destructive font-medium"
              }
            >
              Operational Load Test: {readiness.loadTestPassed ? "Passed" : "Missing / Failed"}
            </span>
          </div>

          {/* Gate 2: Quote Approval */}
          <div className="flex items-center gap-2">
            {readiness.quoteApproved ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-warning shrink-0" />
            )}
            <span
              className={readiness.quoteApproved ? "text-foreground" : "text-warning font-medium"}
            >
              Quotation: {readiness.quoteApproved ? "Approved" : "Awaiting Approval"}
            </span>
          </div>

          {/* Gate 3: Spare Parts Clearance */}
          <div className="flex items-center gap-2">
            {readiness.partsCleared ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-warning shrink-0" />
            )}
            <span
              className={readiness.partsCleared ? "text-foreground" : "text-warning font-medium"}
            >
              Spare Parts: {readiness.partsCleared ? "Cleared / Fulfilled" : "Requisitions Pending"}
            </span>
          </div>

          {/* Gate 4: Payment Clearance */}
          <div className="flex items-center gap-2">
            {readiness.paymentCleared ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            )}
            <span
              className={
                readiness.paymentCleared ? "text-foreground" : "text-destructive font-medium"
              }
            >
              Offline Payment: {readiness.paymentCleared ? "Cleared" : "Clearance Required"}
            </span>
          </div>
        </div>
      </div>

      {/* Payment Clearance Details / Trigger */}
      <div className="rounded-xl border border-border p-3.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CreditCard className="h-4 w-4 text-primary" />
            <span>Payment Clearance</span>
          </div>
          {repair.payment_cleared_at ? (
            <span className="text-xs font-semibold text-success flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Cleared on {new Date(repair.payment_cleared_at).toLocaleDateString()}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className={cn(btn.amber, "text-xs py-1.5 px-3")}
            >
              <HandCoins className="h-3.5 w-3.5" />
              Record Payment Clearance
            </button>
          )}
        </div>
        {repair.payment_cleared_at && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>
              Method: <b className="text-foreground">{repair.payment_method || "Offline"}</b>
              {repair.payment_reference && (
                <span>
                  {" "}
                  · Ref: <span className="font-mono">{repair.payment_reference}</span>
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Stage Action Controls */}
      {handoverStatus === "PENDING" && (
        <div className="space-y-2 pt-1">
          {!readiness.canAuthorize && (
            <p className="text-xs text-destructive font-medium flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Handover authorization locked: {readiness.missingConditions.join(", ")}
            </p>
          )}
          <button
            type="button"
            disabled={!readiness.canAuthorize || submitting}
            onClick={handleAuthorizeHandover}
            className={cn(btn.primary, "w-full text-sm font-semibold disabled:opacity-50")}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Authorize Equipment Handover
          </button>
        </div>
      )}

      {handoverStatus === "AUTHORIZED" && (
        <div className="space-y-3 pt-1">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-foreground space-y-1">
            <p className="font-semibold text-primary flex items-center gap-1.5">
              <UserCheck className="h-4 w-4" />
              Authorized for Workshop Pickup
            </p>
            <p className="text-muted-foreground">
              Farmer has been notified and granted access to workshop pickup coordinates and counter
              details. Confirm physical release once equipment leaves workshop premises.
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => setShowReleaseModal(true)}
            className={cn(btn.primary, "w-full text-sm font-semibold")}
          >
            <Truck className="h-4 w-4" />
            Confirm Physical Equipment Release
          </button>
        </div>
      )}

      {handoverStatus === "RELEASED" && (
        <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">Physical Release Confirmed</span>
            {repair.handover_released_at && (
              <span className="text-muted-foreground">
                {new Date(repair.handover_released_at).toLocaleString()}
              </span>
            )}
          </div>
          {repair.handover_notes && (
            <p className="text-muted-foreground font-mono bg-background p-2 rounded border border-border">
              {repair.handover_notes}
            </p>
          )}

          {isConfirmed ? (
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold pt-1">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Farmer confirmed custody receipt on{" "}
                {repair.farmer_collection_confirmed_at
                  ? new Date(repair.farmer_collection_confirmed_at).toLocaleString()
                  : "record"}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground pt-1">
              <Clock className="h-4 w-4 shrink-0 text-amber-500" />
              <span>Awaiting farmer digital collection confirmation via portal.</span>
            </div>
          )}
        </div>
      )}

      {/* Modal 1: Payment Clearance */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <Card className="max-w-md w-full space-y-4 p-5">
            <div className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-primary" />
              <h4 className="font-bold text-foreground text-base">
                Record Offline Payment Clearance
              </h4>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Verify receipt of dues before authorizing machinery collection. Direct table updates
              to payment fields are restricted; clearance is audited through secure RPC.
            </p>

            <div className="space-y-3">
              <div>
                <Label className="text-xs">Payment Method</Label>
                <select
                  aria-label="Payment Method"
                  className={input}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as OfflinePaymentMethod)}
                >
                  <option value="CASH_ON_DELIVERY">Cash on Delivery / Direct Cash</option>
                  <option value="DIRECT_UPI">Direct UPI / QR Transfer</option>
                  <option value="DIRECT_BANK_TRANSFER">Direct Bank Transfer (NEFT/IMPS)</option>
                  <option value="OFFLINE_CHEQUE">Physical Cheque</option>
                  <option value="WAIVED_WARRANTY">Warranty / Fee Waived</option>
                </select>
              </div>

              <div>
                <Label className="text-xs">
                  Reference / Transaction ID
                  {["DIRECT_UPI", "DIRECT_BANK_TRANSFER", "OFFLINE_CHEQUE"].includes(
                    paymentMethod,
                  ) && <span className="text-destructive"> *</span>}
                </Label>
                <input
                  type="text"
                  placeholder="e.g. UTR-98234821 or Cheque #102931"
                  className={input}
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs">Clearance Notes (Optional)</Label>
                <input
                  type="text"
                  placeholder="e.g. Collected at workshop counter, signed receipt issued"
                  className={input}
                  value={clearanceNotes}
                  onChange={(e) => setClearanceNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowPaymentModal(false)}
                className={btn.ghost}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleRecordPayment}
                className={cn(btn.primary, "disabled:opacity-50")}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Clearance"}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal 2: Physical Release */}
      {showReleaseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <Card className="max-w-md w-full space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              <h4 className="font-bold text-foreground text-base">
                Confirm Equipment Physical Release
              </h4>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Confirm that the machinery has been physically collected by the farmer or their
              authorized representative and has exited workshop premises.
            </p>

            <div>
              <Label className="text-xs">Release Notes (Optional)</Label>
              <textarea
                rows={3}
                placeholder="e.g. Keys handed to farmer Ramesh Patil. Equipment loaded on trailer MH-31-AB-1234. Gate exit logged."
                className={input}
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowReleaseModal(false)}
                className={btn.ghost}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleExecuteRelease}
                className={cn(btn.primary, "disabled:opacity-50")}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Release"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}
