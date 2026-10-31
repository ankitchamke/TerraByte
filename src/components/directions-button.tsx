import { useState } from "react";
import { ExternalLink, Lock, MapPin, Navigation } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsSearchUrl,
  formatGpsAccuracy,
  isValidGpsCoordinate,
} from "@/lib/location";
import type { RepairDispatchLocation } from "@/lib/services/repair-requests";
import { cn } from "@/lib/utils";

interface DirectionsButtonProps {
  dispatchLocation?: RepairDispatchLocation | null;
  fallbackLocation?: string | null;
  isAuthorized?: boolean;
  label?: string;
  className?: string;
  variant?: "outline" | "default";
}

export function DirectionsButton({
  dispatchLocation,
  fallbackLocation,
  isAuthorized = true,
  label = "Get directions",
  className,
  variant = "outline",
}: DirectionsButtonProps) {
  const [open, setOpen] = useState(false);

  const hasGps = Boolean(
    isAuthorized &&
    dispatchLocation &&
    isValidGpsCoordinate(dispatchLocation.latitude, dispatchLocation.longitude),
  );

  const lat = dispatchLocation?.latitude ?? 0;
  const lng = dispatchLocation?.longitude ?? 0;
  const accuracy = dispatchLocation?.accuracy ?? null;

  const targetUrl = hasGps
    ? buildGoogleMapsDirectionsUrl(lat, lng)
    : buildGoogleMapsSearchUrl(fallbackLocation || "Nagpur District");

  const buttonStyle =
    variant === "default"
      ? "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
      : "inline-flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonStyle, className)}>
        <Navigation className="h-4 w-4 shrink-0 text-primary" />
        <span>{label}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Navigation className="h-5 w-5 text-primary" />
              Navigate to Service Location
            </DialogTitle>
            <DialogDescription>
              Open navigation directions in Google Maps in a new browser tab.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            {!isAuthorized ? (
              /* State (c): Exact coordinates restricted to assigned technician/farmer/admin */
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                  <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span>Private Service Location</span>
                </div>
                <p className="text-sm font-medium text-foreground bg-background/80 p-2 rounded-md border border-border">
                  {fallbackLocation || "Nagpur District, Maharashtra"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Exact GPS coordinates are restricted to the assigned technician, owning farmer,
                  and platform administrators. You may search the general coarse area below.
                </p>
              </div>
            ) : hasGps ? (
              /* State (b): Exact GPS captured and viewer is authorized */
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" /> Exact GPS Coordinates
                  </span>
                  {accuracy != null && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-mono font-medium text-emerald-700 dark:text-emerald-400">
                      {formatGpsAccuracy(accuracy)}
                    </span>
                  )}
                </div>
                <p className="font-mono text-xs text-foreground bg-background/80 p-2 rounded-md border border-border">
                  {lat.toFixed(6)}, {lng.toFixed(6)}
                </p>
                {fallbackLocation && (
                  <p className="text-xs text-muted-foreground">
                    Area: <span className="font-medium text-foreground">{fallbackLocation}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Clicking below opens Google Maps driving directions directly to this pin.
                </p>
              </div>
            ) : (
              /* State (a): Request created without GPS coordinates */
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-warning-foreground font-semibold">
                  <MapPin className="h-4 w-4 text-warning" /> Coarse Service Area (No GPS Captured)
                </div>
                <p className="text-sm font-medium text-foreground bg-background/80 p-2 rounded-md border border-border">
                  {fallbackLocation || "Nagpur District, Maharashtra"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Exact GPS coordinates were not captured when this breakdown was reported. Google
                  Maps will search for this general village or tahsil area.
                </p>
              </div>
            )}

            <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              <p>
                Directions use external navigation via Google Maps. Zero continuous tracking or
                location telemetry is performed by TerraByte during transit.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted cursor-pointer"
            >
              Cancel
            </button>
            <a
              href={targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <span>{hasGps ? "Open Google Maps" : "Search in Maps"}</span>
              <ExternalLink className="h-4 w-4" />
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
