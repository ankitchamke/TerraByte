import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  Phone,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Card, Label, btn } from "@/components/tb";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import {
  confirmFarmerEquipmentCollection,
  getFacilityHandoverLocation,
  type FacilityHandoverLocation,
} from "@/lib/services/handover";
import type { RepairRequestDetail } from "@/lib/services/repair-requests";

export interface FarmerHandoverCardProps {
  repair: RepairRequestDetail;
  onUpdate: () => Promise<void>;
  className?: string;
}

export function FarmerHandoverCard({ repair, onUpdate, className }: FarmerHandoverCardProps) {
  const { t } = useTranslation();
  const [pickupLocation, setPickupLocation] = useState<FacilityHandoverLocation | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handoverStatus = repair.handover_status || "PENDING";
  const isConfirmed = Boolean(repair.farmer_collection_confirmed);

  useEffect(() => {
    let active = true;
    if (handoverStatus === "AUTHORIZED") {
      setLoadingLocation(true);
      void getFacilityHandoverLocation(repair.id)
        .then((loc) => {
          if (active) setPickupLocation(loc);
        })
        .finally(() => {
          if (active) setLoadingLocation(false);
        });
    } else {
      setPickupLocation(null);
    }
    return () => {
      active = false;
    };
  }, [repair.id, handoverStatus]);

  const handleConfirmCollection = async () => {
    setConfirming(true);
    try {
      await confirmFarmerEquipmentCollection({ repairId: repair.id });
      toast.success(t("handover.successToast"));
      await onUpdate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to confirm equipment collection";
      console.error("[TerraByte] Collection confirmation error:", err);
      toast.error(message);
    } finally {
      setConfirming(false);
    }
  };

  const mapsUrl =
    pickupLocation?.latitude && pickupLocation?.longitude
      ? `https://www.google.com/maps/dir/?api=1&destination=${pickupLocation.latitude},${pickupLocation.longitude}`
      : pickupLocation?.counter_address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            pickupLocation.counter_address,
          )}`
        : null;

  return (
    <Card className={cn("space-y-4 border-2 border-border shadow-sm", className)}>
      {/* Card Header with Status Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          <h3 className="font-bold text-foreground text-base">{t("handover.sectionTitle")}</h3>
        </div>
        <div>
          {isConfirmed ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("handover.confirmedBadge")}
            </span>
          ) : handoverStatus === "RELEASED" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
              <Truck className="h-3.5 w-3.5" />
              {t("handover.releasedBadge")}
            </span>
          ) : handoverStatus === "AUTHORIZED" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              {t("handover.authorizedBadge")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {t("handover.pendingBadge")}
            </span>
          )}
        </div>
      </div>

      {/* State 1: Confirmed Receipt */}
      {isConfirmed ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>{t("handover.confirmedBadge")}</span>
          </div>
          <p className="text-xs text-foreground leading-relaxed">
            {t("handover.receiptConfirmed")}{" "}
            <span className="font-semibold">
              {repair.farmer_collection_confirmed_at
                ? new Date(repair.farmer_collection_confirmed_at).toLocaleString()
                : "recently"}
            </span>
            . Machinery custody has been safely restored to you.
          </p>
        </div>
      ) : handoverStatus === "RELEASED" ? (
        /* State 2: Physically Released, Awaiting Farmer Confirmation */
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 space-y-2">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-bold text-sm">
              <Truck className="h-5 w-5 shrink-0" />
              <span>{t("handover.releasedBadge")}</span>
            </div>
            <p className="text-xs text-foreground leading-relaxed">
              {t("handover.releasedNotice")}
            </p>
          </div>

          <button
            type="button"
            disabled={confirming}
            onClick={handleConfirmCollection}
            className={cn(btn.primary, "w-full py-3 text-sm font-bold shadow-sm")}
          >
            <CheckCircle2 className="h-4 w-4" />
            {confirming ? t("handover.confirmingButton") : t("handover.confirmButton")}
          </button>
        </div>
      ) : handoverStatus === "AUTHORIZED" ? (
        /* State 3: Authorized for Pickup, Location Revealed */
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-sm">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              <span>{t("handover.authorizedBadge")}</span>
            </div>
            <p className="text-xs text-foreground leading-relaxed">
              {t("handover.authorizedNotice")}
            </p>
          </div>

          {/* Workshop Pickup Details (strictly revealed when AUTHORIZED) */}
          {pickupLocation && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <h4 className="font-bold text-foreground text-sm">{t("handover.pickupDetails")}</h4>
              </div>

              <div className="space-y-1 text-xs">
                <p className="font-semibold text-foreground text-sm">
                  {pickupLocation.facility_name || pickupLocation.name}
                </p>
                {(pickupLocation.counter_address || pickupLocation.address) && (
                  <p className="text-muted-foreground">
                    {pickupLocation.counter_address || pickupLocation.address}
                  </p>
                )}
                {(pickupLocation.counter_phone || pickupLocation.phone) && (
                  <div className="flex items-center gap-1.5 pt-1 text-foreground">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>
                      {t("handover.counterPhone")}:{" "}
                      <b>{pickupLocation.counter_phone || pickupLocation.phone}</b>
                    </span>
                  </div>
                )}
                {pickupLocation.operating_hours && (
                  <div className="flex items-center gap-1.5 pt-0.5 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      {t("handover.operatingHours")}: {pickupLocation.operating_hours}
                    </span>
                  </div>
                )}
              </div>

              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(
                    btn.ghost,
                    "w-full text-xs font-semibold flex items-center justify-center gap-1.5",
                  )}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("handover.getDirections")}
                </a>
              )}
            </div>
          )}
        </div>
      ) : (
        /* State 4: Pending Authorization */
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground font-semibold text-sm">
              <Clock className="h-4 w-4" />
              <span>{t("handover.pendingBadge")}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("handover.pendingNotice")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-border p-2.5 space-y-1">
              <span className="text-muted-foreground">{t("handover.loadTestStatus")}</span>
              <p className="font-semibold flex items-center gap-1.5 text-foreground">
                {repair.load_test_passed ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    {t("handover.loadTestPassed")}
                  </>
                ) : (
                  <>
                    <Clock className="h-4 w-4 text-amber-500" />
                    {t("handover.loadTestPending")}
                  </>
                )}
              </p>
            </div>
            <div className="rounded-lg border border-border p-2.5 space-y-1">
              <span className="text-muted-foreground">{t("handover.paymentStatus")}</span>
              <p className="font-semibold flex items-center gap-1.5 text-foreground">
                {repair.payment_cleared_at ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    {t("handover.paymentCleared")}
                  </>
                ) : (
                  <>
                    <Clock className="h-4 w-4 text-amber-500" />
                    {t("handover.paymentPending")}
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
