import { useState, useRef, useEffect } from "react";
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  MapPin,
  Sparkles,
  Info,
  X,
} from "lucide-react";
import { type VisualAnomaly, type DefectSeverity } from "@/lib/types/visual-diagnostics";
import { cn } from "@/lib/utils";

export interface UserPin {
  id: string;
  photoIndex: number;
  xPercent: number; // 0 - 100
  yPercent: number; // 0 - 100
  label: string;
  createdAt: string;
}

export interface DefectAnnotationCanvasProps {
  photos: string[];
  anomalies?: VisualAnomaly[];
  selectedAnomalyIndex?: number | null;
  onSelectAnomaly?: (index: number | null) => void;
  allowUserPins?: boolean;
  className?: string;
}

/**
 * Deterministically computes representative pin coordinates for an anomaly
 * based on its system category and index.
 */
function getDeterministicAnomalyCoordinates(
  system: string,
  index: number,
  total: number,
): { xPercent: number; yPercent: number } {
  const sys = system.toLowerCase();

  // Region-based anchor points on typical tractor/implement breakdown photos
  let baseX = 50;
  let baseY = 50;

  if (sys.includes("engine") || sys.includes("cylinder") || sys.includes("head")) {
    baseX = 42;
    baseY = 38;
  } else if (sys.includes("fuel") || sys.includes("injector") || sys.includes("pump")) {
    baseX = 35;
    baseY = 48;
  } else if (sys.includes("cool") || sys.includes("radiator")) {
    baseX = 28;
    baseY = 32;
  } else if (sys.includes("hydraul") || sys.includes("lift")) {
    baseX = 68;
    baseY = 62;
  } else if (sys.includes("electr") || sys.includes("battery") || sys.includes("starter")) {
    baseX = 48;
    baseY = 58;
  } else if (sys.includes("trans") || sys.includes("clutch") || sys.includes("gear")) {
    baseX = 55;
    baseY = 52;
  } else if (sys.includes("steer") || sys.includes("brake") || sys.includes("chassis")) {
    baseX = 30;
    baseY = 70;
  }

  // Offset slightly if multiple anomalies land in the same quadrant
  const offsetRadius = 8 + (index % 3) * 6;
  const angle = (index * 2 * Math.PI) / Math.max(total, 1) + Math.PI / 4;
  const x = Math.min(88, Math.max(12, baseX + Math.cos(angle) * offsetRadius));
  const y = Math.min(88, Math.max(12, baseY + Math.sin(angle) * offsetRadius));

  return {
    xPercent: Math.round(x),
    yPercent: Math.round(y),
  };
}

function getSeverityColor(sev: DefectSeverity): {
  bg: string;
  border: string;
  ring: string;
  text: string;
} {
  switch (sev) {
    case "CRITICAL":
      return {
        bg: "bg-destructive text-destructive-foreground",
        border: "border-destructive",
        ring: "ring-destructive/40",
        text: "text-destructive",
      };
    case "HIGH":
      return {
        bg: "bg-amber-500 text-white",
        border: "border-amber-500",
        ring: "ring-amber-500/40",
        text: "text-amber-500",
      };
    case "MEDIUM":
      return {
        bg: "bg-info text-info-foreground",
        border: "border-info",
        ring: "ring-info/40",
        text: "text-info",
      };
    case "LOW":
    default:
      return {
        bg: "bg-muted-foreground text-background",
        border: "border-muted-foreground",
        ring: "ring-muted-foreground/30",
        text: "text-muted-foreground",
      };
  }
}

export function DefectAnnotationCanvas({
  photos,
  anomalies = [],
  selectedAnomalyIndex = null,
  onSelectAnomaly,
  allowUserPins = true,
  className,
}: DefectAnnotationCanvasProps) {
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [userPins, setUserPins] = useState<UserPin[]>([]);
  const [activePinPopup, setActivePinPopup] = useState<number | null>(null);
  const [showAddPinDialog, setShowAddPinDialog] = useState(false);
  const [pendingPinCoords, setPendingPinCoords] = useState<{ x: number; y: number } | null>(null);
  const [pinLabelInput, setPinLabelInput] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync active popup with external selected anomaly
  useEffect(() => {
    if (selectedAnomalyIndex !== null && selectedAnomalyIndex !== undefined) {
      setActivePinPopup(selectedAnomalyIndex);
    }
  }, [selectedAnomalyIndex]);

  if (!photos || photos.length === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/20 text-center p-4">
        <Camera className="h-10 w-10 text-muted-foreground/40 mb-2" />
        <p className="font-semibold text-foreground">No inspection photos available</p>
        <p className="text-xs text-muted-foreground max-w-sm mt-1">
          Machine breakdown was reported without attached photos. Visual defect annotation requires
          at least one uploaded photograph.
        </p>
      </div>
    );
  }

  const currentPhoto = photos[activePhotoIndex] || photos[0];

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!allowUserPins || !containerRef.current) return;

    // Check if clicked directly on an existing button/marker
    const target = e.target as HTMLElement;
    if (target.closest("[data-marker]")) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const clampedX = Math.max(5, Math.min(95, Math.round(x)));
    const clampedY = Math.max(5, Math.min(95, Math.round(y)));

    setPendingPinCoords({ x: clampedX, y: clampedY });
    setShowAddPinDialog(true);
  };

  const handleAddPin = () => {
    if (!pendingPinCoords || !pinLabelInput.trim()) return;

    const newPin: UserPin = {
      id: `pin-${Date.now()}`,
      photoIndex: activePhotoIndex,
      xPercent: pendingPinCoords.x,
      yPercent: pendingPinCoords.y,
      label: pinLabelInput.trim().slice(0, 80),
      createdAt: new Date().toISOString(),
    };

    setUserPins((prev) => [...prev, newPin]);
    setShowAddPinDialog(false);
    setPinLabelInput("");
    setPendingPinCoords(null);
  };

  const handleRemovePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setUserPins((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Photo Selector Tabs & Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {photos.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setActivePhotoIndex(idx);
                setActivePinPopup(null);
                if (onSelectAnomaly) onSelectAnomaly(null);
              }}
              className={cn(
                "group relative flex items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-xs font-semibold transition-all",
                activePhotoIndex === idx
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-foreground/30",
              )}
            >
              <img
                src={p}
                alt=""
                className="h-5 w-5 rounded-md object-cover border border-border"
              />
              <span>Photo {idx + 1}</span>
              {activePhotoIndex === idx && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
          {allowUserPins && (
            <span className="hidden sm:inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-primary" /> Tap photo to add note
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            aria-label="Toggle Fullscreen Lightbox"
            className="flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Inspect</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Canvas Container */}
      <div
        ref={containerRef}
        onClick={handleCanvasClick}
        className={cn(
          "relative overflow-hidden rounded-2xl border-2 border-border bg-black/95 select-none touch-manipulation transition-all",
          isFullscreen
            ? "fixed inset-0 z-50 rounded-none border-none flex items-center justify-center bg-black/95 p-4"
            : "w-full aspect-[4/3] sm:aspect-[16/10] max-h-[520px]",
        )}
      >
        {/* Fullscreen Close Button */}
        {isFullscreen && (
          <button
            type="button"
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 z-50 grid h-10 w-10 place-items-center rounded-full bg-foreground text-background hover:opacity-90 shadow-lg"
          >
            <X className="h-5 w-5" />
          </button>
        )}

        {/* Machinery Photo */}
        <img
          src={currentPhoto}
          alt={`Machinery breakdown inspection view ${activePhotoIndex + 1}`}
          className={cn(
            "h-full w-full object-contain pointer-events-none",
            isFullscreen && "max-h-[90vh] max-w-[90vw]",
          )}
        />

        {/* Defect Markers Overlay Layer (Only on Photo 1 or photo matching anomaly) */}
        {activePhotoIndex === 0 &&
          anomalies.map((anomaly, idx) => {
            const { xPercent, yPercent } = getDeterministicAnomalyCoordinates(
              anomaly.system,
              idx,
              anomalies.length,
            );
            const isSelected = selectedAnomalyIndex === idx || activePinPopup === idx;
            const sevColor = getSeverityColor(anomaly.severity);

            return (
              <div
                key={`anomaly-pin-${idx}`}
                data-marker="anomaly"
                style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 z-20"
              >
                {/* Marker Pin Button */}
                <button
                  type="button"
                  aria-label={`Defect ${idx + 1}: ${anomaly.system} (${anomaly.severity})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const newIdx = isSelected ? null : idx;
                    setActivePinPopup(newIdx);
                    if (onSelectAnomaly) onSelectAnomaly(newIdx);
                  }}
                  className={cn(
                    "group relative flex items-center justify-center rounded-full font-mono text-xs font-bold shadow-md transition-all",
                    isSelected
                      ? cn("h-9 w-9 ring-4 scale-110", sevColor.bg, sevColor.ring)
                      : cn("h-7 w-7 border-2 border-white/90 hover:scale-105", sevColor.bg),
                  )}
                >
                  <span className="text-[11px] font-black">{idx + 1}</span>

                  {/* Pulsing halo for critical or selected defects */}
                  {(isSelected || anomaly.severity === "CRITICAL") && (
                    <span
                      className={cn(
                        "absolute -inset-1 rounded-full animate-ping opacity-60 pointer-events-none",
                        sevColor.bg,
                      )}
                    />
                  )}
                </button>

                {/* Popover Callout on Selection */}
                {isSelected && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 z-30 w-64 sm:w-72 rounded-2xl border-2 border-border bg-card p-3.5 shadow-xl text-foreground text-left animate-in fade-in zoom-in-95 duration-150"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                            sevColor.bg,
                          )}
                        >
                          {anomaly.severity}
                        </span>
                        <span className="font-semibold text-xs text-muted-foreground">
                          {anomaly.system}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActivePinPopup(null);
                          if (onSelectAnomaly) onSelectAnomaly(null);
                        }}
                        className="rounded-lg p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <h4 className="mt-1.5 text-sm font-bold leading-snug">{anomaly.defectType}</h4>

                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-3">
                      {anomaly.observation}
                    </p>

                    {anomaly.recommendation && (
                      <div className="mt-2 rounded-xl bg-muted/60 p-2 text-[11px] leading-tight text-foreground">
                        <span className="font-semibold text-primary">Advice:</span>{" "}
                        {anomaly.recommendation}
                      </div>
                    )}

                    {/* Speech bubble pointer arrow */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-card" />
                  </div>
                )}
              </div>
            );
          })}

        {/* User-dropped Inspection Pins */}
        {userPins
          .filter((p) => p.photoIndex === activePhotoIndex)
          .map((pin) => (
            <div
              key={pin.id}
              data-marker="user-pin"
              style={{ left: `${pin.xPercent}%`, top: `${pin.yPercent}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-20 group"
            >
              <div className="relative flex items-center justify-center">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-white">
                  <MapPin className="h-4 w-4" />
                </span>

                {/* Pin hover tooltip */}
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1 text-xs shadow-lg whitespace-nowrap z-30">
                  <span className="font-medium text-foreground">{pin.label}</span>
                  <button
                    type="button"
                    onClick={(e) => handleRemovePin(pin.id, e)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}

        {/* Photo Navigation Overlay Arrows */}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous Photo"
              onClick={(e) => {
                e.stopPropagation();
                setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
                setActivePinPopup(null);
                if (onSelectAnomaly) onSelectAnomaly(null);
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition-opacity"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next Photo"
              onClick={(e) => {
                e.stopPropagation();
                setActivePhotoIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
                setActivePinPopup(null);
                if (onSelectAnomaly) onSelectAnomaly(null);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition-opacity"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Legend Overlay at bottom */}
        <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/75 px-3 py-1.5 text-[11px] text-white/90 backdrop-blur-sm pointer-events-none">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Visual Inspection Canvas
            </span>
            {anomalies.length > 0 && activePhotoIndex === 0 && (
              <span className="hidden sm:inline text-white/70">
                {anomalies.length} anomaly marker{anomalies.length > 1 ? "s" : ""} detected
              </span>
            )}
          </div>
          <span className="text-white/60">
            {activePhotoIndex + 1} of {photos.length}
          </span>
        </div>
      </div>

      {/* Manual Pin Adding Modal */}
      {showAddPinDialog && pendingPinCoords && (
        <div className="rounded-xl border-2 border-border bg-card p-3 shadow-md flex flex-wrap items-center gap-2 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <MapPin className="h-4 w-4 text-primary" />
            <span>
              Mark spot at ({pendingPinCoords.x}%, {pendingPinCoords.y}%):
            </span>
          </div>
          <input
            type="text"
            placeholder="e.g. Oil seep, crack near bracket"
            value={pinLabelInput}
            onChange={(e) => setPinLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddPin();
              if (e.key === "Escape") setShowAddPinDialog(false);
            }}
            autoFocus
            className="flex-1 min-w-[160px] rounded-lg border border-border bg-background px-2.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={handleAddPin}
            disabled={!pinLabelInput.trim()}
            className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            Save Pin
          </button>
          <button
            type="button"
            onClick={() => setShowAddPinDialog(false)}
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
