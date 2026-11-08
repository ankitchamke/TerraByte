import { Printer, ShieldCheck, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface CustodyReceiptData {
  receiptNumber: string;
  droppedOffAt: string;
  jobNumber: string;
  equipmentMake: string;
  equipmentModel: string;
  equipmentType?: string;
  equipmentSerial?: string;
  farmerName: string;
  farmerPhone?: string;
  facilityName: string;
  facilityAddress?: string;
  droppedOffByName?: string;
  notes?: string;
  path?: "ACTIVE" | "STANDBY";
}

interface CustodyReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: CustodyReceiptData | null;
}

export function CustodyReceiptModal({ open, onOpenChange, data }: CustodyReceiptModalProps) {
  if (!data) return null;

  const handlePrint = () => {
    window.print();
  };

  const formattedDate = new Date(data.droppedOffAt).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden sm:rounded-2xl">
        <div className="bg-card p-6 sm:p-8 space-y-6 print:p-0 print:border-none print:shadow-none">
          {/* Header */}
          <div className="border-b border-border pb-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-6 w-6 text-primary" />
                  <span className="font-mono text-xs uppercase tracking-widest text-primary font-bold">
                    TerraByte Workshop Network
                  </span>
                </div>
                <h2 className="text-2xl font-bold mt-1">Custody & Intake Receipt</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Official physical drop-off confirmation & equipment intake record
                </p>
              </div>

              <div className="text-right">
                <Badge
                  variant="outline"
                  className="font-mono text-sm px-2.5 py-1 font-semibold border-primary/40 bg-primary/5 text-primary"
                >
                  {data.receiptNumber}
                </Badge>
                {data.path && (
                  <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">
                    {data.path === "ACTIVE"
                      ? "Active Reservation Claimed"
                      : "Standby Arrival Accepted"}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-1">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
                Equipment Details
              </span>
              <p className="text-sm font-bold text-foreground">
                {data.equipmentMake} {data.equipmentModel}
              </p>
              <p className="text-muted-foreground">
                {data.equipmentType || "Machinery"}
                {data.equipmentSerial ? ` · SN: ${data.equipmentSerial}` : ""}
              </p>
            </div>

            <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-1">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
                Repair Job Reference
              </span>
              <p className="text-sm font-mono font-bold text-foreground">{data.jobNumber}</p>
              <p className="text-muted-foreground">Intake: {formattedDate}</p>
            </div>

            <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-1">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
                Owner / Farmer
              </span>
              <p className="text-sm font-semibold text-foreground">{data.farmerName}</p>
              <p className="text-muted-foreground">{data.farmerPhone || "No phone recorded"}</p>
            </div>

            <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-1">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
                Workshop & Custody Point
              </span>
              <p className="text-sm font-semibold text-foreground">{data.facilityName}</p>
              <p className="text-muted-foreground truncate">
                {data.facilityAddress || "Vidarbha Workshop Network"}
              </p>
            </div>
          </div>

          {/* Receiving Staff & Notes */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
                Receiving Staff
              </span>
              <span className="font-medium text-foreground">
                {data.droppedOffByName || "Authorized Workshop Staff"}
              </span>
            </div>

            {data.notes && (
              <div className="pt-2 border-t border-border/50">
                <span className="text-muted-foreground text-[11px] block font-semibold mb-0.5">
                  Intake Condition / Notes:
                </span>
                <p className="text-muted-foreground italic text-xs whitespace-pre-wrap">
                  {data.notes}
                </p>
              </div>
            )}
          </div>

          {/* Legal / Operational Notice */}
          <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-xl p-3 border border-border/50 leading-relaxed">
            <p>
              <strong>Custody Acknowledgement:</strong> This receipt certifies that the machinery
              specified above has been physically received and parked in an approved workshop bay.
              Physical bay occupancy is authoritatively held under TerraByte service governance
              until repair completion or authorized staff release.
            </p>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-3 pt-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button size="sm" onClick={handlePrint} className="gap-2">
              <Printer className="h-4 w-4" />
              Print Receipt
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
