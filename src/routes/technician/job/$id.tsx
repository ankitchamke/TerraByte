import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Camera, Lock, PackageSearch, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AssessmentCard, QuoteTable, Timeline } from "@/components/repair-parts";
import { btn, CallButton, Card, input, Label, StatusPill } from "@/components/tb";
import { fileToSmallDataUrl } from "@/lib/image";
import { actions, ago, inr, quoteTotals, useTB, type Quote, type QuotePart, type Repair } from "@/lib/tb-store";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/technician/job/$id")({
  head: () => meta("Job", "Repair job details and actions."),
  component: Job,
});

function Job() {
  const { id } = Route.useParams();
  const s = useTB();
  const nav = useNavigate();
  const r = s.repairs.find((x) => x.id === id);
  const [declineOpen, setDeclineOpen] = useState(false);
  if (!r || (r.technicianId !== s.session!.userId && r.status !== "COMPLETED")) return <Card>This job isn't assigned to you. <Link to="/technician" className="font-semibold text-primary">Back to jobs</Link></Card>;
  const e = s.equipment.find((x) => x.id === r.equipmentId)!;
  const f = s.farmers.find((x) => x.id === r.farmerId)!;

  return (
    <div className="space-y-5">
      <Link to="/technician" className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Jobs</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="font-mono text-sm text-muted-foreground">Job {r.id} · {ago(r.createdAt)} ago</p><h1 className="text-3xl font-bold">{e.make} {e.model}</h1><p className="text-sm text-muted-foreground">{e.type} · {e.year} · {e.hours.toLocaleString("en-IN")} hrs · <span className="font-mono">{e.serial}</span></p></div>
        <StatusPill r={r} audience="staff" />
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Farmer</Label><p className="font-semibold">{f.name}</p><p className="text-sm text-muted-foreground">{r.location}</p></div>
          <div className="flex items-end"><CallButton phone={f.phone} label="Call farmer" className="w-full" /></div>
          <div className="sm:col-span-2"><Label>Reported symptoms</Label><div className="flex flex-wrap gap-1.5">{r.symptoms.map((x) => <span key={x} className="rounded-lg bg-destructive/10 px-2 py-1 text-sm font-semibold text-destructive">{x}</span>)}</div></div>
          {r.description && <div className="sm:col-span-2"><Label>Farmer's description</Label><p>"{r.description}"</p></div>}
          {r.photos.length > 0 && <div className="flex flex-wrap gap-2 sm:col-span-2">{r.photos.map((p, i) => <img key={i} src={p} alt="Problem" className="h-28 w-28 rounded-xl object-cover" />)}</div>}
        </div>
      </Card>

      {r.status === "REQUESTED" && (
        declineOpen ? <DeclineBox r={r} onDone={() => nav({ to: "/technician" })} onCancel={() => setDeclineOpen(false)} /> : (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setDeclineOpen(true)} className={btn.ghost}>Decline job</button>
            <button onClick={() => { actions.accept(r.id); toast.success("Job accepted. Farmer notified."); }} className={cn(btn.primary, "h-14 text-lg")}>Accept job</button>
          </div>
        )
      )}

      <AssessmentCard r={r} />

      {(r.status === "ACCEPTED" || r.status === "QUOTE_REVISED") && <QuoteBuilder r={r} />}

      {r.status === "QUOTE_PENDING" && r.quote && (
        <Card className="border-accent">
          <p className="mb-3 flex items-center gap-2 font-semibold"><Lock className="h-4 w-4" /> Waiting for farmer approval — repair work is locked until approved.</p>
          <QuoteTable q={r.quote} />
        </Card>
      )}

      {r.status === "IN_PROGRESS" && <InProgress r={r} />}
      {r.status === "WAITING_FOR_PARTS" && r.parts && <Waiting r={r} />}

      {r.status === "COMPLETED" && r.quote && (
        <Card className="border-success"><p className="font-bold text-success">Completed · {inr(quoteTotals(r.quote).total)}</p><p className="text-sm">{r.completion?.notes}</p><p className="mt-2 text-sm text-muted-foreground">{r.verifiedAt ? "Farmer confirmed handover." : "Awaiting farmer handover confirmation."}</p></Card>
      )}

      {r.notes.length > 0 && <Card><Label>Your notes</Label><ul className="space-y-2 text-sm">{r.notes.map((n, i) => <li key={i}>• {n.text} <span className="text-muted-foreground">({ago(n.at)} ago)</span></li>)}</ul></Card>}
      <details className="rounded-2xl border border-border bg-card p-5"><summary className="cursor-pointer font-semibold">Status timeline</summary><div className="mt-4"><Timeline r={r} /></div></details>
    </div>
  );
}

function DeclineBox({ r, onDone, onCancel }: { r: Repair; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  return (
    <Card className="space-y-3">
      <Label>Reason for declining</Label>
      <div className="grid grid-cols-2 gap-2">{["Out of service area", "Wrong specialization", "Fully booked", "Other"].map((x) => <button key={x} onClick={() => setReason(x)} className={cn("min-h-12 rounded-xl border-2 p-2 text-sm font-semibold", reason === x ? "border-primary bg-primary/10" : "border-border")}>{x}</button>)}</div>
      {reason === "Other" && <input className={input} maxLength={120} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Reason" />}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCancel} className={btn.ghost}>Back</button>
        <button disabled={!reason || (reason === "Other" && !other.trim())} onClick={() => { actions.decline(r.id, reason === "Other" ? other.trim() : reason); toast("Declined — returned to dispatch"); onDone(); }} className={btn.amber}>Confirm decline</button>
      </div>
    </Card>
  );
}

const blankPart = (): QuotePart => ({ name: "", spec: "", qty: 1, price: 0, source: "In van stock" });
function QuoteBuilder({ r }: { r: Repair }) {
  const [q, setQ] = useState<Omit<Quote, "version" | "sentAt">>(() => r.quote
    ? { parts: r.quote.parts, labourDesc: r.quote.labourDesc, labour: r.quote.labour, taxPct: r.quote.taxPct, eta: r.quote.eta, warranty: r.quote.warranty }
    : { parts: [{ ...blankPart(), name: r.assessment.partsCategory[0] ?? "" }], labourDesc: "Inspection, repair and test run", labour: 800, taxPct: 0, eta: "Today, 6:00 PM", warranty: "90 days on parts & labour" });
  const setPart = (i: number, p: Partial<QuotePart>) => setQ({ ...q, parts: q.parts.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  const t = quoteTotals({ ...q, version: 0, sentAt: 0 });
  const valid = q.parts.every((p) => p.name.trim() && p.qty > 0 && p.price >= 0) && q.labourDesc.trim() && q.eta.trim();
  return (
    <Card className="space-y-4 border-primary/40">
      <h2 className="text-xl font-bold">{r.status === "QUOTE_REVISED" ? "Revise quote" : "Create itemized quote"}</h2>
      {r.clarification && <p className="rounded-xl bg-accent/20 p-3 text-sm"><b>Farmer asked:</b> "{r.clarification}"</p>}
      {q.parts.map((p, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between"><Label>Part {i + 1}</Label><button aria-label="Remove part" onClick={() => setQ({ ...q, parts: q.parts.filter((_, k) => k !== i) })} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"><Trash2 className="h-4 w-4" /></button></div>
          <input className={input} placeholder="Part name" value={p.name} onChange={(e) => setPart(i, { name: e.target.value })} />
          <input className={input} placeholder="Part number / spec" value={p.spec} onChange={(e) => setPart(i, { spec: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Qty</Label><input className={input} inputMode="numeric" value={p.qty} onChange={(e) => setPart(i, { qty: Math.max(0, Number(e.target.value) || 0) })} /></div>
            <div><Label>Unit price ₹</Label><input className={input} inputMode="numeric" value={p.price} onChange={(e) => setPart(i, { price: Math.max(0, Number(e.target.value) || 0) })} /></div>
          </div>
          <select className={input} value={p.source} onChange={(e) => setPart(i, { source: e.target.value })}>{["In van stock", "Workshop stock", "Taluka distributor", "Order from OEM (2-3 days)"].map((x) => <option key={x}>{x}</option>)}</select>
        </div>
      ))}
      <button onClick={() => setQ({ ...q, parts: [...q.parts, blankPart()] })} className={cn(btn.ghost, "w-full")}><Plus className="h-4 w-4" /> Add part</button>
      <div><Label>Labour / service description</Label><input className={input} value={q.labourDesc} onChange={(e) => setQ({ ...q, labourDesc: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Labour ₹</Label><input className={input} inputMode="numeric" value={q.labour} onChange={(e) => setQ({ ...q, labour: Math.max(0, Number(e.target.value) || 0) })} /></div>
        <div><Label>GST %</Label><select className={input} value={q.taxPct} onChange={(e) => setQ({ ...q, taxPct: Number(e.target.value) })}>{[0, 5, 12, 18].map((x) => <option key={x} value={x}>{x}%</option>)}</select></div>
        <div><Label>Est. completion</Label><input className={input} value={q.eta} onChange={(e) => setQ({ ...q, eta: e.target.value })} /></div>
        <div><Label>Warranty</Label><input className={input} value={q.warranty} onChange={(e) => setQ({ ...q, warranty: e.target.value })} /></div>
      </div>
      <dl className="rounded-xl bg-muted p-3 text-sm">
        <div className="flex justify-between"><dt>Parts</dt><dd>{inr(t.parts)}</dd></div>
        <div className="flex justify-between"><dt>Labour</dt><dd>{inr(t.labour)}</dd></div>
        <div className="flex justify-between"><dt>Tax</dt><dd>{inr(t.tax)}</dd></div>
        <div className="flex justify-between font-display text-xl font-bold"><dt>Total</dt><dd>{inr(t.total)}</dd></div>
      </dl>
      <button disabled={!valid} onClick={() => { actions.sendQuote(r.id, q); toast.success("Quote sent to farmer"); }} className={cn(btn.primary, "h-14 w-full text-lg")}>Send quote to farmer</button>
    </Card>
  );
}

function InProgress({ r }: { r: Repair }) {
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"none" | "parts" | "complete">("none");
  const [p, setP] = useState({ part: r.quote?.parts[0]?.name ?? "", reason: "Not in van stock", eta: "Tomorrow 9:30 AM", note: "", revisedCompletion: "Tomorrow, 1:00 PM" });
  const [final, setFinal] = useState(""); const [photo, setPhoto] = useState(""); const [tested, setTested] = useState(false);
  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <Label>Add technician note</Label>
        <div className="flex gap-2"><input className={input} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Injector removed, spray test done" /><button disabled={!note.trim()} onClick={() => { actions.addNote(r.id, note.trim()); setNote(""); toast("Note shared with farmer"); }} className={btn.primary}>Add</button></div>
      </Card>
      {mode === "none" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <button onClick={() => setMode("parts")} className={cn(btn.amber, "h-14")}><PackageSearch className="h-5 w-5" /> Waiting for parts</button>
          {!r.testing ? <button onClick={() => actions.startTesting(r.id)} className={cn(btn.ghost, "h-14")}>Start testing</button> : <span className={cn(btn.ghost, "h-14 opacity-60")}>Testing…</span>}
          <button onClick={() => setMode("complete")} className={cn(btn.primary, "h-14")}>Mark completed</button>
        </div>
      )}
      {mode === "parts" && (
        <Card className="space-y-3 border-warning">
          <h3 className="text-lg font-bold">Pause: waiting for parts</h3>
          <div><Label>Part required</Label><input className={input} value={p.part} onChange={(e) => setP({ ...p, part: e.target.value })} /></div>
          <div><Label>Reason</Label><input className={input} value={p.reason} onChange={(e) => setP({ ...p, reason: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Expected arrival</Label><input className={input} value={p.eta} onChange={(e) => setP({ ...p, eta: e.target.value })} /></div>
            <div><Label>Revised completion</Label><input className={input} value={p.revisedCompletion} onChange={(e) => setP({ ...p, revisedCompletion: e.target.value })} /></div>
          </div>
          <div><Label>Note for farmer (optional)</Label><input className={input} value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} placeholder="Part is being picked up from Taluka distributor." /></div>
          <div className="grid grid-cols-2 gap-2"><button onClick={() => setMode("none")} className={btn.ghost}>Cancel</button><button disabled={!p.part.trim() || !p.eta.trim()} onClick={() => { actions.waitForParts(r.id, p); setMode("none"); toast("Farmer notified of the delay"); }} className={btn.amber}>Pause repair</button></div>
        </Card>
      )}
      {mode === "complete" && (
        <Card className="space-y-3 border-success">
          <h3 className="text-lg font-bold">Complete repair</h3>
          <div><Label>Final repair notes</Label><textarea rows={3} className={input} maxLength={500} value={final} onChange={(e) => setFinal(e.target.value)} placeholder="Work performed, root cause found…" /></div>
          <label className={cn(btn.ghost, "w-full cursor-pointer")}><Camera className="h-4 w-4" />{photo ? "Completion photo added ✓" : "Upload completion photo (optional)"}<input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await fileToSmallDataUrl(f)); }} /></label>
          <label className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-border p-3"><input type="checkbox" className="h-5 w-5" checked={tested} onChange={(e) => setTested(e.target.checked)} /> Machine tested under load and working</label>
          <div className="grid grid-cols-2 gap-2"><button onClick={() => setMode("none")} className={btn.ghost}>Cancel</button><button disabled={!tested || !final.trim()} onClick={() => { actions.complete(r.id, final.trim(), photo || undefined); toast.success("Repair completed. Added to machine history."); }} className={btn.primary}>Complete & hand over</button></div>
        </Card>
      )}
    </div>
  );
}

function Waiting({ r }: { r: Repair }) {
  const [eta, setEta] = useState(r.parts!.eta);
  return (
    <Card className="space-y-3 border-warning">
      <p className="flex items-center gap-2 text-lg font-bold"><PackageSearch className="h-5 w-5" /> Paused for {r.parts!.part}</p>
      <p className="text-sm text-muted-foreground">{r.parts!.reason} · paused {ago(r.parts!.since)} ago</p>
      <div className="flex gap-2"><input className={input} value={eta} onChange={(e) => setEta(e.target.value)} /><button onClick={() => { actions.updatePartsEta(r.id, eta, "technician"); toast("ETA updated for farmer"); }} className={btn.ghost}>Update ETA</button></div>
      <button onClick={() => { actions.resume(r.id); toast.success("Work resumed"); }} className={cn(btn.primary, "h-14 w-full text-lg")}>Part arrived — resume repair</button>
    </Card>
  );
}
