import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2, UserCheck, Wrench } from "lucide-react";
import {
  adminDispatchTechnician,
  type ScoredTechnicianMatch,
  type RepairRequestRow,
} from "@/lib/services/technicians";

interface ManualDispatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repairId: string;
  jobNumber?: string;
  currentTechnicianId: string | null;
  currentTechnicianName: string | null;
  candidate: ScoredTechnicianMatch | null;
  onDispatchSuccess: (updatedRepair: RepairRequestRow) => void;
}

export function ManualDispatchDialog({
  open,
  onOpenChange,
  repairId,
  jobNumber,
  currentTechnicianId,
  currentTechnicianName,
  candidate,
  onDispatchSuccess,
}: ManualDispatchDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!candidate) return null;

  const isReassignment = Boolean(currentTechnicianId);
  const techProfile = candidate.technician.profile;
  const techName = techProfile?.full_name || "Technician";
  const workshopName = candidate.workshopName || candidate.technician.workshop_name || "Workshop";

  const handleConfirm = async () => {
    setValidationError(null);
    const trimmedReason = reason.trim();

    if (isReassignment && !trimmedReason) {
      setValidationError(
        "A mandatory explanation/reason is required when reassigning a technician.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const updated = await adminDispatchTechnician({
        repairRequestId: repairId,
        technicianId: candidate.technician.profile_id,
        reassignmentReason: trimmedReason || null,
        expectedCurrentTechnicianId: currentTechnicianId,
      });

      toast.success(
        isReassignment
          ? `Reassigned repair to ${techName}. Notifications sent.`
          : `Dispatched ${techName} to repair ${jobNumber || ""}.`,
      );
      setReason("");
      onOpenChange(false);
      onDispatchSuccess(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to dispatch technician";
      toast.error(msg);
      setValidationError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChangeInternal = (nextOpen: boolean) => {
    if (!submitting) {
      if (!nextOpen) {
        setReason("");
        setValidationError(null);
      }
      onOpenChange(nextOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChangeInternal}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isReassignment ? (
              <>
                <UserCheck className="h-5 w-5 text-amber-500" />
                Reassign Technician
              </>
            ) : (
              <>
                <Wrench className="h-5 w-5 text-primary" />
                Dispatch Technician
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isReassignment ? (
              <>
                Reassign repair ticket <strong>{jobNumber || "Repair"}</strong> from{" "}
                <strong>{currentTechnicianName || "current technician"}</strong> to{" "}
                <strong>{techName}</strong>.
              </>
            ) : (
              <>
                Assign technician <strong>{techName}</strong> to repair ticket{" "}
                <strong>{jobNumber || "Repair"}</strong>.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Candidate Summary Card */}
        <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-2 text-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-foreground">{techName}</p>
              <p className="text-xs text-muted-foreground">
                {workshopName} · {techProfile?.village || "Vidarbha"}
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              Score: {candidate.score}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {candidate.brandMatch && (
              <Badge variant="secondary" className="text-[11px] gap-1 py-0">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                Brand Expert
              </Badge>
            )}
            {candidate.skillMatch && (
              <Badge variant="secondary" className="text-[11px] gap-1 py-0">
                <CheckCircle2 className="h-3 w-3 text-blue-500" />
                Skill Match
              </Badge>
            )}
            {candidate.technician.is_available && (
              <Badge
                variant="outline"
                className="text-[11px] text-emerald-600 border-emerald-300 py-0"
              >
                Available
              </Badge>
            )}
          </div>

          {/* OSRM Route Info */}
          <div className="pt-1 text-xs text-muted-foreground border-t border-border/60">
            {candidate.routingStatus === "NO_COORDINATES" ? (
              <span>Distance Unavailable (No GPS coordinates recorded)</span>
            ) : candidate.routingStatus === "OUTAGE" || candidate.distanceKm == null ? (
              <span>Road Distance Temporarily Unavailable</span>
            ) : (
              <span className="flex items-center gap-1 font-medium text-foreground">
                <span>
                  {candidate.distanceKm} km · ~{candidate.etaMin} min
                </span>
                {(candidate.routingStatus === "EXTENDED" || candidate.distanceKm > 50) && (
                  <span className="flex items-center gap-0.5 text-amber-600 font-semibold ml-1">
                    <AlertTriangle className="h-3 w-3" />
                    (Extended Travel)
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Reason / Explanation Field */}
        <div className="space-y-2 pt-1">
          <Label htmlFor="dispatch-reason" className="text-sm font-medium">
            {isReassignment ? (
              <span>
                Reason for Reassignment <span className="text-destructive">*</span>
              </span>
            ) : (
              <span>Dispatch Notes / Reason (Optional)</span>
            )}
          </Label>
          <Textarea
            id="dispatch-reason"
            rows={3}
            placeholder={
              isReassignment
                ? "e.g., Previous technician unavailable due to illness / Machinery owner requested reallocation / Specialized engine diagnostic required"
                : "e.g., Immediate dispatch / Proximity match"
            }
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (validationError) setValidationError(null);
            }}
            disabled={submitting}
            className="text-sm resize-none"
          />
          {validationError && (
            <p className="text-xs font-medium text-destructive">{validationError}</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChangeInternal(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting || (isReassignment && !reason.trim())}
            className={isReassignment ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isReassignment ? "Confirm Reassignment" : "Confirm Dispatch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
