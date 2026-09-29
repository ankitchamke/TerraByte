import { BadgeCheck, MapPin, Sparkles, Star } from "lucide-react";
import { Card, Label } from "@/components/tb";
import {
  fmtTime,
  inr,
  quoteTotals,
  type Quote,
  type Repair,
  type Technician,
} from "@/lib/tb-store";
import { cn } from "@/lib/utils";

export function AssessmentCard({ r, compact }: { r: Repair; compact?: boolean }) {
  const a = r.assessment;
  const sevTone =
    a.severity === "High"
      ? "bg-destructive text-destructive-foreground"
      : a.severity === "Moderate to High"
        ? "bg-warning text-warning-foreground"
        : "bg-accent text-accent-foreground";
  return (
    <Card className="border-info/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-info">
          <Sparkles className="h-4 w-4" /> Preliminary assessment
        </p>
        <span className="rounded-sm border border-dashed border-info/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-info">
          Assistive · Demo engine
        </span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Likely affected system</Label>
          <p className="text-lg font-bold">{a.system}</p>
        </div>
        <div>
          <Label>Severity</Label>
          <span className={cn("inline-block rounded-full px-3 py-1 text-sm font-bold", sevTone)}>
            {a.severity}
          </span>
        </div>
        <div className="sm:col-span-2">
          <Label>Possible issue</Label>
          <p>{a.possibleIssue}</p>
        </div>
        {!compact && (
          <div className="sm:col-span-2">
            <Label>Potential parts category</Label>
            <div className="flex flex-wrap gap-1.5">
              {a.partsCategory.map((p) => (
                <span key={p} className="rounded-lg bg-muted px-2 py-1 text-sm">
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="mt-4 rounded-xl bg-warning/15 p-3 text-sm">
        <b>Advice:</b> {a.advice}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        This is not a confirmed diagnosis. The technician will inspect and confirm the cause on
        site.
      </p>
    </Card>
  );
}

export function TechCard({
  t,
  reasons,
  children,
}: {
  t: Technician;
  reasons?: string[];
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-lg font-bold text-primary">
          {t.name
            .split(" ")
            .map((x) => x[0])
            .join("")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-lg font-bold">
            {t.name}
            {t.verified && <BadgeCheck className="h-5 w-5 text-info" aria-label="Verified" />}
          </p>
          <p className="text-sm text-muted-foreground">{t.workshop}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            t.available ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          {t.available ? "Available" : "Busy"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1">
          <MapPin className="h-4 w-4" />
          {t.distanceKm} km · ~{t.etaMin} min
        </span>
        <span className="flex items-center gap-1">
          <Star className="h-4 w-4 fill-accent text-accent" />
          {t.rating} · {t.jobsDone} repairs
        </span>
        {!t.verified && <span className="text-warning-foreground">Verification pending</span>}
      </div>
      <p className="mt-2 text-sm">
        <span className="text-muted-foreground">Brands:</span> {t.brands.join(", ")} ·{" "}
        <span className="text-muted-foreground">Expertise:</span> {t.skills.join(", ")}
      </p>
      {reasons && reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reasons.map((x) => (
            <span
              key={x}
              className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
            >
              ✓ {x}
            </span>
          ))}
        </div>
      )}
      {children}
    </Card>
  );
}

export function QuoteTable({ q }: { q: Quote }) {
  const t = quoteTotals(q);
  return (
    <div>
      <div className="space-y-2">
        {q.parts.map((p, i) => (
          <div
            key={i}
            className="flex items-start justify-between gap-3 rounded-xl bg-muted/60 p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-semibold">{p.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{p.spec}</p>
              <p className="text-xs text-muted-foreground">
                Qty {p.qty} × {inr(p.price)} · {p.source}
              </p>
            </div>
            <p className="shrink-0 font-semibold">{inr(p.qty * p.price)}</p>
          </div>
        ))}
        <div className="flex items-start justify-between gap-3 rounded-xl bg-muted/60 p-3 text-sm">
          <div>
            <p className="font-semibold">Labour</p>
            <p className="text-xs text-muted-foreground">{q.labourDesc}</p>
          </div>
          <p className="shrink-0 font-semibold">{inr(q.labour)}</p>
        </div>
      </div>
      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt>Parts subtotal</dt>
          <dd>{inr(t.parts)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Labour</dt>
          <dd>{inr(t.labour)}</dd>
        </div>
        {q.taxPct > 0 && (
          <div className="flex justify-between">
            <dt>GST {q.taxPct}%</dt>
            <dd>{inr(t.tax)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-2 font-display text-2xl font-bold">
          <dt>Total</dt>
          <dd>{inr(t.total)}</dd>
        </div>
      </dl>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <Label>Est. completion</Label>
          <p className="font-semibold">{q.eta}</p>
        </div>
        <div>
          <Label>Warranty</Label>
          <p className="font-semibold">{q.warranty || "—"}</p>
        </div>
      </div>
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        Quote v{q.version} · sent {fmtTime(q.sentAt)}
      </p>
    </div>
  );
}

export function Timeline({ r }: { r: Repair }) {
  return (
    <ol className="space-y-3 text-sm">
      {[...r.timeline].reverse().map((e, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <p>
              <b className="font-mono text-xs">{e.status}</b>{" "}
              <span className="text-muted-foreground">
                · {e.by} · {fmtTime(e.at)}
              </span>
            </p>
            {e.note && <p className="text-muted-foreground">{e.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
