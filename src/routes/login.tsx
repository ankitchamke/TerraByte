import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Radio, Tractor, Wrench } from "lucide-react";
import { useState } from "react";
import { actions, useTB, type Role } from "@/lib/tb-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — TerraByte" },
      {
        name: "description",
        content: "Sign in to TerraByte as a farmer, technician or service centre.",
      },
      { property: "og:title", content: "Sign in — TerraByte" },
      {
        property: "og:description",
        content: "Choose a demo role to explore the full repair workflow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Login,
});

function Login() {
  const s = useTB();
  const nav = useNavigate();
  const [role, setRole] = useState<Role>("farmer");
  const people =
    role === "farmer"
      ? s.farmers.map((f) => ({ id: f.id, name: f.name, sub: f.village }))
      : role === "technician"
        ? s.technicians.map((t) => ({ id: t.id, name: t.name, sub: t.workshop }))
        : [{ id: "admin", name: "Nashik Service Centre", sub: "Operations command centre" }];
  const [who, setWho] = useState<string>("f1");
  const pick = (r: Role) => {
    setRole(r);
    setWho(r === "farmer" ? "f1" : r === "technician" ? "t1" : "admin");
  };
  const go = () => {
    actions.login(role, who);
    nav({ to: `/${role}` as "/farmer" });
  };

  const roles = [
    {
      r: "farmer" as Role,
      icon: Tractor,
      t: "Farmer",
      d: "Report breakdowns, approve quotes, track repairs",
    },
    {
      r: "technician" as Role,
      icon: Wrench,
      t: "Technician",
      d: "Accept jobs, quote, update repair status",
    },
    {
      r: "admin" as Role,
      icon: Radio,
      t: "Service Centre",
      d: "Dispatch, exceptions & parts blockers",
    },
  ];
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative flex flex-col justify-between overflow-hidden bg-soil p-8 text-soil-foreground lg:p-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(115deg, currentColor 0 2px, transparent 2px 22px)",
          }}
        />
        <div className="relative flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Tractor className="h-5 w-5" />
          </span>
          <span className="font-display text-2xl font-bold">TerraByte</span>
        </div>
        <div className="relative my-12">
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.25em] text-accent">
            Breakdown → Back to work
          </p>
          <h1 className="font-display text-4xl font-extrabold leading-[1.02] sm:text-6xl">
            Every hour a machine sits broken is an hour the field waits.
          </h1>
          <p className="mt-6 max-w-lg text-lg opacity-80">
            TerraByte coordinates the whole repair — assessment, the right technician, a quote you
            approve, live progress, and a permanent record on the machine.
          </p>
        </div>
        <ol className="relative flex flex-wrap gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-wider opacity-70">
          {["Report", "Assess", "Match", "Quote", "Approve", "Repair", "History"].map((x, i) => (
            <li key={x}>
              {String(i + 1).padStart(2, "0")} {x}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <h2 className="font-display text-3xl font-bold">Sign in</h2>
          <p className="mt-1 text-muted-foreground">
            Hackathon MVP — pick a demo role. All people and data are simulated.
          </p>
          <div className="mt-6 space-y-2">
            {roles.map(({ r, icon: I, t, d }) => (
              <button
                key={r}
                onClick={() => pick(r)}
                className={cn(
                  "flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition",
                  role === r
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <span
                  className={cn(
                    "grid h-12 w-12 shrink-0 place-items-center rounded-xl",
                    role === r ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  <I className="h-6 w-6" />
                </span>
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="text-sm text-muted-foreground">{d}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="mb-2 mt-6 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Continue as (demo)
          </p>
          <div className="space-y-1.5">
            {people.map((p) => (
              <label
                key={p.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3",
                  who === p.id ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <input
                  type="radio"
                  className="accent-[var(--primary)]"
                  checked={who === p.id}
                  onChange={() => setWho(p.id)}
                />
                <span className="text-sm">
                  <b>{p.name}</b> <span className="text-muted-foreground">· {p.sub}</span>
                </span>
              </label>
            ))}
          </div>
          <button
            onClick={go}
            className="mt-6 inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Enter workspace <ArrowRight className="h-5 w-5" />
          </button>
          <p className="mt-4 text-xs text-muted-foreground">
            Tip: open two tabs as farmer and technician to watch the workflow update live.
          </p>
        </div>
      </div>
    </div>
  );
}
