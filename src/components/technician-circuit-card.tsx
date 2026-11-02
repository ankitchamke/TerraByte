import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Building2,
  Clock,
  ExternalLink,
  MapPin,
  Navigation,
  RotateCcw,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { Card, StatusPill } from "@/components/tb";
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsSearchUrl,
  isValidGpsCoordinate,
  NAGPUR_TAHSIL_CENTROIDS,
  getNagpurTahsilCentroid,
  type GpsPoint,
} from "@/lib/location";
import {
  calculateCircuitMetrics,
  calculateDetourCost,
  type CircuitStopInput,
  type CircuitMetricsResult,
  type OrderedCircuitStop,
} from "@/lib/services/circuit-optimizer";
import { normalizeRepairDoorstepUrgency } from "@/lib/services/doorstep-service";
import {
  getRepairDispatchLocations,
  type RepairDispatchLocation,
  type RepairRequestWithEquipment,
} from "@/lib/services/repair-requests";
import type { VerifiedTechnicianWithProfile } from "@/lib/services/technicians";
import { cn } from "@/lib/utils";

export interface TechnicianCircuitCardProps {
  activeRepairs: RepairRequestWithEquipment[];
  techProfile: VerifiedTechnicianWithProfile | null;
  className?: string;
  onNavigate?: (url: string) => void;
}

export function TechnicianCircuitCard({
  activeRepairs,
  techProfile,
  className,
  onNavigate,
}: TechnicianCircuitCardProps) {
  // Acknowledge emergency banner state by repair ID to prevent repeated renders
  const [acknowledgedEmergencies, setAcknowledgedEmergencies] = useState<string[]>([]);
  // Secure batch storage for farmer GPS dispatch coordinates keyed by repair_request_id
  const [dispatchLocations, setDispatchLocations] = useState<
    Record<string, RepairDispatchLocation>
  >({});

  // 1. Filter strictly for active DOORSTEP requests
  const eligibleDoorstep = useMemo(() => {
    return (activeRepairs || []).filter((r) => {
      const norm = normalizeRepairDoorstepUrgency(r);
      return (
        norm.service_type === "DOORSTEP" &&
        ["ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED", "IN_PROGRESS", "WAITING_FOR_PARTS"].includes(
          r.status,
        )
      );
    });
  }, [activeRepairs]);

  // Ensure secure farmer GPS dispatch locations are fetched for active doorstep stops
  useEffect(() => {
    let cancelled = false;
    const missingIds = eligibleDoorstep
      .filter((r) => {
        const directLoc = Array.isArray(r.repair_dispatch_locations)
          ? r.repair_dispatch_locations[0]
          : r.repair_dispatch_locations;
        return !directLoc && !dispatchLocations[r.id];
      })
      .map((r) => r.id);

    if (missingIds.length > 0) {
      void getRepairDispatchLocations(missingIds).then((res) => {
        if (!cancelled && Object.keys(res).length > 0) {
          setDispatchLocations((prev) => ({ ...prev, ...res }));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [eligibleDoorstep, dispatchLocations]);

  // 2. Resolve technician workshop depot coordinates
  const depot: GpsPoint & { name: string } = useMemo(() => {
    const lat = techProfile?.workshop_latitude;
    const lng = techProfile?.workshop_longitude;
    const name = techProfile?.workshop_name || "Workshop Depot";

    if (isValidGpsCoordinate(lat, lng)) {
      return { latitude: Number(lat), longitude: Number(lng), name };
    }

    // Centroid fallback via profile village
    const villageCentroid = getNagpurTahsilCentroid(techProfile?.profile?.village);
    if (villageCentroid) {
      return { ...villageCentroid, name };
    }

    // Default Katol Central Depot fallback
    const katolCentroid = NAGPUR_TAHSIL_CENTROIDS["Katol"];
    return {
      latitude: katolCentroid.latitude,
      longitude: katolCentroid.longitude,
      name: `${name} (Nagpur Central Base)`,
    };
  }, [techProfile]);

  // 3. Map repairs to circuit inputs with precise coordinate matching per repair ID
  const stopInputs: CircuitStopInput[] = useMemo(() => {
    return eligibleDoorstep.map((r) => {
      const e = r.equipment;
      const f = r.farmer;
      const norm = normalizeRepairDoorstepUrgency(r);

      // Resolve dispatch location specifically for this repair ID
      const directLoc = Array.isArray(r.repair_dispatch_locations)
        ? r.repair_dispatch_locations[0]
        : r.repair_dispatch_locations;
      const loc = directLoc || dispatchLocations[r.id] || null;

      const hasExactGps = Boolean(loc && isValidGpsCoordinate(loc.latitude, loc.longitude));

      return {
        id: r.id,
        jobNumber: r.job_number || r.id,
        location: r.location,
        village: f?.village || r.location,
        field_landmark: norm.field_landmark,
        urgency_level: norm.urgency_level,
        is_machine_stopped: norm.is_machine_stopped,
        service_type: norm.service_type,
        customerName: f?.full_name || "Farmer",
        equipmentModel: e ? `${e.make} ${e.model || ""}`.trim() : "Equipment",
        status: r.status,
        raw: r,
        latitude: hasExactGps && loc ? Number(loc.latitude) : undefined,
        longitude: hasExactGps && loc ? Number(loc.longitude) : undefined,
        gpsPoint:
          hasExactGps && loc
            ? { latitude: Number(loc.latitude), longitude: Number(loc.longitude) }
            : undefined,
        accuracy: hasExactGps && loc ? loc.accuracy : undefined,
        repair_dispatch_locations: loc || undefined,
      };
    });
  }, [eligibleDoorstep, dispatchLocations]);

  // 4. Calculate optimal circuit itinerary & metrics
  const circuit: CircuitMetricsResult<RepairRequestWithEquipment> = useMemo(() => {
    return calculateCircuitMetrics(depot, stopInputs);
  }, [depot, stopInputs]);

  // 5. Detect active emergency stoppage
  const activeEmergencyStop: OrderedCircuitStop<RepairRequestWithEquipment> | undefined =
    useMemo(() => {
      return circuit.orderedStops.find(
        (s) => s.stop.isEmergency && !acknowledgedEmergencies.includes(s.stop.id),
      );
    }, [circuit.orderedStops, acknowledgedEmergencies]);

  // 6. Calculate detour cost for the active emergency stop if present
  const detourCost = useMemo(() => {
    if (!activeEmergencyStop) return null;
    const otherStops = stopInputs.filter((s) => s.id !== activeEmergencyStop.stop.id);
    if (otherStops.length === 0) return null;
    return calculateDetourCost(depot, otherStops, activeEmergencyStop.stop);
  }, [activeEmergencyStop, depot, stopInputs]);

  // Requirement: Display the circuit ONLY when the technician has at least two active assigned doorstep repairs
  if (eligibleDoorstep.length < 2) {
    return null;
  }

  // 7. Determine Next Stop for primary navigation action (first ordered stop)
  const nextStop = circuit.orderedStops[0];

  const handleNavigate = (stop: OrderedCircuitStop<RepairRequestWithEquipment>) => {
    let targetUrl: string;
    // Exact GPS takes strict precedence over tahsil-centroid fallback.
    // Only generate turn-by-turn directions to exact coordinates when distanceSource is 'exact_gps'.
    if (
      stop.stop.distanceSource === "exact_gps" &&
      stop.stop.gpsPoint &&
      isValidGpsCoordinate(stop.stop.gpsPoint.latitude, stop.stop.gpsPoint.longitude)
    ) {
      targetUrl = buildGoogleMapsDirectionsUrl(
        stop.stop.gpsPoint.latitude,
        stop.stop.gpsPoint.longitude,
      );
    } else {
      // Missing GPS fallback: Search by coarse location text
      const searchTarget =
        stop.stop.location || stop.stop.village || "Nagpur District, Maharashtra";
      targetUrl = buildGoogleMapsSearchUrl(searchTarget);
    }

    if (onNavigate) {
      onNavigate(targetUrl);
    } else if (typeof window !== "undefined") {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleDismissEmergency = (id: string) => {
    setAcknowledgedEmergencies((prev) => [...prev, id]);
  };

  return (
    <Card
      className={cn("overflow-hidden border-2 border-primary/20 bg-card p-0 shadow-sm", className)}
    >
      {/* Emergency Stoppage Notification Banner */}
      {activeEmergencyStop && (
        <div
          data-testid="circuit-urgent-banner"
          className="border-b-2 border-destructive/60 bg-destructive/10 p-4 text-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 font-bold text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Urgent Stoppage Added · Priority Sequence Adjusted
              </p>
              <p className="text-xs text-foreground leading-relaxed">
                <span className="font-semibold text-destructive">
                  {activeEmergencyStop.stop.jobNumber}
                </span>{" "}
                ({activeEmergencyStop.stop.equipmentModel} · {activeEmergencyStop.stop.location})
                reported machine immobilized in field. It has been prioritized as{" "}
                <span className="font-bold underline">Stop #1</span> on your itinerary.
                {detourCost && (
                  <span className="ml-1 text-muted-foreground font-mono">
                    (+{detourCost.additionalDistanceFormatted} detour · +
                    {detourCost.additionalDurationFormatted})
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              data-testid="circuit-dismiss-emergency"
              onClick={() => handleDismissEmergency(activeEmergencyStop.stop.id)}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold hover:bg-muted transition-colors cursor-pointer"
              title="Acknowledge priority adjustment"
            >
              <X className="h-3.5 w-3.5" /> Acknowledge
            </button>
          </div>
        </div>
      )}

      {/* Main Header & Circuit Summary */}
      <div className="border-b border-border bg-muted/30 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                <Navigation className="h-3.5 w-3.5" /> Daily Field Circuit
              </span>
              <span className="text-xs text-muted-foreground">
                {circuit.routingMode === "osrm_driving"
                  ? "OSRM Road Routing"
                  : "Approx. Rural Road (1.3× curvature)"}
              </span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-foreground">Today's Field Itinerary</h2>
            <p className="text-xs text-muted-foreground">Starting from {depot.name}</p>
          </div>

          {/* Quick Metrics Bar */}
          <div className="flex flex-wrap items-center gap-3 text-xs sm:justify-end">
            <div className="rounded-xl border border-border bg-background px-3 py-1.5">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                Total Stops
              </p>
              <p className="text-sm font-bold text-foreground">{circuit.stopCount} visits</p>
            </div>
            <div className="rounded-xl border border-border bg-background px-3 py-1.5">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                Total Circuit
              </p>
              <p className="text-sm font-bold text-foreground">{circuit.totalDistanceFormatted}</p>
            </div>
            <div className="rounded-xl border border-border bg-background px-3 py-1.5">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                Drive Time
              </p>
              <p className="text-sm font-bold text-foreground">~{circuit.totalDurationFormatted}</p>
            </div>
          </div>
        </div>

        {/* Next Stop Action CTA */}
        {nextStop && (
          <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border-2 border-primary bg-primary/5 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> Next Destination
                </p>
                {nextStop.stop.distanceSource === "exact_gps" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                    Exact GPS
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                    Coarse Location Fallback
                  </span>
                )}
              </div>
              <p className="truncate text-sm font-bold text-foreground">
                Stop #1: {nextStop.stop.jobNumber} · {nextStop.stop.customerName}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {nextStop.stop.location}
                {nextStop.stop.raw.field_landmark && ` · "${nextStop.stop.raw.field_landmark}"`}
              </p>
            </div>
            <button
              type="button"
              data-testid="circuit-navigate-next-btn"
              onClick={() => handleNavigate(nextStop)}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
            >
              <Navigation className="h-4 w-4" />
              Navigate to Stop #1
            </button>
          </div>
        )}
      </div>

      {/* Sequential Itinerary Timeline */}
      <div className="p-4 space-y-4" data-testid="circuit-itinerary-timeline">
        {/* Depot Start */}
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="w-0.5 h-10 bg-border my-1" />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Circuit Origin
            </p>
            <p className="font-bold text-sm text-foreground truncate">{depot.name}</p>
            <p className="text-xs text-muted-foreground">Field service van dispatch</p>
          </div>
        </div>

        {/* Ordered Sequential Stops */}
        {circuit.orderedStops.map((orderedStop, idx) => {
          const s = orderedStop.stop;
          const arrivalLeg = circuit.legs[orderedStop.arrivalLegIndex];
          const isNext = idx === 0;

          return (
            <div key={s.id} data-testid={`circuit-stop-item-${idx}`} className="space-y-2">
              {/* Transit Leg Indicator */}
              {arrivalLeg && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground pl-3 py-0.5 font-mono">
                  <div className="w-2 h-2 rounded-full bg-primary/40 ml-0.5" />
                  <span>
                    ↓ {arrivalLeg.distanceFormatted} (~{arrivalLeg.durationFormatted})
                  </span>
                </div>
              )}

              {/* Stop Card */}
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold border",
                      s.isEmergency
                        ? "bg-destructive text-destructive-foreground border-destructive"
                        : isNext
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-foreground border-border",
                    )}
                  >
                    #{orderedStop.sequenceNumber}
                  </div>
                  {idx < circuit.orderedStops.length - 1 && (
                    <div className="w-0.5 h-12 bg-border my-1" />
                  )}
                </div>

                <div
                  className={cn(
                    "flex-1 rounded-xl border p-3 text-sm transition-colors",
                    s.isEmergency
                      ? "border-destructive/60 bg-destructive/5"
                      : isNext
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-card",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/technician/job/$id"
                        params={{ id: s.jobNumber || s.id }}
                        className="font-mono text-xs font-bold text-primary hover:underline"
                      >
                        {s.jobNumber}
                      </Link>
                      <StatusPill
                        r={{ status: s.raw.status, testing: s.raw.is_testing }}
                        audience="staff"
                      />

                      {/* Urgency Badge */}
                      {s.isEmergency ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-bold text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Critical Stoppage
                        </span>
                      ) : s.urgencyLevel === "HIGH" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                          <Clock className="h-3 w-3" /> Urgent (24h)
                        </span>
                      ) : null}

                      {/* Location Accuracy Badge */}
                      {s.distanceSource === "exact_gps" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <MapPin className="h-3 w-3" /> Exact GPS saved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                          <MapPin className="h-3 w-3" /> Coarse area only (no GPS)
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleNavigate(orderedStop)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                      title={
                        s.distanceSource === "exact_gps"
                          ? "Navigate to exact GPS coordinates"
                          : "Search coarse location in Google Maps"
                      }
                    >
                      <Navigation className="h-3.5 w-3.5" /> Navigate
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </button>
                  </div>

                  {/* Farmer & Equipment Info */}
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground text-xs">
                        {s.customerName} · {s.location}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Wrench className="h-3 w-3" /> {s.equipmentModel}
                      </p>
                    </div>
                    <div className="text-right text-xs font-mono text-muted-foreground">
                      <p>Stop #{orderedStop.sequenceNumber}</p>
                      <p>cumul. {orderedStop.cumulativeDistanceFormatted}</p>
                    </div>
                  </div>

                  {/* Landmark Access Note */}
                  {s.raw.field_landmark && (
                    <div className="mt-2 rounded-lg bg-background/80 border border-border p-2 text-xs">
                      <p className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
                        <MapPin className="h-3 w-3 text-primary" /> Landmark / Access:
                      </p>
                      <p className="text-muted-foreground italic text-[11px] mt-0.5">
                        "{s.raw.field_landmark}"
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Final Return to Workshop Base */}
        <div className="flex items-start gap-3 pt-2">
          <div className="flex flex-col items-center">
            {circuit.legs.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1 font-mono">
                <span>↓ {circuit.legs[circuit.legs.length - 1]?.distanceFormatted}</span>
              </div>
            )}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground">
              <RotateCcw className="h-4 w-4" />
            </div>
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Circuit Completion
            </p>
            <p className="font-bold text-sm text-foreground truncate">Return to {depot.name}</p>
            <p className="text-xs text-muted-foreground">
              Full circuit closure · {circuit.totalDistanceFormatted} total transit
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
