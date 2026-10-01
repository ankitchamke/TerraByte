import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Bell, Check, LogOut, Phone, RotateCcw, Tractor, WifiOff, Wrench, Radio } from "lucide-react";
import { actions, ago, FARMER_LABEL, resetDemo, STAFF_LABEL, useTB, type Repair, type RepairStatus, type Role } from "@/lib/tb-store";
import { homeFor, signOut, useAuth, type AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const u = () => setOn(navigator.onLine);
    u();
    window.addEventListener("online", u); window.addEventListener("offline", u);
    return () => { window.removeEventListener("online", u); window.removeEventListener("offline", u); };
  }, []);
  return on;
}

/** Demo persona each authenticated role is bound to, so the existing demo workflow data still renders. */
const PERSONA: Record<Role, string> = { farmer: "f1", technician: "t1", admin: "admin" };
const APP_ROLE: Record<Role, AppRole> = { farmer: "farmer", technician: "technician", admin: "service_centre" };

/**
 * UX-level guard. Real authorization is enforced by database row-level security;
 * the role always comes from the authenticated profile row, never from local state.
 */
export function RoleGuard({ role, children, allowUnverified }: { role: Role; children: ReactNode; allowUnverified?: boolean }) {
  const { ready, userId, emailConfirmed, profile, profileError } = useAuth();
  const s = useTB();
  const nav = useNavigate();
  const loc = useLocation();
  const ok = !!profile && profile.role === APP_ROLE[role] && emailConfirmed;
  const sessionRole = s.session?.role;
  const isPending = loc.pathname === "/technician/pending";

  let target: string | null = null;
  if (ready) {
    if (!userId || profileError || !profile) {
      target = "/login";
    } else if (!emailConfirmed) {
      target = "/login?unconfirmed=true";
    } else if (profile.role !== APP_ROLE[role]) {
      target = homeFor(profile);
    } else if (profile.role === "technician") {
      if (!profile.is_verified && !isPending && !allowUnverified) {
        target = "/technician/pending";
      } else if (profile.is_verified && isPending) {
        target = "/technician";
      }
    }
  }

  useEffect(() => {
    if (ok && sessionRole !== role && (!isPending || profile?.is_verified)) {
      actions.login(role, PERSONA[role]);
    }
  }, [ok, sessionRole, role, isPending, profile?.is_verified]);

  useEffect(() => {
    if (target && target !== loc.pathname) {
      nav({ to: target as "/login", replace: true });
    }
  }, [target, loc.pathname, nav]);

  if (!ready || (target && target !== loc.pathname)) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }
  if (!isPending && sessionRole !== role && ok) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }
  return <>{children}</>;
}


export function DemoTag({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center rounded-sm border border-dashed border-current px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider opacity-70", className)}>Demo data</span>;
}

export function Shell({ role, children, wide }: { role: Role; children: ReactNode; wide?: boolean }) {
  const s = useTB();
  const { profile, email } = useAuth();
  const online = useOnline();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const uid = s.session?.userId;
  const mine = s.notifications.filter((n) => n.role === role && (!n.userId || n.userId === uid));
  const unread = mine.filter((n) => !n.read).length;
  const who = profile?.full_name?.trim() || email || "Signed in";
  const home = `/${role}` as "/farmer";
  return (
    <div className="min-h-screen bg-background">
      {!online && (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-semibold text-warning-foreground">
          <WifiOff className="h-4 w-4" /> Offline — your entries are saved on this phone and will sync when signal returns
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className={cn("mx-auto flex h-16 items-center gap-3 px-4", wide ? "max-w-7xl" : "max-w-3xl")}>
          <Link to={home} className="flex min-w-0 items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              {role === "technician" ? <Wrench className="h-5 w-5" /> : role === "admin" ? <Radio className="h-5 w-5" /> : <Tractor className="h-5 w-5" />}
            </span>
            <span className="min-w-0">
              <span className="block font-display text-lg font-bold leading-none">TerraByte</span>
              <span className="block truncate text-xs text-muted-foreground">{who}</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button aria-label="Notifications" onClick={() => { setOpen(!open); if (!open) actions.markRead(role, uid); }} className="relative grid h-11 w-11 place-items-center rounded-lg hover:bg-muted">
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{unread}</span>}
              </button>
              {open && (
                <div className="absolute right-0 top-12 z-50 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                  <div className="border-b border-border px-4 py-2 text-sm font-semibold">Notifications</div>
                  <div className="max-h-96 overflow-y-auto">
                    {mine.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p>}
                    {mine.map((n) => (
                      <button key={n.id} onClick={() => { setOpen(false); if (n.link) nav({ to: n.link as "/" }); }} className="block w-full border-b border-border px-4 py-3 text-left text-sm last:border-0 hover:bg-muted">
                        <span className="block">{n.text}</span>
                        <span className="text-xs text-muted-foreground">{ago(n.at)} ago</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button aria-label="Reset demo data" title="Reset demo data" onClick={() => { if (confirm("Reset all demo data?")) resetDemo(); }} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-muted"><RotateCcw className="h-5 w-5" /></button>
            <button aria-label="Sign out" title="Sign out" onClick={() => { actions.logout(); void signOut().then(() => nav({ to: "/login" })); }} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-muted"><LogOut className="h-5 w-5" /></button>
          </div>
        </div>
      </header>
      <main className={cn("mx-auto px-4 pb-24 pt-6", wide ? "max-w-7xl" : "max-w-3xl")}>{children}</main>
    </div>
  );
}

const TONE: Record<RepairStatus, string> = {
  REQUESTED: "bg-info/15 text-info border-info/30",
  ACCEPTED: "bg-info/15 text-info border-info/30",
  QUOTE_PENDING: "bg-accent/25 text-accent-foreground border-accent/50",
  QUOTE_REVISED: "bg-accent/25 text-accent-foreground border-accent/50",
  IN_PROGRESS: "bg-primary/12 text-primary border-primary/30",
  WAITING_FOR_PARTS: "bg-warning/20 text-warning-foreground border-warning/50",
  COMPLETED: "bg-success/15 text-success border-success/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};
export function StatusPill({ r, audience }: { r: Pick<Repair, "status" | "testing">; audience: "farmer" | "staff" }) {
  const label = r.testing && r.status === "IN_PROGRESS" ? (audience === "farmer" ? "Testing Your Machine" : "Testing") : (audience === "farmer" ? FARMER_LABEL : STAFF_LABEL)[r.status];
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold", TONE[r.status])}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />{label}</span>;
}

export const STEPS = ["Request Sent", "Technician Assigned", "Quote Ready", "Quote Approved", "Repair in Progress", "Testing", "Repaired"];
export function stepIndex(r: Repair) {
  switch (r.status) {
    case "REQUESTED": return r.technicianId ? 0 : 0;
    case "ACCEPTED": return 1;
    case "QUOTE_PENDING": case "QUOTE_REVISED": return 2;
    case "IN_PROGRESS": return r.testing ? 5 : 4;
    case "WAITING_FOR_PARTS": return 4;
    case "COMPLETED": return 6;
    default: return 0;
  }
}
export function Stepper({ r }: { r: Repair }) {
  const i = stepIndex(r);
  const paused = r.status === "WAITING_FOR_PARTS";
  return (
    <ol className="space-y-0">
      {STEPS.map((s, k) => {
        const done = k < i || (k === 6 && r.status === "COMPLETED");
        const cur = k === i && !done;
        return (
          <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
            {k < STEPS.length - 1 && <span className={cn("absolute left-[13px] top-7 h-[calc(100%-20px)] w-0.5", k < i ? "bg-primary" : "bg-border")} />}
            <span className={cn("relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold",
              done ? "border-primary bg-primary text-primary-foreground" : cur ? (paused ? "border-warning bg-warning text-warning-foreground animate-pulse" : "border-primary bg-background text-primary ring-4 ring-primary/20") : "border-border bg-background text-muted-foreground")}>
              {done ? <Check className="h-4 w-4" /> : k + 1}
            </span>
            <span className={cn("pt-0.5 text-sm", cur ? "font-bold" : done ? "font-medium" : "text-muted-foreground")}>
              {s}{cur && paused && <span className="ml-2 rounded bg-warning/25 px-1.5 py-0.5 text-xs font-semibold">Paused</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function CallButton({ phone, label = "Call", className }: { phone: string; label?: string; className?: string }) {
  return <a href={`tel:${phone.replace(/\s/g, "")}`} className={cn("inline-flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 font-semibold hover:bg-muted", className)}><Phone className="h-4 w-4" />{label}</a>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-border bg-card p-5 text-card-foreground", className)}>{children}</section>;
}
export function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{children}</p>;
}
export const btn = {
  primary: "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40",
  urgent: "inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-destructive px-5 text-lg font-bold text-destructive-foreground hover:bg-destructive/90",
  ghost: "inline-flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 font-semibold hover:bg-muted disabled:opacity-40",
  amber: "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-foreground hover:bg-accent/90",
};
export const input = "w-full rounded-xl border-2 border-input bg-background px-3 py-3 text-base outline-none focus:border-primary";
