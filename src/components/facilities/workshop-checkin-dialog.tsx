import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { executeWorkshopDropoffCheckin } from "@/lib/services/facility-capacity";
import { CustodyReceiptModal, type CustodyReceiptData } from "./custody-receipt-modal";

interface CheckinRepairInfo {
  id: string;
  job_number: string;
  delivery_mode?: string;
  equipment_make?: string;
  equipment_model?: string;
  equipment_type?: string;
  equipment_serial?: string;
  farmer_name?: string;
  farmer_phone?: string;
  facility_id?: string | null;
}

interface WorkshopCheckinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repair: CheckinRepairInfo;
  facilityName?: string;
  onSuccess?: (result: {
    receipt_number: string;
    dropped_off_at: string;
    path: "ACTIVE" | "STANDBY";
  }) => void;
}

export function WorkshopCheckinDialog({
  open,
  onOpenChange,
  repair,
  facilityName = "Workshop",
  onSuccess,
}: WorkshopCheckinDialogProps) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{
    receipt_number: string;
    dropped_off_at: string;
    path: "ACTIVE" | "STANDBY";
  } | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const handleReset = () => {
    setNotes("");
    setErrorMessage(null);
    setErrorCode(null);
    setSuccessResult(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleReset();
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    setErrorCode(null);

    try {
      const res = await executeWorkshopDropoffCheckin(repair.id, notes.trim() || undefined);

      if (!res.success) {
        setErrorCode(res.code || null);
        setErrorMessage(
          res.message || "Unable to check in machinery. Please check workshop bay capacity.",
        );
        return;
      }

      const receiptNumber = res.receipt_number || `RCP-TB-${Date.now()}`;
      const droppedOffAt = res.dropped_off_at || new Date().toISOString();
      const path = res.path || "ACTIVE";

      const outcome = {
        receipt_number: receiptNumber,
        dropped_off_at: droppedOffAt,
        path,
      };

      setSuccessResult(outcome);
      toast.success(`Check-in successful! Custody receipt: ${receiptNumber}`);
      onSuccess?.(outcome);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record drop-off check-in";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const receiptData: CustodyReceiptData | null = successResult
    ? {
        receiptNumber: successResult.receipt_number,
        droppedOffAt: successResult.dropped_off_at,
        jobNumber: repair.job_number,
        equipmentMake: repair.equipment_make || "Equipment",
        equipmentModel: repair.equipment_model || "",
        equipmentType: repair.equipment_type,
        equipmentSerial: repair.equipment_serial,
        farmerName: repair.farmer_name || "Farmer",
        farmerPhone: repair.farmer_phone,
        facilityName,
        notes: notes.trim() || undefined,
        path: successResult.path,
      }
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg sm:rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary">
              <Wrench className="h-5 w-5" />
              <DialogTitle>Physical Equipment Intake</DialogTitle>
            </div>
            <DialogDescription>
              Record the physical arrival and bay handover of machinery at {facilityName}.
            </DialogDescription>
          </DialogHeader>

          {successResult ? (
            <div className="space-y-4 py-2">
              <div className="rounded-2xl border border-success/40 bg-success/10 p-5 text-center space-y-3">
                <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
                <div>
                  <h3 className="text-lg font-bold text-success">Check-In Completed</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Equipment is now physically parked in the workshop bay.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-card p-3 space-y-1 inline-block text-left w-full">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Receipt Number:</span>
                    <span className="font-mono font-bold text-foreground">
                      {successResult.receipt_number}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Check-in Mode:</span>
                    <Badge variant="outline" className="text-[10px] font-semibold">
                      {successResult.path === "ACTIVE"
                        ? "Active Reservation Claimed"
                        : "Standby Arrival Accepted"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Intake Timestamp:</span>
                    <span className="text-foreground">
                      {new Date(successResult.dropped_off_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              </div>

              <DialogFooter className="flex flex-row items-center justify-end gap-2 sm:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReceiptModal(true)}
                  className="gap-1.5"
                >
                  <ShieldCheck className="h-4 w-4" />
                  View Custody Receipt
                </Button>
                <Button size="sm" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 py-2">
              {/* Machine & Farmer Summary */}
              <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 space-y-2 text-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-muted-foreground uppercase text-[10px] font-semibold">
                      Machine & Job
                    </span>
                    <p className="text-sm font-bold text-foreground">
                      {repair.equipment_make} {repair.equipment_model}
                    </p>
                    <p className="font-mono text-muted-foreground">#{repair.job_number}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Drop-Off
                  </Badge>
                </div>

                <div className="pt-2 border-t border-border/40 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-muted-foreground">Owner:</span>{" "}
                    <span className="font-semibold">{repair.farmer_name || "Farmer"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone:</span>{" "}
                    <span className="font-semibold">{repair.farmer_phone || "—"}</span>
                  </div>
                </div>
              </div>

              {/* Intake Notes */}
              <div className="space-y-1.5">
                <label htmlFor="intake-notes" className="text-xs font-semibold text-foreground">
                  Intake Condition & Physical Notes (Optional)
                </label>
                <Textarea
                  id="intake-notes"
                  placeholder="e.g. Arrived on tractor trailer. Machine has minor left fender dent. Ignition key handed to workshop lead."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
              </div>

              {/* Error & Capacity Warnings */}
              {errorMessage && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold">Check-in Rejected</p>
                    <p>{errorMessage}</p>
                    {errorCode === "DOWNSIZED_CAPACITY_HELD" && (
                      <p className="text-[11px] text-destructive/90">
                        Workshop capacity was downsized. Available bays are reserved for active
                        reservations. Consider rerouting this ticket to another approved facility.
                      </p>
                    )}
                    {errorCode === "CAPACITY_EXHAUSTED" && (
                      <p className="text-[11px] text-destructive/90">
                        All physical machine bays at this facility are currently occupied.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenChange(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={loading} className="gap-2">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm Physical Check-In
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Custody Receipt Modal */}
      {receiptData && (
        <CustodyReceiptModal
          open={showReceiptModal}
          onOpenChange={setShowReceiptModal}
          data={receiptData}
        />
      )}
    </>
  );
}
