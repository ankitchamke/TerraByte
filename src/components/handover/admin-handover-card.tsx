import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  HandCoins,
  Loader2,
  Lock,
  ShieldCheck,
  Truck,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Card, Label, btn, input } from "@/components/tb";
import { cn } from "@/lib/utils";
import {
  authorizeEquipmentHandover,
  deriveHandoverReadiness,
  executeEquipmentHandoverRelease,
  recordOfflinePaymentClearance,
  type OfflinePaymentMethod,
} from "@/lib/services/handover";
import type { QuoteDetail } from "@/lib/services/quotes";
import type { RepairRequestDetail } from "@/lib/services/repair-requests";

export interface AdminHandoverCardProps {
  repair: RepairRequestDetail;
  quote?: QuoteDetail | null | undefined;
  onUpdate: () => Promise<void>;
  className?: string | undefined;
}

export function AdminHandoverCard({ repair, quote, onUpdate, className }: AdminHandoverCardProps) {
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
      toast.error("Payment reference is required for digital/cheque transfers.");
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
      toast.success("Payment clearance recorded by Service Centre admin.");
      await onUpdate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to record payment clearance";
      console.error("[TerraByte] Admin payment clearance error:", err);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAuthorizeHandover = async () => {
    if (!readiness.canAuthorize) {
      toast.error(`Authorization locked: ${readiness.missingConditions.join(", ")}`);
      return;
    }

    setSubmitting(true);
    try {
      await authorizeEquipmentHandover({ repairId: repair.id });
      toast.success("Equipment handover authorized by Service Centre admin.");
      await onUpdate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to authorize handover";
      console.error("[TerraByte] Admin handover authorization error:", err);
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
      toast.success("Physical equipment release logged by Service Centre admin.");
      await onUpdate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to log equipment release";
      console.error("[TerraByte] Admin release error:", err);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className={cn("space-y-4 border-2 border-border", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          <h3 className="font-bold text-foreground text-base">
            Service Centre Handover & Collection Desk
          </h3>
        </div>
        <div>
          {isConfirmed ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Farmer Custody Confirmed
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

      {/* Readiness checklist */}
      <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Compliance & Handover Checks
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2">
            {readiness.loadTestPassed ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            )}
            <span>Load Test: {readiness.loadTestPassed ? "Passed" : "Missing / Failed"}</span>
          </div>
          <div className="flex items-center gap-2">
            {readiness.quoteApproved ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-warning shrink-0" />
            )}
            <span>Quotation: {readiness.quoteApproved ? "Approved" : "Pending"}</span>
          </div>
          <div className="flex items-center gap-2">
            {readiness.partsCleared ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-warning shrink-0" />
            )}
            <span>Spare Parts: {readiness.partsCleared ? "Cleared" : "Pending Requisitions"}</span>
          </div>
          <div className="flex items-center gap-2">
            {readiness.paymentCleared ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            )}
            <span>Payment: {readiness.paymentCleared ? "Cleared" : "Pending Clearance"}</span>
          </div>
        </div>
      </div>

      {/* Payment clearance status */}
      <div className="rounded-xl border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <CreditCard className="h-4 w-4 text-primary" />
            Offline Payment Reconciliation
          </span>
          {repair.payment_cleared_at ? (
            <span className="text-xs text-success font-semibold flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Cleared ({repair.payment_method})
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className={cn(btn.amber, "text-xs py-1 px-2.5")}
            >
              <HandCoins className="h-3.5 w-3.5" />
              Record Clearance
            </button>
          )}
        </div>
        {repair.payment_reference && (
          <p className="text-xs text-muted-foreground font-mono">Ref: {repair.payment_reference}</p>
        )}
      </div>

      {/* Actions */}
      {handoverStatus === "PENDING" && (
        <div className="space-y-2">
          {!readiness.canAuthorize && (
            <p className="text-xs text-destructive flex items-center gap-1 font-medium">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Locked: {readiness.missingConditions.join(", ")}
            </p>
          )}
          <button
            type="button"
            disabled={!readiness.canAuthorize || submitting}
            onClick={handleAuthorizeHandover}
            className={cn(btn.primary, "w-full text-xs font-semibold py-2.5 disabled:opacity-50")}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Authorize Equipment Handover (Admin Override)
          </button>
        </div>
      )}

      {handoverStatus === "AUTHORIZED" && (
        <div className="space-y-2">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            Equipment is ready for farmer collection at the workshop counter.
          </p>
          <button
            type="button"
            disabled={submitting}
            onClick={() => setShowReleaseModal(true)}
            className={cn(btn.primary, "w-full text-xs font-semibold py-2.5")}
          >
            <Truck className="h-3.5 w-3.5" />
            Confirm Physical Release
          </button>
        </div>
      )}

      {handoverStatus === "RELEASED" && (
        <div className="rounded-lg border border-border bg-muted/20 p-2.5 text-xs space-y-1">
          <p className="font-semibold text-foreground">Equipment has exited workshop premises</p>
          {repair.handover_notes && (
            <p className="text-muted-foreground font-mono">{repair.handover_notes}</p>
          )}
          {isConfirmed ? (
            <p className="text-emerald-700 dark:text-emerald-400 font-semibold pt-1">
              ✓ Farmer verified custody on{" "}
              {repair.farmer_collection_confirmed_at
                ? new Date(repair.farmer_collection_confirmed_at).toLocaleString()
                : "record"}
            </p>
          ) : (
            <p className="text-muted-foreground pt-1">
              Awaiting farmer digital confirmation in portal.
            </p>
          )}
        </div>
      )}

      {/* Payment Clearance Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <Card className="max-w-md w-full space-y-3 p-4">
            <h4 className="font-bold text-foreground text-sm">Record Payment Clearance</h4>
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Method</Label>
                <select
                  aria-label="Admin Payment Method"
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
                <Label className="text-xs">Reference</Label>
                <input
                  type="text"
                  placeholder="UTR / Cheque No."
                  className={input}
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <input
                  type="text"
                  placeholder="Verified by Service Centre supervisor"
                  className={input}
                  value={clearanceNotes}
                  onChange={(e) => setClearanceNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
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
                {submitting ? "Saving…" : "Confirm"}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Release Modal */}
      {showReleaseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <Card className="max-w-md w-full space-y-3 p-4">
            <h4 className="font-bold text-foreground text-sm">Confirm Equipment Release</h4>
            <div>
              <Label className="text-xs">Release Notes</Label>
              <textarea
                rows={2}
                placeholder="Gate pass number, trailer details, representative name"
                className={input}
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
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
                {submitting ? "Releasing…" : "Confirm Release"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}
