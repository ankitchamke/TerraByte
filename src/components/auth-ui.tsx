import { Link } from "@tanstack/react-router";
import { Tractor } from "lucide-react";
import type { ReactNode } from "react";

/** Shared split-screen frame for sign in / registration — matches the original TerraByte login look. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative flex flex-col justify-between overflow-hidden bg-soil p-8 text-soil-foreground lg:p-14">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(115deg, currentColor 0 2px, transparent 2px 22px)" }} />
        <Link to="/" className="relative flex items-center gap-2 hover:opacity-90 transition-opacity">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground"><Tractor className="h-5 w-5" /></span>
          <span className="font-display text-2xl font-bold">TerraByte</span>
        </Link>
        <div className="relative my-12">
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.25em] text-accent">Breakdown → Back to work</p>
          <h1 className="font-display text-4xl font-extrabold leading-[1.02] sm:text-6xl">Every hour a machine sits broken is an hour the field waits.</h1>
          <p className="mt-6 max-w-lg text-lg opacity-80">TerraByte coordinates the whole repair — assessment, the right technician, a quote you approve, live progress, and a permanent record on the machine.</p>
        </div>
        <ol className="relative flex flex-wrap gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-wider opacity-70">
          {["Report", "Assess", "Match", "Quote", "Approve", "Repair", "History"].map((x, i) => <li key={x}>{String(i + 1).padStart(2, "0")} {x}</li>)}
        </ol>
      </div>
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <input
        {...props}
        className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{children}</p>;
}
