import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Camera, Loader2, Lock, PackageSearch, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable, Timeline } from "@/components/repair-parts";
import { btn, CallButton, Card, ClickableImage, DateTimePicker, formatEtaDateTime, input, Label, StatusPill } from "@/components/tb";
import { fileToSmallDataUrl } from "@/lib/image";
import { actions, ago, fmtTime, inr, quoteTotals, useTB, type Quote, type QuotePart, type Repair } from "@/lib/tb-store";
import { formatEtaDateTime as formatEta, getEtaPresets, toDateTimeLocalString, valueToDateTimeLocal } from "@/lib/date-utils";
import { useAuth } from "@/lib/auth";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  acceptRepairRequest,
  completeRepair,
  declineRepairRequest,
  failTesting,
  getRepairRequestById,
  resumeRepair,
  startTesting,
  updatePartsEta,
  waitForParts,
  type RepairRequestDetail,
} from "@/lib/services/repair-requests";
import { addRepairNote, getRepairNotes, type RepairNoteWithAuthor } from "@/lib/services/repair-notes";
import {
  createQuote,
  getQuotesForRepair,
  parseClarificationNote,
  reviseQuote,
  type CreateQuoteInput,
  type CreateQuoteItemInput,
  type QuoteDetail,
} from "@/lib/services/quotes";

export const Route = createFileRoute("/technician/job/$id")({
  head: () => meta("Job", "Repair job details and actions."),
  component: Job,
});

function toQuoteView(q: QuoteDetail): Quote {
  return {
    parts: (q.quote_items || []).map((item) => ({
      name: item.part_name,
      spec: item.part_spec || "OEM Standard",
      qty: item.quantity,
      price: Number(item.unit_price),
      source: item.part_source || "In van stock",
    })),
    labourDesc: q.labour_description || "Inspection, repair and test run",
    labour: Number(q.labour_amount),
    taxPct: Number(q.tax_percent),
    eta: q.estimated_completion || "TBD",
    warranty: q.warranty_terms || "90 days on parts & labour",
    version: q.version,
    sentAt: new Date(q.created_at).getTime(),
  };
}

function Job() {
  const { id } = Route.useParams();
  const { profile } = useAuth();
  const nav = useNavigate();
  const hasLoadedRef = useRef(false);
  const [r, setR] = useState<RepairRequestDetail | null>(null);
  const [quotes, setQuotes] = useState<QuoteDetail[]>([]);
  const [notes, setNotes] = useState<RepairNoteWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setError(null);
      const [repairData, quotesData, notesData] = await Promise.all([
        getRepairRequestById(id),
        getQuotesForRepair(id).catch(() => []),
        getRepairNotes(id).catch(() => []),
      ]);
      setR(repairData);
      setQuotes(quotesData);
      setNotes(notesData);
      hasLoadedRef.current = true;
    } catch (err: any) {
      console.error("[TerraByte] Failed to load job details:", err);
      if (!hasLoadedRef.current) {
        setError(err?.message || "Failed to load repair job");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadData();

    const channel = supabase
      .channel(`technician-job-live-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "repair_requests" },
        () => {
          void loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quotes" },
        () => {
          void loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "repair_timeline" },
        () => {
          void loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "repair_notes" },
        () => {
          void loadData();
        }
      )
      .subscribe();

    const handleFocus = () => {
      void loadData();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener("focus", handleFocus);
    };
  }, [id, loadData]);

  if (loading) {
    return (
      <div className="space-y-5">
        <Link to="/technician" className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Jobs
        </Link>
        <div className="py-12 text-center text-muted-foreground">Loading job details…</div>
      </div>
    );
  }

  if (error || !r) {
    return (
      <div className="space-y-5">
        <Link to="/technician" className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Jobs
        </Link>
        <Card className="text-destructive">
          <p>{error || "Repair job not found."}</p>
          <Link to="/technician" className="mt-2 inline-block font-semibold text-primary underline">
            Back to jobs
          </Link>
        </Card>
      </div>
    );
  }

  if (r.technician_id !== profile?.id && r.status !== "COMPLETED" && profile?.role !== "service_centre") {
    return (
      <div className="space-y-5">
        <Link to="/technician" className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Jobs
        </Link>
        <Card>
          This job isn't assigned to you.{" "}
          <Link to="/technician" className="font-semibold text-primary">Back to jobs</Link>
        </Card>
      </div>
    );
  }

  const e = r.equipment;
  const f = r.farmer;
  const createdAtMs = new Date(r.created_at).getTime();

  const pendingQuote = quotes.find((q) => q.status === "PENDING");
  const approvedQuote = quotes.find((q) => q.status === "APPROVED");
  const latestQuote = quotes[quotes.length - 1];
  const activeQuote = pendingQuote || approvedQuote || latestQuote;
  const viewQuote = activeQuote ? toQuoteView(activeQuote) : undefined;

  const breakdownPhotos: string[] = Array.isArray(r.photos)
    ? r.photos.filter((p) => typeof p === "string" && p.trim().length > 0)
    : typeof r.photos === "string"
    ? ((r.photos as string).trim().startsWith("[") ? JSON.parse(r.photos) : [(r.photos as string).trim()]).filter(Boolean)
    : [];

  const adaptedRepair: Repair = {
    id: r.job_number || r.id,
    equipmentId: r.equipment_id,
    farmerId: r.farmer_id,
    technicianId: r.technician_id || "",
    status: r.status,
    statusSince: new Date(r.status_since).getTime(),
    createdAt: createdAtMs,
    location: r.location,
    symptoms: r.symptoms,
    description: r.description,
    photos: breakdownPhotos,
    assessment: (r.assessment as any) || {},
    ...(viewQuote ? { quote: viewQuote } : {}),
    ...(r.clarification_note ? { clarification: r.clarification_note } : {}),
    ...(r.parts_hold
      ? {
          parts: {
            part: (r.parts_hold as any).part || "Spare part",
            reason: (r.parts_hold as any).reason || "Parts hold",
            eta: (r.parts_hold as any).eta || "TBD",
            note: (r.parts_hold as any).note || "",
            revisedCompletion:
              (r.parts_hold as any).revisedCompletion ||
              (r.parts_hold as any).revised_completion ||
              "",
            since:
              typeof (r.parts_hold as any).since === "number"
                ? (r.parts_hold as any).since
                : new Date((r.parts_hold as any).since || r.status_since).getTime(),
          },
        }
      : {}),
    ...(r.completion_details ? { completion: r.completion_details as any } : {}),
    testing: Boolean(r.is_testing),
    ...(r.verified_at ? { verifiedAt: new Date(r.verified_at).getTime() } : {}),
    declinedBy: r.declined_by || [],
    notes: notes.map((n) => ({
      text: n.note_text,
      by: (n.author?.role === "admin" ? "admin" : n.author?.role === "farmer" ? "farmer" : "technician") as any,
      at: new Date(n.created_at).getTime(),
    })),
    timeline: (r.repair_timeline || []).map((tl) => ({
      status: tl.status as any,
      by: (tl.created_by_role === "admin" ? "admin" : tl.created_by_role === "farmer" ? "farmer" : "technician") as any,
      at: new Date(tl.created_at).getTime(),
      note: tl.note || "",
    })),
  };

  return (
    <div className="space-y-5">
      <Link to="/technician" className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Jobs
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm text-muted-foreground">Job {r.job_number || r.id} · {ago(createdAtMs)} ago</p>
          <h1 className="text-3xl font-bold">{e ? `${e.make} ${e.model}` : "Equipment"}</h1>
          <p className="text-sm text-muted-foreground">
            {e?.type} · {e?.year} · {e?.operating_hours?.toLocaleString("en-IN")} hrs · <span className="font-mono">{e?.serial_number}</span>
          </p>
        </div>
        <StatusPill r={{ status: r.status, testing: r.is_testing }} audience="staff" />
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Farmer</Label>
            <p className="font-semibold">{f?.full_name || "Farmer"}</p>
            <p className="text-sm text-muted-foreground">{r.location}</p>
          </div>
          <div className="flex items-end">
            {f?.phone ? <CallButton phone={f.phone} label="Call farmer" className="w-full" /> : null}
          </div>
          <div className="sm:col-span-2">
            <Label>Reported symptoms</Label>
            <div className="flex flex-wrap gap-1.5">
              {r.symptoms.map((x) => (
                <span key={x} className="rounded-lg bg-destructive/10 px-2 py-1 text-sm font-semibold text-destructive">
                  {x}
                </span>
              ))}
            </div>
          </div>
          {r.description && (
            <div className="sm:col-span-2">
              <Label>Farmer's description</Label>
              <p>"{r.description}"</p>
            </div>
          )}
          <div className="sm:col-span-2 space-y-2 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <Label className="uppercase text-xs tracking-wider text-muted-foreground font-bold">
                Reported breakdown photos
              </Label>
              {breakdownPhotos.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {breakdownPhotos.length} {breakdownPhotos.length === 1 ? "photo" : "photos"}
                </span>
              )}
            </div>
            {breakdownPhotos.length > 0 ? (
              <div className="flex flex-wrap gap-2.5 pt-1">
                {breakdownPhotos.map((p, i) => (
                  <ClickableImage
                    key={i}
                    src={p}
                    alt={`Breakdown photo ${i + 1}`}
                    className="h-24 w-24 rounded-xl border border-border shadow-xs"
                    thumbnailClassName="h-24 w-24 object-cover"
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic py-1">
                No photos attached by farmer
              </p>
            )}
          </div>
        </div>
      </Card>

      {r.status === "REQUESTED" && (
        declineOpen ? (
          <DeclineBox
            repairId={r.id}
            onDone={() => nav({ to: "/technician" })}
            onCancel={() => setDeclineOpen(false)}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setDeclineOpen(true)} className={btn.ghost}>
              Decline job
            </button>
            <button
              disabled={accepting}
              onClick={async () => {
                setAccepting(true);
                try {
                  await acceptRepairRequest(r.id);
                  toast.success("Job accepted. Farmer notified.");
                  await loadData();
                } catch (err: any) {
                  toast.error(err?.message || "Failed to accept job");
                } finally {
                  setAccepting(false);
                }
              }}
              className={cn(btn.primary, "h-14 text-lg disabled:opacity-50")}
            >
              {accepting ? "Accepting…" : "Accept job"}
            </button>
          </div>
        )
      )}

      <AssessmentCard r={adaptedRepair} />

      {(r.status === "ACCEPTED" || r.status === "QUOTE_REVISED") && (
        <QuoteBuilder
          repairId={r.id}
          status={r.status}
          clarification={r.clarification_note}
          previousQuote={latestQuote}
          defaultPartName={(r.assessment as any)?.partsCategory?.[0] || ""}
          onDone={loadData}
        />
      )}

      {r.status === "QUOTE_PENDING" && (
        <Card className="border-accent">
          <p className="mb-3 flex items-center gap-2 font-semibold">
            <Lock className="h-4 w-4" /> Waiting for farmer approval — repair work is locked until approved.
          </p>
          {adaptedRepair.quote ? (
            <QuoteTable q={adaptedRepair.quote} />
          ) : (
            <p className="text-sm text-muted-foreground">Quote submitted. Awaiting farmer response.</p>
          )}
        </Card>
      )}

      {r.status === "IN_PROGRESS" && (
        <>
          {adaptedRepair.quote && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Approved quote</h2>
              <QuoteTable q={adaptedRepair.quote} />
            </Card>
          )}
          <InProgress repairId={r.id} r={adaptedRepair} notes={notes} onUpdate={loadData} />
        </>
      )}

      {r.status === "WAITING_FOR_PARTS" && (
        <Waiting repairId={r.id} r={adaptedRepair} onUpdate={loadData} />
      )}

      {r.status === "COMPLETED" && (
        <Card className="border-success">
          <p className="font-bold text-success">
            Completed{adaptedRepair.quote ? ` · ${inr(quoteTotals(adaptedRepair.quote).total)}` : ""}
          </p>
          <p className="text-sm">
            {adaptedRepair.completion?.notes || (r.completion_details as any)?.notes || "Repair completed and verified."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {adaptedRepair.verifiedAt ? "Farmer confirmed handover." : "Awaiting farmer handover confirmation."}
          </p>
        </Card>
      )}

      <details className="rounded-2xl border border-border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Status timeline</summary>
        <div className="mt-4">
          <ol className="space-y-3 text-sm">
            {[...(r.repair_timeline || [])].reverse().map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0">
                  <p>
                    <b className="font-mono text-xs">{e.status}</b>{" "}
                    <span className="text-muted-foreground">
                      · {e.created_by_role === "technician" ? "Technician" : e.created_by_role === "admin" ? "Service Centre" : "Farmer"}{" "}
                      · {fmtTime(new Date(e.created_at).getTime())}
                    </span>
                  </p>
                  {e.note && <p className="text-muted-foreground">{e.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </details>
    </div>
  );
}

function DeclineBox({
  repairId,
  onDone,
  onCancel,
}: {
  repairId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleDecline = async () => {
    const finalReason = reason === "Other" ? other.trim() : reason;
    if (!finalReason) return;
    setSubmitting(true);
    try {
      await declineRepairRequest(repairId, finalReason);
      toast("Declined — returned to dispatch");
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Failed to decline job");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="space-y-3">
      <Label>Reason for declining</Label>
      <div className="grid grid-cols-2 gap-2">
        {["Out of service area", "Wrong specialization", "Fully booked", "Other"].map((x) => (
          <button
            key={x}
            onClick={() => setReason(x)}
            className={cn("min-h-12 rounded-xl border-2 p-2 text-sm font-semibold", reason === x ? "border-primary bg-primary/10" : "border-border")}
          >
            {x}
          </button>
        ))}
      </div>
      {reason === "Other" && (
        <input className={input} maxLength={120} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Reason" />
      )}
      <div className="grid grid-cols-2 gap-2">
        <button disabled={submitting} onClick={onCancel} className={btn.ghost}>
          Back
        </button>
        <button
          disabled={submitting || !reason || (reason === "Other" && !other.trim())}
          onClick={handleDecline}
          className={btn.amber}
        >
          {submitting ? "Declining…" : "Confirm decline"}
        </button>
      </div>
    </Card>
  );
}

const blankPart = (): QuotePart => ({ name: "", spec: "", qty: 1, price: 0, source: "In van stock" });

interface QuoteBuilderProps {
  repairId: string;
  status: string;
  clarification?: string | null;
  previousQuote?: QuoteDetail | null | undefined;
  defaultPartName?: string;
  onDone: () => Promise<void>;
}

function QuoteBuilder({
  repairId,
  status,
  clarification,
  previousQuote,
  defaultPartName,
  onDone,
}: QuoteBuilderProps) {
  const [submitting, setSubmitting] = useState(false);
  const [technicianExplanation, setTechnicianExplanation] = useState("");
  const [q, setQ] = useState<Omit<Quote, "version" | "sentAt">>(() => {
    if (previousQuote) {
      return {
        parts: (previousQuote.quote_items || []).map((item) => ({
          name: item.part_name,
          spec: item.part_spec || "",
          qty: item.quantity,
          price: Number(item.unit_price),
          source: item.part_source || "In van stock",
        })),
        labourDesc: previousQuote.labour_description || "Inspection, repair and test run",
        labour: Number(previousQuote.labour_amount),
        taxPct: Number(previousQuote.tax_percent),
        eta: previousQuote.estimated_completion || getEtaPresets()[2]?.iso || "",
        warranty: previousQuote.warranty_terms || "90 days on parts & labour",
      };
    }
    return {
      parts: [{ ...blankPart(), name: defaultPartName || "" }],
      labourDesc: "Inspection, repair and test run",
      labour: 800,
      taxPct: 0,
      eta: getEtaPresets()[2]?.iso || "",
      warranty: "90 days on parts & labour",
    };
  });

  const setPart = (i: number, p: Partial<QuotePart>) =>
    setQ((prev) => ({
      ...prev,
      parts: prev.parts.map((x, k) => (k === i ? { ...x, ...p } : x)),
    }));

  const t = quoteTotals({ ...q, version: 0, sentAt: 0 });
  const valid =
    q.parts.length > 0 &&
    q.parts.every((p) => p.name.trim() && p.qty > 0 && p.price >= 0) &&
    q.labourDesc.trim().length > 0 &&
    q.eta.trim().length > 0;

  const handleSend = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const payload: CreateQuoteInput = {
        repair_request_id: repairId,
        labour_description: q.labourDesc.trim(),
        labour_amount: Number(q.labour),
        tax_percent: Number(q.taxPct),
        estimated_completion: q.eta.trim(),
        ...(q.warranty.trim() ? { warranty_terms: q.warranty.trim() } : {}),
        items: q.parts.map((p) => ({
          part_name: p.name.trim(),
          quantity: Number(p.qty),
          unit_price: Number(p.price),
          part_source: p.source,
          ...(p.spec.trim() ? { part_spec: p.spec.trim() } : {}),
        })),
      };

      if (status === "QUOTE_REVISED" && previousQuote) {
        await reviseQuote({
          ...payload,
          previous_quote_id: previousQuote.id,
          technician_explanation: technicianExplanation.trim() || undefined,
        });
        toast.success("Revised quote sent to farmer");
      } else {
        await createQuote(payload);
        toast.success("Quote sent to farmer");
      }
      await onDone();
    } catch (err: any) {
      console.error("[TerraByte] Failed to send quote:", err);
      toast.error(err?.message || "Failed to send quote");
    } finally {
      setSubmitting(false);
    }
  };

  const parsedClarification = parseClarificationNote(clarification);

  return (
    <Card className="space-y-4 border-primary/40">
      <h2 className="text-xl font-bold">
        {status === "QUOTE_REVISED" ? "Revise quote" : "Create itemized quote"}
      </h2>
      {status === "QUOTE_REVISED" && (
        <section className="rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Farmer requested quote revision {previousQuote ? `(Quote v${previousQuote.version})` : ""}</span>
          </div>
          {parsedClarification.reason && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason</p>
              <p className="text-base font-semibold text-foreground">{parsedClarification.reason}</p>
            </div>
          )}
          {parsedClarification.explanation && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Farmer message</p>
              <p className="mt-1 rounded-xl bg-card p-3 text-sm italic border border-border">
                "{parsedClarification.explanation}"
              </p>
            </div>
          )}
          {parsedClarification.photo && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Attached Photo</p>
              <ClickableImage
                src={parsedClarification.photo}
                alt="Farmer attachment"
                className="mt-1.5 h-28 w-28"
                thumbnailClassName="h-28 w-28 object-cover"
              />
            </div>
          )}
          {parsedClarification.reason === "Please explain labour" && (
            <div className="pt-2 border-t border-amber-500/30 space-y-2">
              <Label>Farmer asked you to explain the labour charge</Label>
              <p className="text-xs text-muted-foreground">
                Detail what is included in the labour charge for the farmer.
              </p>
              <textarea
                className={cn(input, "h-24 resize-none py-2 text-sm leading-relaxed bg-card")}
                placeholder="Explain what the labour charge includes..."
                value={technicianExplanation}
                onChange={(e) => setTechnicianExplanation(e.target.value)}
              />
            </div>
          )}
        </section>
      )}
      {status !== "QUOTE_REVISED" && clarification && (
        <p className="rounded-xl bg-accent/20 p-3 text-sm">
          <b>Farmer note:</b> "{clarification}"
        </p>
      )}
      {q.parts.map((p, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <Label>Part {i + 1}</Label>
            <button
              aria-label="Remove part"
              onClick={() => setQ({ ...q, parts: q.parts.filter((_, k) => k !== i) })}
              className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <input
            className={input}
            placeholder="Part name"
            value={p.name}
            onChange={(e) => setPart(i, { name: e.target.value })}
          />
          <input
            className={input}
            placeholder="Part number / spec"
            value={p.spec}
            onChange={(e) => setPart(i, { spec: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Qty</Label>
              <input
                className={input}
                inputMode="numeric"
                value={p.qty}
                onChange={(e) => setPart(i, { qty: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div>
              <Label>Unit price ₹</Label>
              <input
                className={input}
                inputMode="numeric"
                value={p.price}
                onChange={(e) => setPart(i, { price: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
          </div>
          <select
            className={input}
            value={p.source}
            onChange={(e) => setPart(i, { source: e.target.value })}
          >
            {[
              "In van stock",
              "Workshop stock",
              "Taluka distributor",
              "Order from OEM (2-3 days)",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
      ))}
      <button
        onClick={() => setQ({ ...q, parts: [...q.parts, blankPart()] })}
        className={cn(btn.ghost, "w-full")}
      >
        <Plus className="h-4 w-4" /> Add part
      </button>
      <div>
        <Label>Labour / service description</Label>
        <input
          className={input}
          value={q.labourDesc}
          onChange={(e) => setQ({ ...q, labourDesc: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Labour ₹</Label>
          <input
            className={input}
            inputMode="numeric"
            value={q.labour}
            onChange={(e) => setQ({ ...q, labour: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
        <div>
          <Label>GST %</Label>
          <select
            className={input}
            value={q.taxPct}
            onChange={(e) => setQ({ ...q, taxPct: Number(e.target.value) })}
          >
            {[0, 5, 12, 18].map((x) => (
              <option key={x} value={x}>
                {x}%
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Est. completion</Label>
          <DateTimePicker
            value={q.eta}
            onChange={(val) => setQ({ ...q, eta: val })}
          />
        </div>
        <div>
          <Label>Warranty</Label>
          <input className={input} value={q.warranty} onChange={(e) => setQ({ ...q, warranty: e.target.value })} />
        </div>
      </div>
      <dl className="rounded-xl bg-muted p-3 text-sm">
        <div className="flex justify-between">
          <dt>Parts</dt>
          <dd>{inr(t.parts)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Labour</dt>
          <dd>{inr(t.labour)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Tax</dt>
          <dd>{inr(t.tax)}</dd>
        </div>
        <div className="flex justify-between font-display text-xl font-bold">
          <dt>Total</dt>
          <dd>{inr(t.total)}</dd>
        </div>
      </dl>
      <button
        disabled={!valid || submitting}
        onClick={handleSend}
        className={cn(btn.primary, "h-14 w-full text-lg disabled:opacity-50")}
      >
        {submitting
          ? "Sending quote…"
          : status === "QUOTE_REVISED"
            ? `Send revised quote (v${(previousQuote?.version ?? 1) + 1}) to farmer`
            : "Send quote to farmer"}
      </button>
    </Card>
  );
}

interface InProgressProps {
  repairId: string;
  r: Repair;
  notes: RepairNoteWithAuthor[];
  onUpdate: () => Promise<void>;
}

function InProgress({ repairId, r, notes, onUpdate }: InProgressProps) {
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"none" | "parts" | "complete" | "test_failed">("none");
  const [p, setP] = useState(() => {
    const presets = getEtaPresets();
    return {
      part: r.quote?.parts[0]?.name ?? "",
      reason: "Not in van stock",
      eta: presets[1]?.iso || "",
      note: "",
      revisedCompletion: presets[2]?.iso || "",
    };
  });
  const [failReason, setFailReason] = useState("");
  const [final, setFinal] = useState("");
  const [photo, setPhoto] = useState("");
  const [tested, setTested] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleFailTesting = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await failTesting(repairId, {
        ...(failReason.trim() ? { reason: failReason.trim() } : {}),
      });
      setMode("none");
      setFailReason("");
      toast.success("Testing failure recorded. Returned to active repair.");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to record testing failure:", err);
      toast.error(err?.message || "Failed to record testing failure");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNote = async () => {
    if (!note.trim() || noteSubmitting) return;
    setNoteSubmitting(true);
    try {
      await addRepairNote(repairId, note.trim());
      setNote("");
      toast.success("Note saved and added to timeline");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to add note:", err);
      toast.error(err?.message || "Failed to add note");
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleWaitForParts = async () => {
    if (!p.part.trim() || !p.eta.trim() || !p.reason.trim() || submitting) return;
    setSubmitting(true);
    try {
      await waitForParts(repairId, {
        part: p.part.trim(),
        reason: p.reason.trim(),
        eta: p.eta.trim(),
        ...(p.revisedCompletion.trim() ? { revisedCompletion: p.revisedCompletion.trim() } : {}),
        ...(p.note.trim() ? { note: p.note.trim() } : {}),
      });
      setMode("none");
      toast.success("Repair paused. Farmer notified of the delay.");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to pause for parts:", err);
      toast.error(err?.message || "Failed to pause repair");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartTesting = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await startTesting(repairId);
      toast.success("Testing started under operational load");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to start testing:", err);
      toast.error(err?.message || "Failed to start testing");
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async () => {
    if (!final.trim()) {
      toast.error("Please enter final repair notes.");
      return;
    }
    if (!tested) {
      toast.error("Please confirm that machine was tested under load.");
      return;
    }
    if (!r.testing) {
      toast.error("Please start machine testing before completing the repair.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await completeRepair(repairId, {
        notes: final.trim(),
        ...(photo ? { photo } : {}),
        tested: true,
      });
      setMode("none");
      toast.success("Repair completed. Added to machine history.");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to complete repair:", err);
      toast.error(err?.message || "Failed to complete repair");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <Label>Add technician note</Label>
        <div className="flex gap-2">
          <input
            className={input}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Injector removed, fuel line cleaned"
          />
          <button
            disabled={!note.trim() || noteSubmitting}
            onClick={handleAddNote}
            className={cn(btn.primary, "disabled:opacity-50")}
          >
            {noteSubmitting ? "Adding…" : "Add"}
          </button>
        </div>
      </Card>
      {notes.length > 0 && (
        <Card className="space-y-2">
          <Label>Technician work notes ({notes.length})</Label>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {notes.map((n) => (
              <div key={n.id} className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span className="font-semibold text-foreground">{n.author?.full_name || "Technician"}</span>
                  <span>{ago(new Date(n.created_at).getTime())} ago</span>
                </div>
                <p className="text-foreground leading-relaxed">{n.note_text}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
      {mode === "none" && (
        <div className="space-y-2">
          {r.testing && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 rounded-xl border border-primary/40 bg-primary/5">
              <span className="flex items-center gap-2 font-semibold text-primary">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                Testing in progress under operational load
              </span>
              <button
                type="button"
                onClick={() => setMode("test_failed")}
                className="text-xs font-bold text-destructive hover:underline px-3 py-1.5 rounded-lg border border-destructive/30 hover:bg-destructive/10 whitespace-nowrap"
              >
                Testing failed — resume repair
              </button>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <button onClick={() => setMode("parts")} className={cn(btn.amber, "h-14")}>
              <PackageSearch className="h-5 w-5" /> Waiting for parts
            </button>
            {!r.testing ? (
              <button
                disabled={submitting}
                onClick={handleStartTesting}
                className={cn(btn.ghost, "h-14 disabled:opacity-50")}
              >
                {submitting ? "Starting…" : "Start testing"}
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => setMode("test_failed")}
                className={cn(btn.urgent, "h-14 text-sm font-semibold")}
              >
                Testing failed — resume repair
              </button>
            )}
            <button
              onClick={() => {
                if (!r.testing) {
                  toast.error("Please start machine testing before completing the repair.");
                  return;
                }
                setMode("complete");
              }}
              className={cn(btn.primary, "h-14")}
            >
              Complete & hand over
            </button>
          </div>
        </div>
      )}
      {mode === "test_failed" && (
        <Card className="space-y-3 border-destructive">
          <div className="flex items-center gap-2 text-lg font-bold text-destructive">
            <AlertCircle className="h-5 w-5" /> Testing failed — return to repair
          </div>
          <p className="text-sm text-muted-foreground">
            Operational testing identified an issue. Enter details below to return this machine to active repair work and notify the farmer.
          </p>
          <div>
            <Label>Issue observed during testing (optional)</Label>
            <textarea
              rows={3}
              className={input}
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              placeholder="e.g. Engine temperature still rising under load, secondary seal leak..."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={submitting}
              onClick={() => {
                setMode("none");
                setFailReason("");
              }}
              className={btn.ghost}
            >
              Cancel
            </button>
            <button
              disabled={submitting}
              onClick={handleFailTesting}
              className={cn(btn.urgent, "disabled:opacity-50")}
            >
              {submitting ? "Returning…" : "Confirm failure & resume repair"}
            </button>
          </div>
        </Card>
      )}
      {mode === "parts" && (
        <Card className="space-y-3 border-warning">
          <h3 className="text-lg font-bold">Pause: waiting for parts</h3>
          <div>
            <Label>Part required</Label>
            <input
              className={input}
              value={p.part}
              onChange={(e) => setP({ ...p, part: e.target.value })}
            />
          </div>
          <div>
            <Label>Reason</Label>
            <input
              className={input}
              value={p.reason}
              onChange={(e) => setP({ ...p, reason: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Expected arrival</Label>
              <DateTimePicker
                value={p.eta}
                onChange={(val) => setP({ ...p, eta: val })}
              />
            </div>
            <div className="space-y-1">
              <Label>Revised completion</Label>
              <DateTimePicker
                value={p.revisedCompletion}
                onChange={(val) => setP({ ...p, revisedCompletion: val })}
              />
            </div>
          </div>
          <div>
            <Label>Note for farmer (optional)</Label>
            <input
              className={input}
              value={p.note}
              onChange={(e) => setP({ ...p, note: e.target.value })}
              placeholder="Part is being picked up from Taluka distributor."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={submitting}
              onClick={() => setMode("none")}
              className={btn.ghost}
            >
              Cancel
            </button>
            <button
              disabled={!p.part.trim() || !p.eta.trim() || submitting}
              onClick={handleWaitForParts}
              className={cn(btn.amber, "disabled:opacity-50")}
            >
              {submitting ? "Pausing…" : "Pause repair"}
            </button>
          </div>
        </Card>
      )}
      {mode === "complete" && (
        <Card className="space-y-3 border-success">
          <h3 className="text-lg font-bold">Complete repair</h3>
          <div>
            <Label>Final repair notes</Label>
            <textarea
              rows={3}
              className={input}
              maxLength={500}
              value={final}
              onChange={(e) => setFinal(e.target.value)}
              placeholder="Work performed, root cause found…"
            />
          </div>
          <label className={cn(btn.ghost, "w-full cursor-pointer")}>
            <Camera className="h-4 w-4" />
            {photo ? "Completion photo added ✓" : "Upload completion photo (optional)"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setPhoto(await fileToSmallDataUrl(f));
              }}
            />
          </label>
          <label className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-border p-3">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={tested}
              onChange={(e) => setTested(e.target.checked)}
            />{" "}
            Machine tested under load and working
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={submitting}
              onClick={() => setMode("none")}
              className={btn.ghost}
            >
              Cancel
            </button>
            <button
              disabled={!tested || !final.trim() || submitting}
              onClick={handleComplete}
              className={cn(btn.primary, "disabled:opacity-50")}
            >
              {submitting ? "Completing…" : "Complete & hand over"}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

interface WaitingProps {
  repairId: string;
  r: Repair;
  onUpdate: () => Promise<void>;
}

function Waiting({ repairId, r, onUpdate }: WaitingProps) {
  const parts = r.parts || {
    part: "Spare part",
    reason: "Waiting for parts",
    eta: "Tomorrow",
    note: "",
    revisedCompletion: "",
    since: Date.now(),
  };
  const [eta, setEta] = useState(parts.eta);
  const [submitting, setSubmitting] = useState(false);

  const handleUpdateEta = async () => {
    if (!eta.trim() || submitting) return;
    setSubmitting(true);
    try {
      await updatePartsEta(repairId, { eta: eta.trim() });
      toast("ETA updated for farmer");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to update parts ETA:", err);
      toast.error(err?.message || "Failed to update ETA");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResume = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await resumeRepair(repairId);
      toast.success("Work resumed");
      await onUpdate();
    } catch (err: any) {
      console.error("[TerraByte] Failed to resume repair:", err);
      toast.error(err?.message || "Failed to resume repair");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="space-y-3 border-warning">
      <p className="flex items-center gap-2 text-lg font-bold">
        <PackageSearch className="h-5 w-5" /> Paused for {parts.part}
      </p>
      <p className="text-sm text-muted-foreground">
        {parts.reason} · paused {ago(parts.since)} ago
      </p>
      <div className="space-y-1.5">
        <Label>Expected arrival</Label>
        <div className="flex gap-2">
          <DateTimePicker
            value={eta}
            onChange={(val) => setEta(val)}
          />
          <button
            disabled={!eta.trim() || submitting}
            onClick={handleUpdateEta}
            className={cn(btn.ghost, "h-11 shrink-0 whitespace-nowrap disabled:opacity-50")}
          >
            {submitting ? "Updating…" : "Update ETA"}
          </button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Current: <b className="text-foreground">{formatEta(parts.eta)}</b></span>
        </div>
      </div>
      <button
        disabled={submitting}
        onClick={handleResume}
        className={cn(btn.primary, "h-14 w-full text-lg disabled:opacity-50")}
      >
        {submitting ? "Resuming…" : "Parts received — Resume repair"}
      </button>
    </Card>
  );
}
