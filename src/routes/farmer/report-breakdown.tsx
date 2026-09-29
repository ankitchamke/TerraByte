import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Camera, CloudOff, Mic, Sparkles, Tractor, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { btn, Card, input, useOnline } from "@/components/tb";
import { SYMPTOMS } from "@/lib/assessment";
import { fileToSmallDataUrl } from "@/lib/image";
import { actions, isActive, useTB } from "@/lib/tb-store";
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
};

function Report() {
  const s = useTB();
  const nav = useNavigate();
  const online = useOnline();
  const { equipment: pre } = Route.useSearch();
  const fid = s.session!.userId;
  const busy = new Set(s.repairs.filter((r) => isActive(r)).map((r) => r.equipmentId));
  const eq = s.equipment.filter((e) => e.farmerId === fid);
  const [d, setD] = useState<Draft>({
    step: pre ? 2 : 1,
    equipmentId: pre ?? "",
    symptoms: [],
    description: "",
    photos: [],
  });
  const [restored, setRestored] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(DRAFT);
    if (raw && !pre) {
      try {
        const x = JSON.parse(raw) as Draft;
        if (x.equipmentId || x.symptoms.length) {
          setD(x);
          setRestored(true);
        }
      } catch {
        /* */
      }
    }
  }, [pre]);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT, JSON.stringify(d));
    } catch {
      /* */
    }
  }, [d]);

  const up = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const toggle = (sym: string) =>
    up({
      symptoms: d.symptoms.includes(sym)
        ? d.symptoms.filter((x) => x !== sym)
        : [...d.symptoms, sym],
    });

  const voice = () => {
    interface SpeechRecognitionEvent {
      results: { [index: number]: { [index: number]: { transcript: string } } };
    }
    interface SpeechRecognitionInstance {
      lang: string;
      interimResults: boolean;
      onresult: ((event: SpeechRecognitionEvent) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    }
    interface WindowWithSpeech {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    }
    const W = window as unknown as WindowWithSpeech;
    const SR = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!SR) {
      toast("Voice typing isn't supported on this browser — use your keyboard's mic button.");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "en-IN";
      rec.interimResults = false;
      rec.onresult = (e: SpeechRecognitionEvent) => {
        const transcript = e.results[0]?.[0]?.transcript ?? "";
        up({ description: (d.description + " " + transcript).trim() });
      };
      rec.onerror = () => {
        setListening(false);
        toast.error("Could not capture speech. Please type your description.");
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      toast.error("Microphone access could not be initialized.");
    }
  };

  const submit = () => {
    const e = eq.find((x) => x.id === d.equipmentId)!;
    const id = actions.createRepair({
      equipmentId: e.id,
      farmerId: fid,
      symptoms: d.symptoms,
      description: d.description.trim().slice(0, 1000),
      photos: d.photos.filter(Boolean),
      location: s.farmers.find((f) => f.id === fid)!.village,
    });
    localStorage.removeItem(DRAFT);
    if (!online) toast.warning("Saved on your phone — will sync when signal returns.");
    nav({ to: "/farmer/repair/$id", params: { id } });
  };

  const canNext = [!!d.equipmentId, d.symptoms.length > 0, true, true][d.step - 1];
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
          aria-label="Back"
          onClick={() => (d.step > 1 ? up({ step: d.step - 1 }) : nav({ to: "/farmer" }))}
          className="grid h-11 w-11 place-items-center rounded-xl border-2 border-border"
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
              setD({ step: 1, equipmentId: "", symptoms: [], description: "", photos: [] });
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
          {eq.map((e) => {
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
                    {dis ? "Already in repair" : `${e.type} · ${e.hours} hrs`}
                  </span>
                </span>
              </button>
            );
          })}
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
        <div className="space-y-3">
          <textarea
            rows={6}
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
            <b>Machine:</b> {eq.find((e) => e.id === d.equipmentId)?.make}{" "}
            {eq.find((e) => e.id === d.equipmentId)?.model}
          </p>
          <p>
            <b>Symptoms:</b> {d.symptoms.join(", ")}
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
          <button onClick={submit} className={cn(btn.urgent, "w-full")}>
            <Sparkles className="h-5 w-5" /> Start preliminary assessment
          </button>
        )}
      </div>
    </div>
  );
}
