import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  CloudOff,
  Loader2,
  MapPin,
  Mic,
  Plus,
  Sparkles,
  Tractor,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { btn, Card, input, Label, useOnline } from "@/components/tb";
import { assess, SYMPTOMS } from "@/lib/assessment";
import { useAuth } from "@/lib/auth";
import {
  formatCoarseLocation,
  formatGpsAccuracy,
  isValidGpsCoordinate,
  NAGPUR_TAHSILS,
} from "@/lib/location";
import { ago } from "@/lib/tb-store";
import { fileToSmallDataUrl } from "@/lib/image";
import { getFarmerEquipment, type EquipmentRow } from "@/lib/services/equipment";
import { createRepairRequest } from "@/lib/services/repair-requests";
import type { Json } from "@/integrations/supabase/types";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/farmer/report-breakdown")({
  validateSearch: (s: Record<string, unknown>): { equipment?: string | undefined } => ({
    equipment: typeof s["equipment"] === "string" ? (s["equipment"] as string) : undefined,
  }),
  head: () => meta("Report breakdown", "Report a machine breakdown in under two minutes."),
  component: Report,
});

const DRAFT = "terrabyte-breakdown-draft";
type Draft = {
  step: number;
  equipmentId: string;
  symptoms: string[];
  description: string;
  photos: string[];
  village: string;
  tahsil: string;
};

function Report() {
  const nav = useNavigate();
  const online = useOnline();
  const { profile } = useAuth();
  const { equipment: pre } = Route.useSearch();

  const [eq, setEq] = useState<EquipmentRow[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  const [d, setD] = useState<Draft>({
    step: pre ? 2 : 1,
    equipmentId: pre ?? "",
    symptoms: [],
    description: "",
    photos: [],
    village: "",
    tahsil: "",
  });
  const [restored, setRestored] = useState(false);
  const [listening, setListening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);

  // In-memory one-time GPS capture (Never persisted to localStorage)
  interface CapturedGps {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    capturedAt: string;
  }
  const [gps, setGps] = useState<CapturedGps | null>(null);
  const [gpsState, setGpsState] = useState<
    "idle" | "requesting" | "captured" | "error" | "unsupported"
  >("idle");
  const [gpsError, setGpsError] = useState<string | null>(null);

  const requestLocation = () => {
    if (typeof window === "undefined" || !navigator?.geolocation) {
      setGpsState("unsupported");
      setGpsError(
        "Browser geolocation is not supported on this device. You can continue with village and tahsil manually.",
      );
      return;
    }

    setGpsState("requesting");
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (!isValidGpsCoordinate(latitude, longitude)) {
          setGpsState("error");
          setGpsError(
            "Received invalid coordinates from device. Please enter village and tahsil manually.",
          );
          return;
        }
        setGps({
          latitude,
          longitude,
          accuracy: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null,
          capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
        });
        setGpsState("captured");
        setGpsError(null);
        toast.success("Current location captured.");
      },
      (err) => {
        setGpsState("error");
        if (err.code === 1) {
          setGpsError(
            "Location permission was denied. You can continue with village and tahsil, or allow location access in your browser settings.",
          );
        } else if (err.code === 2) {
          setGpsError(
            "GPS position unavailable. Please ensure device location is enabled, or continue with village and tahsil.",
          );
        } else if (err.code === 3) {
          setGpsError(
            "Location request timed out. You can retry or continue with village and tahsil.",
          );
        } else {
          setGpsError(err.message || "Failed to capture location.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      },
    );
  };

  const clearGps = () => {
    setGps(null);
    setGpsState("idle");
    setGpsError(null);
  };

  useEffect(() => {
    let mounted = true;
    getFarmerEquipment()
      .then((data) => {
        if (!mounted) return;
        setEq(data);
        if (pre) {
          const match = data.find((e) => e.id === pre);
          if (match && match.status !== "In Repair") {
            setD((prev) => ({ ...prev, equipmentId: pre, step: 2 }));
          }
        }
      })
      .catch((err: any) => {
        if (!mounted) return;
        console.error("Failed to load equipment:", err);
        setEquipmentError(err?.message || "Failed to load equipment");
      })
      .finally(() => {
        if (mounted) setLoadingEquipment(false);
      });
    return () => {
      mounted = false;
    };
  }, [pre]);

  useEffect(() => {
    const raw = localStorage.getItem(DRAFT);
    if (raw && !pre) {
      try {
        const x = JSON.parse(raw) as Partial<Draft>;
        if (
          x.equipmentId ||
          (Array.isArray(x.symptoms) && x.symptoms.length > 0) ||
          x.village ||
          x.tahsil ||
          x.description
        ) {
          setD((prev) => ({
            ...prev,
            step: typeof x.step === "number" ? x.step : prev.step,
            equipmentId: typeof x.equipmentId === "string" ? x.equipmentId : prev.equipmentId,
            symptoms: Array.isArray(x.symptoms) ? x.symptoms : prev.symptoms,
            description: typeof x.description === "string" ? x.description : prev.description,
            photos: Array.isArray(x.photos) ? x.photos : prev.photos,
            village: typeof x.village === "string" ? x.village : prev.village,
            tahsil: typeof x.tahsil === "string" ? x.tahsil : prev.tahsil,
          }));
          setRestored(true);
        }
      } catch {
        /* ignore parse error */
      }
    }
  }, [pre]);

  // Prefill village from farmer profile only when available (do not infer tahsil)
  useEffect(() => {
    if (profile?.village && !d.village) {
      const raw = localStorage.getItem(DRAFT);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed.village === "string" && parsed.village.length > 0) {
            return;
          }
        } catch (_err) {
          /* ignore parse error */
        }
      }
      setD((prev) => ({
        ...prev,
        village: prev.village || profile.village?.trim() || "",
      }));
    }
  }, [profile?.village, d.village]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT, JSON.stringify(d));
    } catch {
      /* ignore storage quota error */
    }
  }, [d]);

  // Clean up any stale draft equipment ID (e.g. legacy demo IDs like "e1")
  useEffect(() => {
    if (eq.length > 0 && d.equipmentId) {
      const exists = eq.some((e) => e.id === d.equipmentId);
      if (!exists) {
        setD((prev) => ({ ...prev, equipmentId: "" }));
      }
    }
  }, [eq, d.equipmentId]);

  const busy = new Set(eq.filter((e) => e.status === "In Repair").map((e) => e.id));
  const selectedEquipment = eq.find((e) => e.id === d.equipmentId);

  const up = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const toggle = (sym: string) =>
    up({
      symptoms: d.symptoms.includes(sym)
        ? d.symptoms.filter((x) => x !== sym)
        : [...d.symptoms, sym],
    });

  const voice = () => {
    const W = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const SR = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!SR) {
      toast("Voice typing isn't supported on this browser — use your keyboard's mic button.");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.onresult = (e: any) =>
      up({ description: (d.description + " " + e.results[0][0].transcript).trim() });
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const submit = async () => {
    if (submitting) return;

    if (!d.equipmentId) {
      toast.error("Please select a machine first.");
      up({ step: 1 });
      return;
    }

    if (d.symptoms.length === 0) {
      toast.error("Please select at least one symptom.");
      up({ step: 2 });
      return;
    }

    const machine = eq.find((x) => x.id === d.equipmentId);
    if (!machine) {
      toast.error("Selected equipment could not be found. Please select your machine.");
      up({ step: 1 });
      return;
    }

    if (machine.status === "In Repair") {
      toast.error(`${machine.make} ${machine.model} is already marked as 'In Repair'.`);
      up({ step: 1 });
      return;
    }

    setSubmitting(true);
    try {
      const assessment = assess(d.symptoms, d.description.trim());
      const repair = await createRepairRequest({
        equipment_id: machine.id,
        symptoms: d.symptoms,
        description: d.description.trim().slice(0, 1000),
        photos: d.photos.filter(Boolean),
        location:
          formatCoarseLocation(d.village, d.tahsil) ||
          profile?.village?.trim() ||
          "On-site / Field",
        assessment: assessment as unknown as Json,
        ...(gps
          ? {
              gpsLocation: {
                latitude: gps.latitude,
                longitude: gps.longitude,
                accuracy: gps.accuracy,
                captured_at: gps.capturedAt,
              },
            }
          : {}),
      });

      localStorage.removeItem(DRAFT);
      toast.success(`Breakdown reported successfully (${repair.job_number}).`);

      nav({
        to: "/farmer/repair/$id",
        params: { id: repair.job_number || repair.id },
      });
    } catch (err: any) {
      console.error("Failed to create repair request:", err);
      toast.error(err?.message || "Failed to create repair request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const canNext = [
    Boolean(d.equipmentId && !busy.has(d.equipmentId)),
    d.symptoms.length > 0,
    true,
    true,
  ][d.step - 1];

  const titles = [
    "Which machine broke down?",
    "What's happening?",
    "Describe it in your words",
    "Add a photo or video",
    "Ready for assessment",
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          aria-label={
            d.step > 1 ? "Previous step" : pre ? "Back to machine record" : "Back to home"
          }
          disabled={submitting}
          onClick={() => {
            if (d.step > 1) {
              up({ step: d.step - 1 });
            } else if (pre) {
              nav({ to: `/farmer/equipment/${pre}` as any });
            } else {
              nav({ to: "/farmer" });
            }
          }}
          className="grid h-11 w-11 place-items-center rounded-xl border-2 border-border disabled:opacity-50"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 gap-1.5">
          {[1, 2, 3, 4, 5].map((k) => (
            <span
              key={k}
              className={cn(
                "h-2 flex-1 rounded-full",
                k <= d.step ? "bg-destructive" : "bg-border",
              )}
            />
          ))}
        </div>
        <span className="font-mono text-sm">{d.step}/5</span>
      </div>

      {restored && (
        <p className="flex items-center gap-2 rounded-xl bg-info/10 p-3 text-sm">
          <CloudOff className="h-4 w-4" /> We restored your unfinished report.{" "}
          <button
            className="ml-auto font-semibold underline"
            onClick={() => {
              setD({
                step: 1,
                equipmentId: "",
                symptoms: [],
                description: "",
                photos: [],
                village: profile?.village?.trim() || "",
                tahsil: "",
              });
              clearGps();
              setRestored(false);
            }}
          >
            Start over
          </button>
        </p>
      )}

      <h1 className="text-3xl font-bold">{titles[d.step - 1]}</h1>

      {d.step === 1 && (
        <div className="space-y-2">
          {loadingEquipment ? (
            <div className="py-12 text-center text-muted-foreground">Loading your equipment…</div>
          ) : equipmentError ? (
            <Card className="text-destructive">
              <p>Failed to load equipment: {equipmentError}</p>
            </Card>
          ) : eq.length === 0 ? (
            <Card className="py-8 text-center text-muted-foreground">
              <Tractor className="mx-auto mb-2 h-10 w-10 opacity-40" />
              <p className="font-semibold text-foreground">No equipment registered yet</p>
              <p className="mt-1 text-sm">
                You must register at least one machine before reporting a breakdown.
              </p>
              <Link
                to="/farmer/equipment"
                className={cn(btn.primary, "mt-4 inline-flex items-center gap-2")}
              >
                <Plus className="h-4 w-4" /> Register machine
              </Link>
            </Card>
          ) : (
            eq.map((e) => {
              const dis = busy.has(e.id);
              return (
                <button
                  key={e.id}
                  disabled={dis}
                  onClick={() => up({ equipmentId: e.id, step: 2 })}
                  className={cn(
                    "flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left disabled:opacity-50",
                    d.equipmentId === e.id
                      ? "border-destructive bg-destructive/5"
                      : "border-border bg-card",
                  )}
                >
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-muted">
                    <Tractor className="h-7 w-7" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-lg font-semibold">
                      {e.make} {e.model}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {dis
                        ? "Already in repair"
                        : `${e.type} · ${(e.operating_hours ?? 0).toLocaleString("en-IN")} hrs`}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {d.step === 2 && (
        <div className="grid grid-cols-2 gap-2">
          {SYMPTOMS.map((sym) => (
            <button
              key={sym}
              onClick={() => toggle(sym)}
              className={cn(
                "min-h-16 rounded-2xl border-2 p-3 text-left font-semibold",
                d.symptoms.includes(sym)
                  ? "border-destructive bg-destructive text-destructive-foreground"
                  : "border-border bg-card",
              )}
            >
              {sym}
            </button>
          ))}
        </div>
      )}

      {d.step === 3 && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-2xl border-2 border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <h2 className="text-base font-bold text-foreground">Breakdown Location</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Provide your village and tahsil so the nearest technician can find you.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Village / Locality</Label>
                <input
                  type="text"
                  className={input}
                  placeholder="e.g. Dorli, Mohpa"
                  value={d.village}
                  onChange={(e) => up({ village: e.target.value })}
                />
              </div>
              <div>
                <Label>Tahsil (Nagpur District)</Label>
                <select
                  className={cn(input, "cursor-pointer bg-background")}
                  value={d.tahsil}
                  onChange={(e) => up({ tahsil: e.target.value })}
                >
                  <option value="">Select Tahsil...</option>
                  {NAGPUR_TAHSILS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* One-time Browser Geolocation Capture */}
            <div className="pt-2 border-t border-border/60">
              {gpsState === "idle" && (
                <button
                  type="button"
                  onClick={requestLocation}
                  className={cn(btn.ghost, "w-full flex items-center justify-center gap-2 text-sm")}
                >
                  <MapPin className="h-4 w-4 text-primary" /> Use my current location (GPS)
                </button>
              )}

              {gpsState === "requesting" && (
                <button
                  type="button"
                  disabled
                  className={cn(
                    btn.ghost,
                    "w-full flex items-center justify-center gap-2 text-sm opacity-70",
                  )}
                >
                  <Loader2 className="h-4 w-4 animate-spin text-primary" /> Acquiring GPS location…
                </button>
              )}

              {gpsState === "captured" && gps && (
                <div className="rounded-xl bg-success/10 border border-success/30 p-3 text-sm flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-success flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 shrink-0" /> Exact GPS Attached
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatGpsAccuracy(gps.accuracy)
                        ? `${formatGpsAccuracy(gps.accuracy)} accuracy · `
                        : ""}
                      captured {ago(new Date(gps.capturedAt).getTime())} ago
                    </p>
                    <p className="text-[11px] text-muted-foreground/80 italic">
                      Private: Accessible strictly by you, your assigned technician, and Service
                      Centre.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearGps}
                    className="text-xs text-muted-foreground hover:text-destructive underline shrink-0"
                  >
                    Remove
                  </button>
                </div>
              )}

              {(gpsState === "error" || gpsState === "unsupported") && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive space-y-1.5">
                  <p className="font-medium leading-relaxed">{gpsError}</p>
                  <div className="flex gap-2">
                    {gpsState === "error" && (
                      <button
                        type="button"
                        onClick={requestLocation}
                        className="font-semibold underline text-foreground"
                      >
                        Retry GPS
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={clearGps}
                      className="text-muted-foreground hover:text-foreground underline ml-auto"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Problem Description</Label>
            <textarea
              rows={5}
              maxLength={1000}
              className={input}
              placeholder='e.g. "Tractor lost pulling power in field, heavy black smoke from exhaust and engine sputtering under load"'
              value={d.description}
              onChange={(e) => up({ description: e.target.value })}
            />
            <button onClick={voice} className={cn(listening ? btn.urgent : btn.ghost, "w-full")}>
              <Mic className="h-5 w-5" />
              {listening ? "Listening… tap to stop" : "Speak instead of typing"}
            </button>
            <p className="text-sm text-muted-foreground">
              Optional, but it helps the technician come prepared.
            </p>
          </div>
        </div>
      )}

      {d.step === 4 && (
        <div className="space-y-3">
          <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card text-center">
            <Camera className="h-10 w-10 text-muted-foreground" />
            <span className="font-semibold">Take photo / video</span>
            <span className="text-xs text-muted-foreground">
              Photos are compressed for slow networks
            </span>
            <input
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const url = await fileToSmallDataUrl(f);
                if (!url) toast("Video noted — in this demo only photos are stored.");
                else up({ photos: [...d.photos, url].slice(0, 4) });
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {d.photos.map((p, i) => (
              <div key={i} className="relative">
                <img src={p} alt="" className="h-24 w-24 rounded-xl object-cover" />
                <button
                  aria-label="Remove"
                  onClick={() => up({ photos: d.photos.filter((_, k) => k !== i) })}
                  className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-foreground text-background"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {d.step === 5 && (
        <Card className="space-y-2">
          <p>
            <b>Machine:</b>{" "}
            {selectedEquipment ? `${selectedEquipment.make} ${selectedEquipment.model}` : "—"}
          </p>
          <p>
            <b>Symptoms:</b> {d.symptoms.join(", ")}
          </p>
          <p>
            <b>Location:</b> {formatCoarseLocation(d.village, d.tahsil) || "On-site / Field"}
            {gps ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
                <MapPin className="h-3 w-3" /> Exact GPS attached ({formatGpsAccuracy(gps.accuracy)}
                )
              </span>
            ) : null}
          </p>
          {d.description && (
            <p>
              <b>Description:</b> {d.description}
            </p>
          )}
          <p>
            <b>Photos:</b> {d.photos.length}
          </p>
        </Card>
      )}

      <div className="sticky bottom-4">
        {d.step < 5 ? (
          <button
            disabled={!canNext}
            onClick={() => up({ step: d.step + 1 })}
            className={cn(btn.primary, "h-14 w-full text-lg")}
          >
            {d.step === 3 || d.step === 4 ? "Continue" : "Next"} <ArrowRight className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            className={cn(
              btn.urgent,
              "w-full flex items-center justify-center gap-2 disabled:opacity-50",
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Submitting breakdown report…</span>
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                <span>Start preliminary assessment</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
