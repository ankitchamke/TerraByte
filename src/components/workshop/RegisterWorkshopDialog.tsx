import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Building2, Compass, Loader2 } from "lucide-react";
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
  registerFacility,
  checkFacilityMigrationReadiness,
  isFacilityMigrationPendingError,
  FACILITY_MIGRATION_PENDING_MESSAGE,
  VIDARBHA_TAHSILS,
  TAHSIL_COORDINATES,
  type VidarbhaTahsil,
} from "@/lib/services/facilities";

interface RegisterWorkshopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RegisterWorkshopDialog({
  open,
  onOpenChange,
  onSuccess,
}: RegisterWorkshopDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [isMigrationUnavailable, setIsMigrationUnavailable] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [village, setVillage] = useState("");
  const [tahsil, setTahsil] = useState<VidarbhaTahsil>("Nagpur");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const nagpurCoords = TAHSIL_COORDINATES["Nagpur"] ?? { lat: 21.1458, lng: 79.0882 };
  const [lat, setLat] = useState<string>(String(nagpurCoords.lat));
  const [lng, setLng] = useState<string>(String(nagpurCoords.lng));
  const [coordSource, setCoordSource] = useState<"centroid" | "gps" | "manual">("centroid");
  const [confirmCentroid, setConfirmCentroid] = useState(false);
  const [capacity, setCapacity] = useState<number>(4);
  const [openTime, setOpenTime] = useState("08:00");
  const [closeTime, setCloseTime] = useState("19:00");
  const [detectingGps, setDetectingGps] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setCheckingReadiness(true);
    checkFacilityMigrationReadiness()
      .then((res) => {
        if (!mounted) return;
        if (!res.isReady) {
          setIsMigrationUnavailable(true);
          setSubmitError(res.message || FACILITY_MIGRATION_PENDING_MESSAGE);
        } else {
          setIsMigrationUnavailable(false);
          setSubmitError(null);
        }
      })
      .catch(() => {
        if (!mounted) return;
        setIsMigrationUnavailable(true);
        setSubmitError(FACILITY_MIGRATION_PENDING_MESSAGE);
      })
      .finally(() => {
        if (mounted) setCheckingReadiness(false);
      });

    return () => {
      mounted = false;
    };
  }, [open]);

  const handleTahsilChange = (val: VidarbhaTahsil) => {
    setTahsil(val);
    if (coordSource === "centroid") {
      const coords = TAHSIL_COORDINATES[val];
      if (coords) {
        setLat(String(coords.lat));
        setLng(String(coords.lng));
      }
    }
  };

  const handleManualLatChange = (v: string) => {
    setLat(v);
    setCoordSource("manual");
  };

  const handleManualLngChange = (v: string) => {
    setLng(v);
    setCoordSource("manual");
  };

  const handleDetectLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation is not supported by your browser.");
      return;
    }
    setDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDetectingGps(false);
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setCoordSource("gps");
        setConfirmCentroid(false);
        toast.success("Workshop coordinates detected from device GPS.");
      },
      (err) => {
        setDetectingGps(false);
        toast.error(`Could not get GPS location: ${err.message}. Using tahsil centroid fallback.`);
      },
      { timeout: 10000, enableHighAccuracy: true },
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isMigrationUnavailable) {
      return;
    }

    if (name.trim().length < 3) {
      toast.error("Workshop name must be at least 3 characters.");
      return;
    }
    if (address.trim().length < 3) {
      toast.error("Please enter a valid physical street address.");
      return;
    }
    if (village.trim().length < 2) {
      toast.error("Please enter a valid village or taluka hub.");
      return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    if (cleanPhone.length < 10) {
      toast.error("Please enter a valid 10-digit Indian phone number.");
      return;
    }
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (isNaN(latitude) || isNaN(longitude) || (latitude === 0 && longitude === 0)) {
      toast.error("Please enter valid geographic coordinates.");
      return;
    }

    if (coordSource === "centroid" && !confirmCentroid) {
      toast.error(
        "Please confirm that you are registering with approximate tahsil centroid coordinates, or click 'Detect GPS' for exact location.",
      );
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      await registerFacility({
        name: name.trim(),
        address: address.trim(),
        village: village.trim(),
        tahsil,
        phone: cleanPhone.slice(-10),
        email: email.trim() || null,
        latitude,
        longitude,
        max_equipment_capacity: capacity,
        operating_hours: {
          open: openTime,
          close: closeTime,
          days: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
        },
      });

      toast.success(
        "Workshop registered successfully. Nagpur Service Centre will review for public drop-off approval.",
      );
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to register workshop facility.";
      setSubmitError(msg);
      if (isFacilityMigrationPendingError(err) || msg === FACILITY_MIGRATION_PENDING_MESSAGE) {
        setIsMigrationUnavailable(true);
        // Migration-pending notice is shown inline in the dialog banner; avoid duplicate toast notification.
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <DialogTitle>Register Workshop Facility</DialogTitle>
          </div>
          <DialogDescription>
            Register your field workshop or repair bay in the Nagpur district network. You will be
            automatically designated as the <strong>Facility Owner</strong>.
          </DialogDescription>
        </DialogHeader>

        {submitError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Registration Unavailable</span>
            </p>
            <p>{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="fac-name">Workshop / Bay Name *</Label>
            <Input
              id="fac-name"
              placeholder="e.g. Kisan Agro Engineering Works"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fac-tahsil">Tahsil (Vidarbha) *</Label>
              <Select value={tahsil} onValueChange={(v) => handleTahsilChange(v as VidarbhaTahsil)}>
                <SelectTrigger id="fac-tahsil">
                  <SelectValue placeholder="Select tahsil" />
                </SelectTrigger>
                <SelectContent>
                  {VIDARBHA_TAHSILS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fac-village">Village / Hub *</Label>
              <Input
                id="fac-village"
                placeholder="e.g. Hingna MIDC, Katol"
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fac-address">Physical Street Address *</Label>
            <Input
              id="fac-address"
              placeholder="Plot No. / Road / Landmark"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fac-phone">Workshop Counter Phone (10 digits) *</Label>
              <Input
                id="fac-phone"
                type="tel"
                maxLength={14}
                placeholder="9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fac-email">Contact Email (Optional)</Label>
              <Input
                id="fac-email"
                type="email"
                placeholder="workshop@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-semibold">Location Coordinates *</Label>
                  {coordSource === "gps" ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-xs font-semibold text-success border border-success/30">
                      <Compass className="h-3 w-3" /> Exact Device GPS Verified
                    </span>
                  ) : coordSource === "manual" ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary border border-primary/20">
                      Custom Coordinates
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground border border-warning/30">
                      Approximate Tahsil Centroid (Default)
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Used as origin for dispatch distance and farmer turn-by-turn routing during
                  handovers.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDetectLocation}
                disabled={detectingGps}
                className="gap-1.5 h-8 text-xs shrink-0"
              >
                {detectingGps ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Compass className="h-3.5 w-3.5" />
                )}
                Detect GPS
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="fac-lat" className="text-xs text-muted-foreground">
                  Latitude
                </Label>
                <Input
                  id="fac-lat"
                  type="number"
                  step="0.000001"
                  value={lat}
                  onChange={(e) => handleManualLatChange(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="fac-lng" className="text-xs text-muted-foreground">
                  Longitude
                </Label>
                <Input
                  id="fac-lng"
                  type="number"
                  step="0.000001"
                  value={lng}
                  onChange={(e) => handleManualLngChange(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Approximate Centroid Explicit Acknowledgment */}
            {coordSource === "centroid" && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning-foreground space-y-1.5">
                <p className="font-semibold">
                  Notice: Coordinates default to the regional center of {tahsil}.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  For precise turn-by-turn navigation for farmers during machine collection, click
                  <strong> "Detect GPS"</strong> or enter your workshop's exact coordinates.
                </p>
                <label className="flex items-start gap-2 pt-1 font-medium text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmCentroid}
                    onChange={(e) => setConfirmCentroid(e.target.checked)}
                    className="mt-0.5 rounded border-warning text-primary focus:ring-primary h-4 w-4"
                  />
                  <span>
                    I understand these are approximate tahsil centroid coordinates, not my exact
                    physical workshop location.
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="fac-cap">Machinery Capacity (Bays)</Label>
              <Input
                id="fac-cap"
                type="number"
                min={1}
                max={50}
                value={capacity}
                onChange={(e) => setCapacity(parseInt(e.target.value, 10) || 1)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fac-open">Opens At</Label>
              <Input
                id="fac-open"
                type="time"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fac-close">Closes At</Label>
              <Input
                id="fac-close"
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
                required
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || checkingReadiness || isMigrationUnavailable}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registering…
                </>
              ) : isMigrationUnavailable ? (
                "Registration Unavailable"
              ) : (
                "Register Workshop"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
