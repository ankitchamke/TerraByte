import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  getFacilityCapacityBreakdown,
  getFacilityReservations,
  getFacilityPhysicalOccupancy,
  updateFacilityCapacity,
  type FacilityCapacityBreakdown,
  type FacilityReservation,
  type FacilityPhysicalOccupancy,
} from "@/lib/services/facility-capacity";
import { WorkshopCheckinDialog } from "./workshop-checkin-dialog";
import { CustodyReceiptModal, type CustodyReceiptData } from "./custody-receipt-modal";
import {
  ExtendReservationDialog,
  RerouteWorkshopDialog,
  ReleaseEquipmentDialog,
} from "./workshop-admin-dialogs";

interface WorkshopOperationsDeskProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facility: {
    id: string;
    name: string;
    village: string;
    tahsil: string;
    owner_name?: string;
    owner_phone?: string;
    max_equipment_capacity?: number;
    drop_off_approved?: boolean;
  };
  onFacilityUpdated?: () => void;
}

export function WorkshopOperationsDesk({
  open,
  onOpenChange,
  facility,
  onFacilityUpdated,
}: WorkshopOperationsDeskProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [capacity, setCapacity] = useState<FacilityCapacityBreakdown | null>(null);
  const [reservations, setReservations] = useState<FacilityReservation[]>([]);
  const [occupancy, setOccupancy] = useState<FacilityPhysicalOccupancy[]>([]);

  // Capacity edit state
  const [editingCapacity, setEditingCapacity] = useState(false);
  const [newCapacityValue, setNewCapacityValue] = useState(facility.max_equipment_capacity || 4);
  const [savingCapacity, setSavingCapacity] = useState(false);

  // Sub-dialog states
  const [selectedCheckinRepair, setSelectedCheckinRepair] = useState<{
    id: string;
    job_number: string;
    equipment_make?: string;
    equipment_model?: string;
    farmer_name?: string;
    farmer_phone?: string;
  } | null>(null);

  const [selectedReceiptData, setSelectedReceiptData] = useState<CustodyReceiptData | null>(null);

  const [selectedExtendReservationId, setSelectedExtendReservationId] = useState<{
    id: string;
    jobNumber?: string;
  } | null>(null);

  const [selectedRerouteRepairId, setSelectedRerouteRepairId] = useState<{
    id: string;
    jobNumber?: string;
  } | null>(null);

  const [selectedReleaseRepair, setSelectedReleaseRepair] = useState<{
    id: string;
    jobNumber?: string;
    equipmentSummary?: string;
    farmerName?: string;
  } | null>(null);

  const loadAllDeskData = useCallback(async () => {
    if (!facility.id) return;
    setLoading(true);
    try {
      const [capData, resData, occData] = await Promise.all([
        getFacilityCapacityBreakdown(facility.id),
        getFacilityReservations(facility.id),
        getFacilityPhysicalOccupancy(facility.id),
      ]);
      setCapacity(capData);
      setReservations(resData);
      setOccupancy(occData);
      setNewCapacityValue(capData.max_equipment_capacity);
    } catch (err: unknown) {
      console.error("[TerraByte] Error loading workshop desk data:", err);
      toast.error("Failed to load workshop desk data.");
    } finally {
      setLoading(false);
    }
  }, [facility.id]);

  useEffect(() => {
    if (open) {
      void loadAllDeskData();
    }
  }, [open, loadAllDeskData]);

  const handleUpdateCapacitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCapacity(true);
    try {
      await updateFacilityCapacity(facility.id, newCapacityValue);
      toast.success(`Workshop capacity updated to ${newCapacityValue} bays.`);
      setEditingCapacity(false);
      await loadAllDeskData();
      onFacilityUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update capacity";
      toast.error(msg);
    } finally {
      setSavingCapacity(false);
    }
  };

  const activeReservations = reservations.filter((r) => r.status === "RESERVED");
  const expiredOrStandby = reservations.filter((r) => r.status === "EXPIRED");
  const totalBays = capacity?.max_equipment_capacity || facility.max_equipment_capacity || 4;
  const physicalCount = capacity?.physical_occupancy ?? 0;
  const committedCount = capacity?.total_committed_capacity ?? 0;
  const availableBays = capacity?.available_capacity ?? totalBays;
  const occupancyPercent = Math.min(100, Math.round((committedCount / totalBays) * 100));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 sm:rounded-2xl">
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="h-6 w-6 text-primary" />
                  <span className="font-mono text-xs uppercase tracking-widest text-primary font-bold">
                    Workshop Operations Desk
                  </span>
                </div>
                <h2 className="text-2xl font-bold mt-1">{facility.name}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {facility.village}, {facility.tahsil} · Manager:{" "}
                  {facility.owner_name || "Assigned lead"} ({facility.owner_phone || "—"})
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadAllDeskData()}
                  disabled={loading}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  Refresh
                </Button>
                {capacity?.is_overcommitted ? (
                  <Badge className="bg-destructive text-destructive-foreground text-xs gap-1">
                    <ShieldAlert className="h-3 w-3" /> Overcommitted
                  </Badge>
                ) : capacity?.is_at_capacity ? (
                  <Badge className="bg-amber-600 text-white text-xs gap-1">
                    <AlertTriangle className="h-3 w-3" /> At Capacity
                  </Badge>
                ) : (
                  <Badge className="bg-success text-success-foreground text-xs gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Bays Available
                  </Badge>
                )}
              </div>
            </div>

            {/* Quick Capacity Bar */}
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground">
                  Bay Utilization: {committedCount} of {totalBays} committed ({occupancyPercent}%)
                </span>
                <span className="text-muted-foreground font-mono">
                  {availableBays > 0 ? `${availableBays} bays available` : "0 bays free"}
                </span>
              </div>
              <Progress
                value={occupancyPercent}
                className={
                  capacity?.is_overcommitted
                    ? "[&>div]:bg-destructive"
                    : capacity?.is_at_capacity
                      ? "[&>div]:bg-amber-500"
                      : "[&>div]:bg-success"
                }
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center text-xs">
                <div className="rounded-lg bg-muted/40 p-2">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                    Max Bays
                  </span>
                  <p className="text-base font-bold">{totalBays}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                    In Bays Now
                  </span>
                  <p className="text-base font-bold text-primary">{physicalCount}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                    Active Reserved
                  </span>
                  <p className="text-base font-bold text-amber-600">{activeReservations.length}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                    Available
                  </span>
                  <p className="text-base font-bold text-success">{Math.max(0, availableBays)}</p>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="overview" className="text-xs">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="reservations" className="text-xs">
                  Reservations ({activeReservations.length})
                </TabsTrigger>
                <TabsTrigger value="bays" className="text-xs">
                  Equipment In Bays ({occupancy.length})
                </TabsTrigger>
                <TabsTrigger value="standby" className="text-xs">
                  Standby / Expired ({expiredOrStandby.length})
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: OVERVIEW & CAPACITY SETTINGS */}
              <TabsContent value="overview" className="space-y-4">
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold">Bay Capacity Governance</h3>
                      <p className="text-xs text-muted-foreground">
                        Configure the maximum concurrent machinery bays for this workshop.
                      </p>
                    </div>
                    {!editingCapacity && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingCapacity(true)}
                        className="text-xs"
                      >
                        Change Capacity
                      </Button>
                    )}
                  </div>

                  {editingCapacity ? (
                    <form
                      onSubmit={handleUpdateCapacitySubmit}
                      className="space-y-3 pt-2 border-t border-border/50"
                    >
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-semibold shrink-0">Bays (1–20):</label>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={newCapacityValue}
                          onChange={(e) => setNewCapacityValue(Number(e.target.value))}
                          className="w-24 text-xs"
                          required
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={savingCapacity}
                          className="gap-1.5 text-xs"
                        >
                          {savingCapacity && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingCapacity(false)}
                          disabled={savingCapacity}
                          className="text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Downsizing capacity holds bays for active reservations and rejects new
                        standby arrivals until physical occupancy is reduced. Existing machinery is
                        never evicted.
                      </p>
                    </form>
                  ) : (
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      This workshop is configured with{" "}
                      <strong>{totalBays} physical machinery bays</strong>. Incoming farmer
                      reservations hold capacity for 24 hours until physical check-in or expiration.
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* TAB 2: INCOMING RESERVATIONS */}
              <TabsContent value="reservations" className="space-y-3">
                {activeReservations.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground space-y-2">
                    <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="font-semibold text-sm">No active incoming reservations</p>
                    <p className="text-xs">
                      Farmers reporting breakdowns with workshop drop-off will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeReservations.map((res) => {
                      const rep = res.repair;
                      return (
                        <div
                          key={res.id}
                          className="rounded-2xl border border-border bg-card p-4 space-y-3 text-xs"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-foreground">
                                  #{rep?.job_number || res.repair_request_id.slice(0, 8)}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-primary/5 text-primary border-primary/30"
                                >
                                  Reserved (FIFO Priority)
                                </Badge>
                                {res.renewal_count > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] text-amber-600 border-amber-600/30"
                                  >
                                    Renewed ({res.renewal_count}x)
                                  </Badge>
                                )}
                              </div>
                              <p className="text-foreground font-semibold mt-1">
                                {rep?.equipment_make} {rep?.equipment_model} (
                                {rep?.equipment_type || "Machinery"})
                              </p>
                              <p className="text-muted-foreground text-[11px]">
                                Farmer: {rep?.farmer_name} · {rep?.farmer_phone || "No phone"} ·
                                Village: {rep?.location}
                              </p>
                            </div>

                            <div className="text-right">
                              <span className="text-[10px] text-muted-foreground block font-semibold uppercase">
                                Expires
                              </span>
                              <span className="font-mono font-medium text-amber-600 text-[11px]">
                                {new Date(res.expires_at).toLocaleString("en-IN", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/40">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs gap-1.5"
                              onClick={() =>
                                setSelectedExtendReservationId({
                                  id: res.id,
                                  jobNumber: rep?.job_number,
                                })
                              }
                            >
                              <Clock className="h-3.5 w-3.5" />
                              Extend
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs gap-1.5"
                              onClick={() =>
                                setSelectedRerouteRepairId({
                                  id: res.repair_request_id,
                                  jobNumber: rep?.job_number,
                                })
                              }
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                              Reroute
                            </Button>
                            <Button
                              size="sm"
                              className="text-xs gap-1.5"
                              onClick={() =>
                                setSelectedCheckinRepair({
                                  id: res.repair_request_id,
                                  job_number: rep?.job_number || "—",
                                  equipment_make: rep?.equipment_make,
                                  equipment_model: rep?.equipment_model,
                                  farmer_name: rep?.farmer_name,
                                  farmer_phone: rep?.farmer_phone,
                                })
                              }
                            >
                              <Wrench className="h-3.5 w-3.5" />
                              Check In Equipment
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* TAB 3: EQUIPMENT IN BAYS */}
              <TabsContent value="bays" className="space-y-3">
                {occupancy.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground space-y-2">
                    <Truck className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="font-semibold text-sm">No machinery currently in workshop bays</p>
                    <p className="text-xs">
                      Physical bays are empty. Checked-in equipment will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {occupancy.map((occ) => (
                      <div
                        key={occ.repair_id}
                        className={
                          occ.is_cancelled_in_custody
                            ? "rounded-2xl border border-amber-500/50 bg-amber-500/5 p-4 space-y-3 text-xs"
                            : "rounded-2xl border border-border bg-card p-4 space-y-3 text-xs"
                        }
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-foreground">
                                #{occ.job_number}
                              </span>
                              {occ.is_cancelled_in_custody ? (
                                <Badge className="bg-amber-600 text-white text-[10px] gap-1">
                                  <AlertTriangle className="h-3 w-3" /> Cancelled in Bay
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-success/10 text-success border-success/40"
                                >
                                  In Custody ({occ.status})
                                </Badge>
                              )}
                              {occ.drop_off_receipt_number && (
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[10px] bg-muted/40"
                                >
                                  {occ.drop_off_receipt_number}
                                </Badge>
                              )}
                            </div>
                            <p className="text-foreground font-semibold mt-1">
                              {occ.equipment_make} {occ.equipment_model} (
                              {occ.equipment_type || "Machinery"})
                              {occ.equipment_serial ? ` · SN: ${occ.equipment_serial}` : ""}
                            </p>
                            <p className="text-muted-foreground text-[11px]">
                              Farmer: {occ.farmer_name} · {occ.farmer_phone || "—"} · Intake:{" "}
                              {new Date(occ.dropped_off_at).toLocaleString("en-IN", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </p>
                          </div>

                          <div className="text-right">
                            <span className="text-[10px] text-muted-foreground block font-semibold uppercase">
                              Handover Status
                            </span>
                            <span className="font-mono font-bold text-foreground">
                              {occ.handover_status}
                            </span>
                          </div>
                        </div>

                        {occ.is_cancelled_in_custody && (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
                            <strong>Cancelled Equipment Notice:</strong> The repair ticket was
                            cancelled, but the machine is physically in the bay. Bay occupancy is
                            locked until staff records physical release.
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/40">
                          {occ.drop_off_receipt_number && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs gap-1.5"
                              onClick={() =>
                                setSelectedReceiptData({
                                  receiptNumber: occ.drop_off_receipt_number!,
                                  droppedOffAt: occ.dropped_off_at,
                                  jobNumber: occ.job_number,
                                  equipmentMake: occ.equipment_make,
                                  equipmentModel: occ.equipment_model,
                                  equipmentType: occ.equipment_type,
                                  equipmentSerial: occ.equipment_serial,
                                  farmerName: occ.farmer_name,
                                  farmerPhone: occ.farmer_phone,
                                  facilityName: facility.name,
                                  droppedOffByName: occ.dropped_off_by_name || undefined,
                                })
                              }
                            >
                              <FileText className="h-3.5 w-3.5" />
                              View Receipt
                            </Button>
                          )}

                          {occ.is_cancelled_in_custody && (
                            <Button
                              size="sm"
                              className="text-xs gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
                              onClick={() =>
                                setSelectedReleaseRepair({
                                  id: occ.repair_id,
                                  jobNumber: occ.job_number,
                                  equipmentSummary: `${occ.equipment_make} ${occ.equipment_model}`,
                                  farmerName: occ.farmer_name,
                                })
                              }
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Record Physical Release
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* TAB 4: STANDBY & EXPIRED */}
              <TabsContent value="standby" className="space-y-3">
                {expiredOrStandby.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground space-y-2">
                    <Clock className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="font-semibold text-sm">No expired or standby tickets</p>
                    <p className="text-xs">
                      When a reservation exceeds 24 hours without drop-off, it transitions to
                      EXPIRED and appears here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {expiredOrStandby.map((res) => {
                      const rep = res.repair;
                      return (
                        <div
                          key={res.id}
                          className="rounded-2xl border border-border bg-card p-4 space-y-3 text-xs"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-foreground">
                                  #{rep?.job_number || res.repair_request_id.slice(0, 8)}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-muted-foreground border-border"
                                >
                                  Reservation Expired (Standby)
                                </Badge>
                              </div>
                              <p className="text-foreground font-semibold mt-1">
                                {rep?.equipment_make} {rep?.equipment_model} (
                                {rep?.equipment_type || "Machinery"})
                              </p>
                              <p className="text-muted-foreground text-[11px]">
                                Farmer: {rep?.farmer_name} · {rep?.farmer_phone || "—"}
                              </p>
                            </div>

                            <div className="text-right">
                              <span className="text-[10px] text-muted-foreground block font-semibold uppercase">
                                Expired At
                              </span>
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {new Date(res.expires_at).toLocaleString("en-IN", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/40">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs gap-1.5"
                              onClick={() =>
                                setSelectedRerouteRepairId({
                                  id: res.repair_request_id,
                                  jobNumber: rep?.job_number,
                                })
                              }
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                              Reroute
                            </Button>
                            <Button
                              size="sm"
                              className="text-xs gap-1.5"
                              onClick={() =>
                                setSelectedCheckinRepair({
                                  id: res.repair_request_id,
                                  job_number: rep?.job_number || "—",
                                  equipment_make: rep?.equipment_make,
                                  equipment_model: rep?.equipment_model,
                                  farmer_name: rep?.farmer_name,
                                  farmer_phone: rep?.farmer_phone,
                                })
                              }
                            >
                              <Wrench className="h-3.5 w-3.5" />
                              Attempt Standby Check-In
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      {/* SUB-DIALOGS */}
      {selectedCheckinRepair && (
        <WorkshopCheckinDialog
          open={Boolean(selectedCheckinRepair)}
          onOpenChange={(next) => {
            if (!next) setSelectedCheckinRepair(null);
          }}
          repair={selectedCheckinRepair}
          facilityName={facility.name}
          onSuccess={() => {
            void loadAllDeskData();
            onFacilityUpdated?.();
          }}
        />
      )}

      {selectedReceiptData && (
        <CustodyReceiptModal
          open={Boolean(selectedReceiptData)}
          onOpenChange={(next) => {
            if (!next) setSelectedReceiptData(null);
          }}
          data={selectedReceiptData}
        />
      )}

      {selectedExtendReservationId && (
        <ExtendReservationDialog
          open={Boolean(selectedExtendReservationId)}
          onOpenChange={(next) => {
            if (!next) setSelectedExtendReservationId(null);
          }}
          reservationId={selectedExtendReservationId.id}
          jobNumber={selectedExtendReservationId.jobNumber}
          onSuccess={() => {
            void loadAllDeskData();
            onFacilityUpdated?.();
          }}
        />
      )}

      {selectedRerouteRepairId && (
        <RerouteWorkshopDialog
          open={Boolean(selectedRerouteRepairId)}
          onOpenChange={(next) => {
            if (!next) setSelectedRerouteRepairId(null);
          }}
          repairRequestId={selectedRerouteRepairId.id}
          currentFacilityId={facility.id}
          jobNumber={selectedRerouteRepairId.jobNumber}
          onSuccess={() => {
            void loadAllDeskData();
            onFacilityUpdated?.();
          }}
        />
      )}

      {selectedReleaseRepair && (
        <ReleaseEquipmentDialog
          open={Boolean(selectedReleaseRepair)}
          onOpenChange={(next) => {
            if (!next) setSelectedReleaseRepair(null);
          }}
          repairRequestId={selectedReleaseRepair.id}
          jobNumber={selectedReleaseRepair.jobNumber}
          equipmentSummary={selectedReleaseRepair.equipmentSummary}
          farmerName={selectedReleaseRepair.farmerName}
          onSuccess={() => {
            void loadAllDeskData();
            onFacilityUpdated?.();
          }}
        />
      )}
    </>
  );
}
