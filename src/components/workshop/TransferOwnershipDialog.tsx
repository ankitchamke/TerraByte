import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, KeyRound, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  transferFacilityOwnership,
  type FacilityMemberWithProfile,
} from "@/lib/services/facilities";

interface TransferOwnershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  facilityName: string;
  eligibleMembers: FacilityMemberWithProfile[];
  onSuccess: () => void;
}

export function TransferOwnershipDialog({
  open,
  onOpenChange,
  facilityId,
  facilityName,
  eligibleMembers,
  onSuccess,
}: TransferOwnershipDialogProps) {
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Exclude current OWNER or unverified members; must be active MANAGER or TECHNICIAN
  const candidates = eligibleMembers.filter(
    (m) => m.role !== "OWNER" && m.status === "ACTIVE"
  );

  const isConfirmed = typedConfirmation.trim() === facilityName.trim();
  const canSubmit = Boolean(selectedMemberId) && isConfirmed && !submitting;

  const handleTransfer = async () => {
    if (!selectedMemberId) {
      toast.error("Please select an active member to receive ownership.");
      return;
    }
    if (!isConfirmed) {
      toast.error("Please type the exact workshop name to confirm transfer.");
      return;
    }

    try {
      setSubmitting(true);
      await transferFacilityOwnership(facilityId, selectedMemberId);
      toast.success(
        `Facility ownership transferred successfully. Your role has been updated to Manager.`
      );
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || "Failed to transfer facility ownership.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <KeyRound className="h-5 w-5" />
            <DialogTitle>Transfer Facility Ownership</DialogTitle>
          </div>
          <DialogDescription>
            Permanently reassign primary governance of <strong>{facilityName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 1: Warning banner */}
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              High-Friction Governance Action
            </div>
            <p>
              Transferring ownership will permanently relinquish your primary governance over this
              facility. You will be automatically reassigned as a <strong>MANAGER</strong>.
            </p>
            <p className="font-semibold">
              This action is atomic and irreversible without the new owner's explicit consent.
            </p>
          </div>

          {/* Step 2: Select New Owner */}
          <div className="space-y-2">
            <Label htmlFor="new-owner-select">Step 1: Select New Owner *</Label>
            {candidates.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
                No eligible active members found. You must first invite and have a technician accept
                membership before transferring ownership.
              </div>
            ) : (
              <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                <SelectTrigger id="new-owner-select">
                  <SelectValue placeholder="Choose an active member" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((m) => (
                    <SelectItem key={m.technician_profile_id} value={m.technician_profile_id}>
                      {m.profile?.full_name || "Unnamed Technician"} ({m.role}) ·{" "}
                      {m.profile?.phone || "No phone"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Step 3: Type Confirmation */}
          <div className="space-y-2">
            <Label htmlFor="confirmation-input">
              Step 2: Type <span className="font-mono font-bold text-foreground">"{facilityName}"</span> to confirm *
            </Label>
            <Input
              id="confirmation-input"
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              placeholder="Type exact workshop name"
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleTransfer}
            disabled={!canSubmit}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Transferring…
              </>
            ) : (
              "Confirm & Transfer Ownership"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
