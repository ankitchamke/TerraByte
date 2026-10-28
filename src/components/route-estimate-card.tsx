import { useState } from "react";
import { Car, Clock, Info, Loader2, Navigation, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isValidGpsCoordinate } from "@/lib/location";
import type { RouteEstimateResult } from "@/lib/services/routing";

interface RouteEstimateCardProps {
  repairId: string;
  hasGpsLocation: boolean;
  className?: string;
}

export function RouteEstimateCard({ repairId, hasGpsLocation, className }: RouteEstimateCardProps) {
  const [status, setStatus] = useState<
    "idle" | "requesting_location" | "calculating" | "success" | "error"
  >("idle");
  const [estimate, setEstimate] = useState<RouteEstimateResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!hasGpsLocation) {
    return null;
  }

  const handleEstimate = () => {
    if (status === "requesting_location" || status === "calculating") return;

    if (typeof window === "undefined" || !navigator?.geolocation) {
      setStatus("error");
      setErrorMsg(
        "Browser geolocation is not supported on this device. You can still use the Get Directions button for Google Maps navigation.",
      );
      return;
    }

    setStatus("requesting_location");
    setErrorMsg(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        if (!isValidGpsCoordinate(latitude, longitude)) {
          setStatus("error");
          setErrorMsg(
            "Received invalid GPS coordinates from device. Please check your device location settings.",
          );
          return;
        }

        setStatus("calculating");

        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!session?.access_token) {
            throw new Error("You must be logged in to request a driving estimate.");
          }

          const response = await fetch("/api/route-estimate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              repairId,
              technicianLatitude: latitude,
              technicianLongitude: longitude,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data?.error || "Failed to calculate route estimate.");
          }

          setEstimate(data as RouteEstimateResult);
          setStatus("success");
          setErrorMsg(null);
        } catch (err: unknown) {
          setStatus("error");
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "Could not calculate driving distance. Please use the Google Maps navigation button.",
          );
        }
      },
      (err) => {
        setStatus("error");
        if (err.code === 1) {
          setErrorMsg(
            "Location permission was denied. Allow location in your browser settings to estimate driving time, or use the Get Directions button.",
          );
        } else if (err.code === 2) {
          setErrorMsg(
            "Device GPS location is unavailable. Ensure device location is turned on, or use Get Directions.",
          );
        } else if (err.code === 3) {
          setErrorMsg("Location request timed out. Please try again.");
        } else {
          setErrorMsg(err.message || "Failed to capture current location.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  };

  const formattedCalculatedAt = estimate?.calculatedAt
    ? new Date(estimate.calculatedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className={
        className ||
        "rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3 text-sm transition-colors"
      }
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs sm:text-sm">
          <Car className="h-4 w-4 text-primary" />
          Driving Distance & Time Estimate
        </span>
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
          Google Routes
        </span>
      </div>

      {status === "idle" && (
        <div className="space-y-2.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Calculates road distance and travel time from your one-time current location to the
            farmer's saved GPS location using Google Maps Routes API. Your coordinates are never
            tracked or stored.
          </p>
          <button
            type="button"
            onClick={handleEstimate}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer"
          >
            <Car className="h-3.5 w-3.5" />
            <span>Estimate driving distance and time</span>
          </button>
        </div>
      )}

      {(status === "requesting_location" || status === "calculating") && (
        <div className="flex items-center gap-2.5 py-1 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          <span>
            {status === "requesting_location"
              ? "Accessing one-time device location..."
              : "Calculating driving route via Google Routes API..."}
          </span>
        </div>
      )}

      {status === "success" && estimate && (
        <div className="space-y-2.5 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-background p-2.5 border border-border/80">
              <span className="text-[11px] text-muted-foreground block font-medium">
                Road Distance
              </span>
              <span className="text-base sm:text-lg font-bold text-foreground">
                {estimate.distanceKm} km
              </span>
            </div>
            <div className="rounded-lg bg-background p-2.5 border border-border/80">
              <span className="text-[11px] text-muted-foreground block font-medium flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground" /> Est. Driving Time
              </span>
              <span className="text-base sm:text-lg font-bold text-foreground">
                ~{estimate.durationFormatted}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-[11px]">
              <Info className="h-3 w-3 shrink-0 text-muted-foreground" />
              Standard estimate (traffic not factored).{" "}
              {formattedCalculatedAt ? `Calculated at ${formattedCalculatedAt}.` : ""}
            </span>
            <button
              type="button"
              onClick={handleEstimate}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" /> Recalculate
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-destructive leading-relaxed">{errorMsg}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEstimate}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" /> Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
