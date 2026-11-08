import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  CloudOff,
  Loader2,
  MapPin,
  Mic,
  Plus,
  Sparkles,
  Tractor,
  Wrench,
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
import { submitWorkshopDropoffRepair } from "@/lib/services/facility-capacity";
import {
  getDropOffApprovedFacilities,
  type DropOffFacilityOption,
} from "@/lib/services/facilities";
import type { Json } from "@/integrations/supabase/types";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

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
  aiConsent?: boolean;
  isImmobile?: boolean;
  deliveryMode?: "DOORSTEP" | "WORKSHOP_DROPOFF";
  facilityId?: string;
};

function Report() {
  const nav = useNavigate();
  const online = useOnline();
  const { profile } = useAuth();
  const { t, language } = useTranslation();
  const { equipment: pre } = Route.useSearch();

  const [eq, setEq] = useState<EquipmentRow[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  const [workshops, setWorkshops] = useState<DropOffFacilityOption[]>([]);
  const [loadingWorkshops, setLoadingWorkshops] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoadingWorkshops(true);
    getDropOffApprovedFacilities()
      .then((data) => {
        if (!mounted) return;
        setWorkshops(data);
      })
      .catch((err) => {
        console.warn("[TerraByte] Could not load drop-off facilities:", err);
      })
      .finally(() => {
        if (mounted) setLoadingWorkshops(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const [d, setD] = useState<Draft>({
    step: pre ? 2 : 1,
    equipmentId: pre ?? "",
    symptoms: [],
    description: "",
    photos: [],
    village: "",
    tahsil: "",
    aiConsent: true,
    isImmobile: false,
    deliveryMode: "DOORSTEP",
    facilityId: "",
  });
  const [restored, setRestored] = useState(false);
  const [listening, setListening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);

  const toggleMobility = (immobile: boolean) => {
    if (immobile) {
      up({ isImmobile: true, deliveryMode: "DOORSTEP", facilityId: "" });
    } else {
      up({ isImmobile: false, deliveryMode: undefined, facilityId: "" });
    }
  };

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
      .catch((err: unknown) => {
        if (!mounted) return;
        console.error("Failed to load equipment:", err);
        const msg = err instanceof Error ? err.message : "Failed to load equipment";
        setEquipmentError(msg);
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
          x.description ||
          x.isImmobile !== undefined ||
          x.deliveryMode !== undefined
        ) {
          const isImmobile = typeof x.isImmobile === "boolean" ? x.isImmobile : false;
          setD((prev) => ({
            ...prev,
            step: typeof x.step === "number" ? x.step : prev.step,
            equipmentId: typeof x.equipmentId === "string" ? x.equipmentId : prev.equipmentId,
            symptoms: Array.isArray(x.symptoms) ? x.symptoms : prev.symptoms,
            description: typeof x.description === "string" ? x.description : prev.description,
            photos: Array.isArray(x.photos) ? x.photos : prev.photos,
            village: typeof x.village === "string" ? x.village : prev.village,
            tahsil: typeof x.tahsil === "string" ? x.tahsil : prev.tahsil,
            isImmobile,
            deliveryMode: isImmobile
              ? "DOORSTEP"
              : x.deliveryMode === "WORKSHOP_DROPOFF"
                ? "WORKSHOP_DROPOFF"
                : "DOORSTEP",
            facilityId: typeof x.facilityId === "string" ? x.facilityId : "",
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
    interface SpeechRecognitionInstance {
      lang: string;
      interimResults: boolean;
      onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    }
    const W = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
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
    rec.lang = language === "mr" ? "mr-IN" : language === "hi" ? "hi-IN" : "en-IN";
    rec.interimResults = false;
    rec.onresult = (e: { results: { 0: { 0: { transcript: string } } } }) =>
      up({ description: (d.description + " " + e.results[0][0].transcript).trim() });
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const submit = async () => {
    if (submitting) return;

    if (!d.equipmentId) {
      toast.error(t("breakdown.validationEquipment"));
      up({ step: 1 });
      return;
    }

    if (d.symptoms.length === 0) {
      toast.error(t("breakdown.validationSymptoms"));
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

    if (!d.isImmobile && !d.deliveryMode) {
      toast.error(t("breakdown.validationDeliveryMode"));
      up({ step: 3 });
      return;
    }

    if (d.deliveryMode === "WORKSHOP_DROPOFF") {
      if (d.isImmobile) {
        toast.error(t("breakdown.immobileWarning"));
        up({ deliveryMode: "DOORSTEP", step: 3 });
        return;
      }
      if (!d.facilityId) {
        toast.error(t("breakdown.validationWorkshop"));
        up({ step: 3 });
        return;
      }
    }

    setSubmitting(true);
    try {
      const assessment = assess(d.symptoms, d.description.trim());
      const effectiveMode = d.isImmobile ? "DOORSTEP" : d.deliveryMode;
      const effectiveFacilityId =
        !d.isImmobile && effectiveMode === "WORKSHOP_DROPOFF" ? d.facilityId : null;
      const coarseLoc =
        formatCoarseLocation(d.village, d.tahsil) || profile?.village?.trim() || "On-site / Field";

      let createdTicket: { id: string; job_number?: string };

      if (effectiveMode === "WORKSHOP_DROPOFF" && effectiveFacilityId) {
        // Atomic M4 Workshop Drop-Off & Bay Reservation Transaction
        const res = await submitWorkshopDropoffRepair({
          equipment_id: machine.id,
          facility_id: effectiveFacilityId,
          symptoms: d.symptoms,
          description: d.description.trim().slice(0, 1000),
          location: coarseLoc,
          photos: d.photos.filter(Boolean),
          assessment,
          ...(gps
            ? {
                gpsLocation: {
                  latitude: gps.latitude,
                  longitude: gps.longitude,
                  accuracy: gps.accuracy,
                },
              }
            : {}),
        });
        createdTicket = { id: res.id, job_number: res.job_number };
      } else {
        // Standard M3 Doorstep Workflow
        createdTicket = await createRepairRequest({
          equipment_id: machine.id,
          symptoms: d.symptoms,
          description: d.description.trim().slice(0, 1000),
          photos: d.photos.filter(Boolean),
          location: coarseLoc,
          assessment: assessment as unknown as Json,
          delivery_mode: "DOORSTEP",
          is_immobile: Boolean(d.isImmobile),
          facility_id: null,
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
      }

      localStorage.removeItem(DRAFT);
      toast.success(
        `${t("breakdown.successToast")} (${createdTicket.job_number || createdTicket.id})`,
      );

      nav({
        to: "/farmer/repair/$id",
        params: { id: createdTicket.job_number || createdTicket.id },
      });
    } catch (err: unknown) {
      console.error("Failed to create repair request:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || "Failed to create repair request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedWorkshop = workshops.find((w) => w.id === d.facilityId);

  const canNext = [
    Boolean(d.equipmentId && !busy.has(d.equipmentId)),
    d.symptoms.length > 0,
    d.isImmobile
      ? true
      : d.deliveryMode === "WORKSHOP_DROPOFF"
        ? Boolean(d.facilityId)
        : d.deliveryMode === "DOORSTEP",
    true,
    true,
  ][d.step - 1];

  const titles = [
    t("breakdown.step1Desc"),
    t("breakdown.step2Title"),
    t("breakdown.step4Title"),
    t("breakdown.step3Title"),
    t("breakdown.title"),
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
              nav({ to: "/farmer/equipment/$id", params: { id: pre } });
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
                        ? t("common.underRepair")
                        : `${t(`equipmentTypes.${e.type}`, e.type)} · ${(e.operating_hours ?? 0).toLocaleString("en-IN")} ${t("common.hrs")}`}
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
              {t(`symptoms.${sym}`, sym)}
            </button>
          ))}
        </div>
      )}

      {d.step === 3 && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-2xl border-2 border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <h2 className="text-base font-bold text-foreground">{t("breakdown.step4Title")}</h2>
            </div>
            <p className="text-xs text-muted-foreground">{t("breakdown.step4Desc")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("breakdown.step4VillageLabel")}</Label>
                <input
                  type="text"
                  className={input}
                  placeholder={t("breakdown.step4VillagePlaceholder")}
                  value={d.village}
                  onChange={(e) => up({ village: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("breakdown.step4TahsilLabel")}</Label>
                <select
                  className={cn(input, "cursor-pointer bg-background")}
                  value={d.tahsil}
                  onChange={(e) => up({ tahsil: e.target.value })}
                >
                  <option value="">{t("breakdown.step4TahsilLabel")}...</option>
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
                  <MapPin className="h-4 w-4 text-primary" /> {t("breakdown.step4UseGps")}
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
                  <Loader2 className="h-4 w-4 animate-spin text-primary" /> {t("common.loading")}
                </button>
              )}

              {gpsState === "captured" && gps && (
                <div className="rounded-xl bg-success/10 border border-success/30 p-3 text-sm flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-success flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />{" "}
                      {t("breakdown.step4GpsAcquired")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatGpsAccuracy(gps.accuracy)
                        ? `${formatGpsAccuracy(gps.accuracy)} ${t("breakdown.step4Accuracy")} · `
                        : ""}
                      captured {ago(new Date(gps.capturedAt).getTime())} ago
                    </p>
                    <p className="text-[11px] text-muted-foreground/80 italic">
                      {t("breakdown.step4DoorstepNotice")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearGps}
                    className="text-xs text-muted-foreground hover:text-destructive underline shrink-0"
                  >
                    {t("common.delete")}
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
                      {t("common.close")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Machine Mobility Assessment & Service Delivery Mode */}
          <div className="space-y-4 rounded-2xl border-2 border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-primary" />
              <h2 className="text-base font-bold text-foreground">
                {t("breakdown.deliveryModeTitle")}
              </h2>
            </div>

            {/* Mobility Question */}
            <div className="space-y-2 rounded-xl border border-border/80 bg-background/50 p-3.5">
              <Label className="text-sm font-semibold text-foreground">
                {t("breakdown.immobileQuestion")}
              </Label>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => toggleMobility(false)}
                  className={cn(
                    "rounded-xl border-2 p-3 text-center text-sm font-semibold transition-colors",
                    !d.isImmobile
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-border/80",
                  )}
                >
                  No — Operable / Towable
                </button>
                <button
                  type="button"
                  onClick={() => toggleMobility(true)}
                  className={cn(
                    "rounded-xl border-2 p-3 text-center text-sm font-semibold transition-colors",
                    d.isImmobile
                      ? "border-destructive bg-destructive/10 text-destructive"
                      : "border-border bg-card text-muted-foreground hover:border-border/80",
                  )}
                >
                  Yes — Inoperable / Stopped
                </button>
              </div>

              {/* Immobile Warning Advisory */}
              {d.isImmobile && (
                <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold">{t("breakdown.immobileWarning")}</p>
                    <p className="text-[11px] opacity-90">
                      Do not attempt hazardous road towing of broken down or immobile agricultural
                      machinery.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Delivery Mode Selection */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                Delivery Mode
              </Label>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {/* Doorstep Service Option */}
                <button
                  type="button"
                  onClick={() => up({ deliveryMode: "DOORSTEP" })}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xl border-2 p-3.5 text-left transition-colors",
                    d.deliveryMode === "DOORSTEP"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-border/80",
                  )}
                >
                  <span className="flex items-center justify-between text-sm font-bold">
                    <span>Doorstep / On-Field</span>
                    {d.deliveryMode === "DOORSTEP" && (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("breakdown.deliveryModeDoorstep")}
                  </span>
                </button>

                {/* Workshop Drop-Off Option */}
                <button
                  type="button"
                  disabled={d.isImmobile}
                  onClick={() => {
                    if (!d.isImmobile) {
                      up({ deliveryMode: "WORKSHOP_DROPOFF" });
                    }
                  }}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xl border-2 p-3.5 text-left transition-colors",
                    d.isImmobile
                      ? "cursor-not-allowed opacity-40 border-dashed border-border bg-muted/30"
                      : d.deliveryMode === "WORKSHOP_DROPOFF"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-border/80",
                  )}
                >
                  <span className="flex items-center justify-between text-sm font-bold">
                    <span>Workshop Drop-Off</span>
                    {d.isImmobile ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-destructive bg-destructive/15 px-1.5 py-0.5 rounded">
                        Disabled (Immobile)
                      </span>
                    ) : d.deliveryMode === "WORKSHOP_DROPOFF" ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("breakdown.deliveryModeDropOff")}
                  </span>
                </button>
              </div>
            </div>

            {/* Workshop Drop-Off Selector (Active when Drop-Off is selected and machine is mobile) */}
            {!d.isImmobile && d.deliveryMode === "WORKSHOP_DROPOFF" && (
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-bold text-foreground">
                    {t("breakdown.selectWorkshop")}
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {workshops.filter((w) => w.drop_off_approved && w.is_active).length} approved
                  </span>
                </div>

                {loadingWorkshops ? (
                  <div className="py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span>Loading workshops…</span>
                  </div>
                ) : workshops.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    {t("breakdown.noApprovedWorkshops")}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {workshops.map((ws) => {
                      const isSelected = d.facilityId === ws.id;

                      return (
                        <button
                          key={ws.id}
                          type="button"
                          onClick={() => up({ facilityId: ws.id })}
                          className={cn(
                            "w-full rounded-xl border-2 p-3 text-left transition-all",
                            isSelected
                              ? "border-primary bg-primary/10 shadow-sm"
                              : "border-border bg-card hover:border-border/90",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-0.5">
                              <p className="text-sm font-bold text-foreground">{ws.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {[ws.village, ws.tahsil].filter(Boolean).join(", ")}
                                {ws.address ? ` · ${ws.address}` : ""}
                              </p>
                              {ws.operating_hours &&
                                typeof ws.operating_hours === "object" &&
                                "open" in ws.operating_hours && (
                                  <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1 mt-1">
                                    <Clock className="h-3 w-3" />
                                    {`${(ws.operating_hours as Record<string, unknown>).open} – ${(ws.operating_hours as Record<string, unknown>).close}`}
                                  </p>
                                )}
                            </div>
                            <div className="shrink-0 text-right">
                              {isSelected ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                  <CheckCircle2 className="h-3 w-3" /> Selected
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("breakdown.step2VoiceTitle")}</Label>
            <textarea
              rows={5}
              maxLength={1000}
              className={input}
              placeholder={t("breakdown.step2TextPlaceholder")}
              value={d.description}
              onChange={(e) => up({ description: e.target.value })}
            />
            <button onClick={voice} className={cn(listening ? btn.urgent : btn.ghost, "w-full")}>
              <Mic className="h-5 w-5" />
              {listening ? t("breakdown.step2VoiceStop") : t("breakdown.step2VoiceRecordBtn")}
            </button>
            <p className="text-sm text-muted-foreground">{t("breakdown.step2VoiceDesc")}</p>
          </div>
        </div>
      )}

      {d.step === 4 && (
        <div className="space-y-3">
          <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card text-center">
            <Camera className="h-10 w-10 text-muted-foreground" />
            <span className="font-semibold">{t("breakdown.step3TakePhoto")}</span>
            <span className="text-xs text-muted-foreground">{t("breakdown.step3Desc")}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const url = await fileToSmallDataUrl(f);
                if (url) up({ photos: [...d.photos, url].slice(0, 4) });
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

          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={d.aiConsent ?? true}
                onChange={(e) => up({ aiConsent: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
              />
              <div className="space-y-1">
                <span className="text-sm font-semibold text-foreground">
                  {/* Allow AI visual defect analysis of breakdown photos */}
                  {t("breakdown.step3ConsentCheckbox")}
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("breakdown.step3ConsentDisclaimer")}
                </p>
              </div>
            </label>
          </div>
        </div>
      )}

      {d.step === 5 && (
        <Card className="space-y-2">
          <p>
            <b>{t("equipment.typeLabel")}:</b>{" "}
            {selectedEquipment ? `${selectedEquipment.make} ${selectedEquipment.model}` : "—"}
          </p>
          <p>
            <b>{t("breakdown.machineMobility")}:</b>{" "}
            {d.isImmobile ? (
              <span className="text-destructive font-semibold">
                Inoperable / Stopped (Doorstep Locked)
              </span>
            ) : (
              <span>Operable / Towable</span>
            )}
          </p>
          <p>
            <b>{t("breakdown.deliveryModeTitle")}:</b>{" "}
            {d.deliveryMode === "WORKSHOP_DROPOFF" ? (
              <span className="font-semibold text-primary">
                {t("breakdown.deliveryModeDropOff")}
                {selectedWorkshop ? ` — ${selectedWorkshop.name}` : ""}
              </span>
            ) : (
              <span>{t("breakdown.deliveryModeDoorstep")}</span>
            )}
          </p>
          {d.deliveryMode === "WORKSHOP_DROPOFF" && selectedWorkshop && (
            <p className="text-xs text-muted-foreground pl-2 border-l-2 border-primary/30">
              <b>Workshop:</b> {selectedWorkshop.name} ({selectedWorkshop.village},{" "}
              {selectedWorkshop.tahsil})
              {selectedWorkshop.address ? ` · ${selectedWorkshop.address}` : ""}
            </p>
          )}
          <p>
            <b>{t("breakdown.step2Title")}:</b>{" "}
            {d.symptoms.map((s) => t(`symptoms.${s}`, s)).join(", ")}
          </p>
          <p>
            <b>{t("breakdown.step4Title")}:</b>{" "}
            {formatCoarseLocation(d.village, d.tahsil) || "On-site / Field"}
            {gps ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
                <MapPin className="h-3 w-3" /> {t("breakdown.step4GpsAcquired")} (
                {formatGpsAccuracy(gps.accuracy)})
              </span>
            ) : null}
          </p>
          {d.description && (
            <p>
              <b>{t("breakdown.step2VoiceTitle")}:</b> {d.description}
            </p>
          )}
          <p>
            <b>{t("breakdown.step3Title")}:</b> {d.photos.length}
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
            {t("breakdown.btnNext")} <ArrowRight className="h-5 w-5" />
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
                <span>{t("breakdown.btnSubmitting")}</span>
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                <span>{t("breakdown.btnSubmit")}</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
