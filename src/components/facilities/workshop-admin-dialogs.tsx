import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Clock, Loader2, ShieldAlert, Wrench } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getDropOffApprovedFacilities,
  type DropOffFacilityOption,
} from "@/lib/services/facilities";
import {
  renewWorkshopBayReservation,
  rerouteWorkshopDropoff,
  releaseCancelledWorkshopEquipment,
} from "@/lib/services/facility-capacity";

// ============================================================================
// 1. EXTEND RESERVATION DIALOG (Mandatory Audit Notes for Admin)
// ============================================================================

interface ExtendReservationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservationId: string;
  jobNumber?: string;
  onSuccess?: () => void;
}

export function ExtendReservationDialog({
  open,
  onOpenChange,
  reservationId,
  jobNumber,
  onSuccess,
}: ExtendReservationDialogProps) {
  const [extensionInterval, setExtensionInterval] = useState("24 hours");
  const [auditNotes, setAuditNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auditNotes.trim()) {
      toast.error("Mandatory audit note required for administrative reservation extension.");
      return;
    }

    setLoading(true);
    try {
      const res = await renewWorkshopBayReservation(
        reservationId,
        extensionInterval,
        auditNotes.trim(),
      );

      if (!res.success) {
        toast.error(res.message || "Failed to extend bay reservation.");
        return;
      }

      toast.success(
        `Reservation extended successfully until ${new Date(res.new_expires_at || "").toLocaleString("en-IN")}`,
      );
      onOpenChange(false);
      setAuditNotes("");
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to extend reservation";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Clock className="h-5 w-5" />
            <DialogTitle>Extend Workshop Bay Reservation</DialogTitle>
          </div>
          <DialogDescription>
            Grant an administrative reservation extension for job #{jobNumber || "—"}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Extension Duration</label>
            <Select value={extensionInterval} onValueChange={setExtensionInterval}>
              <SelectTrigger>
                <SelectValue placeholder="Select duration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="12 hours">+12 Hours</SelectItem>
                <SelectItem value="24 hours">+24 Hours (Default)</SelectItem>
                <SelectItem value="48 hours">+48 Hours</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Administrative Audit Note <span className="text-destructive">*</span>
            </label>
            <Textarea
              placeholder="Mandatory reason for manual extension (e.g., Farmer transport delayed by unseasonal rain; verified by call)…"
              value={auditNotes}
              onChange={(e) => setAuditNotes(e.target.value)}
              rows={3}
              className="text-xs"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              All administrative extensions are permanently logged in the audit trail.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading} className="gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm Extension
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 2. REROUTE WORKSHOP DIALOG (Preserves FIFO Priority)
// ============================================================================

interface RerouteWorkshopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repairRequestId: string;
  currentFacilityId?: string | null;
  jobNumber?: string;
  onSuccess?: () => void;
}

export function RerouteWorkshopDialog({
  open,
  onOpenChange,
  repairRequestId,
  currentFacilityId,
  jobNumber,
  onSuccess,
}: RerouteWorkshopDialogProps) {
  const [facilities, setFacilities] = useState<DropOffFacilityOption[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      void (async () => {
        try {
          setLoadingList(true);
          const list = await getDropOffApprovedFacilities();
          const eligible = list.filter((f) => f.id !== currentFacilityId);
          setFacilities(eligible);
          if (eligible.length > 0) {
            setSelectedFacilityId(eligible[0].id);
          }
        } catch (err: unknown) {
          console.error("[TerraByte] Error loading facilities for reroute:", err);
          toast.error("Failed to load approved workshops for rerouting.");
        } finally {
          setLoadingList(false);
        }
      })();
    }
  }, [open, currentFacilityId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFacilityId) {
      toast.error("Please select a target workshop.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await rerouteWorkshopDropoff(repairRequestId, selectedFacilityId);
      if (!res.success) {
        toast.error(res.message || "Failed to reroute ticket.");
        return;
      }

      toast.success(
        "Ticket rerouted successfully! Original reservation FIFO priority timestamp preserved.",
      );
      onOpenChange(false);
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reroute repair ticket";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <ArrowRightLeft className="h-5 w-5" />
            <DialogTitle>Reroute Drop-Off Workshop</DialogTitle>
          </div>
          <DialogDescription>
            Reroute job #{jobNumber || "—"} to an alternative approved workshop with available bays.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {loadingList ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">Loading approved workshops…</span>
            </div>
          ) : facilities.length === 0 ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning">
              No other approved workshops found. Make sure other facilities have public drop-off
              approved.
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Target Workshop Facility
              </label>
              <Select value={selectedFacilityId} onValueChange={setSelectedFacilityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select approved workshop" />
                </SelectTrigger>
                <SelectContent>
                  {facilities.map((fac) => (
                    <SelectItem key={fac.id} value={fac.id}>
                      {fac.name} ({fac.village}, {fac.tahsil})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="rounded-xl border border-border/80 bg-muted/20 p-3 text-[11px] text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">FIFO Priority Invariant</p>
            <p>
              Rerouting preserves the ticket&apos;s original{" "}
              <code className="font-mono">reserved_at</code> timestamp. The ticket maintains its
              queue position ahead of newer incoming drop-offs at the new facility.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || facilities.length === 0}
              className="gap-2"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm Reroute
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 3. RELEASE CANCELLED WORKSHOP EQUIPMENT DIALOG
// ============================================================================

interface ReleaseEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repairRequestId: string;
  jobNumber?: string;
  equipmentSummary?: string;
  farmerName?: string;
  onSuccess?: () => void;
}

export function ReleaseEquipmentDialog({
  open,
  onOpenChange,
  repairRequestId,
  jobNumber,
  equipmentSummary,
  farmerName,
  onSuccess,
}: ReleaseEquipmentDialogProps) {
  const [releaseNotes, setReleaseNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await releaseCancelledWorkshopEquipment(
        repairRequestId,
        releaseNotes.trim() || undefined,
      );

      if (!res.success) {
        toast.error(res.message || "Failed to release equipment.");
        return;
      }

      toast.success(
        "Equipment physical release recorded! Workshop bay capacity is now authoritatively freed.",
      );
      onOpenChange(false);
      setReleaseNotes("");
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record equipment release";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            <DialogTitle>Record Equipment Physical Release</DialogTitle>
          </div>
          <DialogDescription>
            Authoritatively confirm the physical handover of cancelled equipment back to the owner.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs space-y-1">
            <div className="flex items-center justify-between font-semibold text-warning">
              <span>Job #{jobNumber || "—"}</span>
              <span>Cancelled in Bay</span>
            </div>
            <p className="text-foreground">
              <strong>Machine:</strong> {equipmentSummary || "Equipment"}
            </p>
            <p className="text-muted-foreground">
              <strong>Farmer:</strong> {farmerName || "Farmer"}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Handover / Release Notes (Optional)
            </label>
            <Textarea
              placeholder="e.g. Farmer picked up machine with private tractor trailer. Ignition key and battery returned in good order."
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              rows={3}
              className="text-xs"
            />
          </div>

          <div className="text-[11px] text-muted-foreground leading-relaxed">
            Recording this release sets{" "}
            <code className="font-mono">handover_status = &apos;RELEASED&apos;</code> and
            immediately reduces physical bay occupancy at the workshop facility.
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="gap-2 bg-warning text-warning-foreground hover:bg-warning/90"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm Equipment Released
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
