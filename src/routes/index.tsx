import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  FileCheck,
  Loader2,
  Radio,
  Search,
  Sparkles,
  Tractor,
  Users,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { homeFor, signOut, useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "TerraByte — Get your farm machine back to work" },
      {
        name: "description",
        content:
          "Report a breakdown, find the right technician, approve the repair, and get back to work.",
      },
      { property: "og:title", content: "TerraByte — Get your farm machine back to work" },
      {
        property: "og:description",
        content:
          "Report a breakdown, find the right technician, approve the repair, and get back to work.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

/**
 * Editorial, story-driven agricultural visual:
 * Machine breakdown -> technician on-site repair -> farmer gets machine back to work.
 * Clean vector illustration with zero external dependencies, no fake statistics, and no artificial telemetry badges.
 */
function AgriculturalHeroVisual({ isCompact }: { isCompact?: boolean }) {
  return (
    <div className="relative w-full h-full select-none overflow-hidden bg-card flex items-center justify-center">
      <img
        src="/terrabyte-hero.png"
        alt="Illustration showing a field technician and farmer repairing agricultural equipment"
        className="w-full h-full object-cover"
        loading="eager"
      />
    </div>
  );
}

function HomePage() {
  const nav = useNavigate();
  const { ready, userId, emailConfirmed, profile, profileError } = useAuth();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoErr, setDemoErr] = useState<string | null>(null);
  const demoSigningInRef = useRef(false);

  // Authenticated root routing:
  // 1. If returning from a demo session via Back button or explicit return,
  //    sign out the temporary demo session so the user lands cleanly on Home.
  // 2. Otherwise, route standard authenticated users directly to their assigned workspace.
  useEffect(() => {
    if (!ready || demoSigningInRef.current) return;

    const isDemoOrigin =
      typeof window !== "undefined" && sessionStorage.getItem("tb_demo_origin") === "home";

    if (isDemoOrigin && userId) {
      if (typeof window !== "undefined") sessionStorage.removeItem("tb_demo_origin");
      void signOut();
      return;
    }

    if (userId && profile && emailConfirmed) {
      void nav({ to: homeFor(profile) });
    } else if (userId && !emailConfirmed) {
      void nav({ to: "/login", search: { unconfirmed: "true" } as any });
    } else if (userId && profileError) {
      void nav({ to: "/login" });
    }
  }, [ready, userId, profile, emailConfirmed, profileError, nav]);

  // Safe demo sign-in reusing existing Supabase Auth accounts
  const handleDemoSignIn = async (
    email: string,
    pass: string,
    targetPath: "/farmer" | "/technician" | "/admin"
  ) => {
    setDemoBusy(true);
    setDemoErr(null);
    demoSigningInRef.current = true;
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: pass,
      });
      if (error) {
        demoSigningInRef.current = false;
        setDemoErr(error.message);
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("tb_demo_origin");
        }
        return;
      }
      if (typeof window !== "undefined") {
        sessionStorage.setItem("tb_demo_origin", "home");
      }
      await nav({ to: targetPath });
    } catch (err: unknown) {
      demoSigningInRef.current = false;
      setDemoErr(err instanceof Error ? err.message : "Failed to sign in to demo account");
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("tb_demo_origin");
      }
    } finally {
      setDemoBusy(false);
    }
  };

  // While checking auth status or during initial redirect of genuine authenticated user
  const isDemoOriginCheck =
    typeof window !== "undefined" && sessionStorage.getItem("tb_demo_origin") === "home";

  if (!ready || (userId && profile && emailConfirmed && !isDemoOriginCheck)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center space-y-3">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground animate-pulse">
            <Tractor className="h-6 w-6" />
          </div>
          <p className="font-mono text-sm text-muted-foreground">
            {userId && profile ? "Opening your workspace…" : "Loading TerraByte…"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-x-hidden">
      {/* 1. Header with branding & primary nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 sm:h-16 max-w-6xl items-center justify-between px-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2 sm:gap-2.5">
            <span className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs shrink-0">
              <Tractor className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
            </span>
            <div className="leading-tight">
              <span className="font-display text-lg sm:text-xl font-bold tracking-tight block">
                TerraByte
              </span>
              <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground block">
                Nagpur RISE 2026
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Link
              to="/login"
              className="inline-flex h-9 sm:h-10 items-center justify-center rounded-xl border-2 border-border bg-card px-3 sm:px-4 text-xs sm:text-sm font-semibold text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-all duration-200"
            >
              Sign In
            </Link>
            <Link
              to="/register/farmer"
              className="inline-flex h-9 sm:h-10 items-center justify-center rounded-xl bg-primary px-3 sm:px-4 text-xs sm:text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all duration-200 shadow-xs"
            >
              Register <span className="hidden sm:inline ml-1">as Farmer</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Home Content */}
      <main className="flex-1">
        {/* 2. Hero Section - Balanced Desktop & Compact Mobile */}
        <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-soil/5 via-transparent to-transparent py-6 sm:py-10 lg:py-16">
          <div className="mx-auto max-w-6xl px-3 sm:px-6">
            <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 items-center">
              {/* Left Column: Headline, Punchy 1-line copy, and Actions */}
              <div className="lg:col-span-7">
                <div className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-primary/30 bg-primary/10 px-2.5 sm:px-3 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold text-primary font-mono uppercase tracking-wider">
                  <Sparkles className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" /> Coordinated Farm Equipment Repair
                </div>

                <h1 className="mt-3 sm:mt-4 font-display text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-balance leading-[1.14]">
                  Every hour a machine sits broken is an hour the field waits.
                </h1>

                {/* Refined concise supporting copy */}
                <p className="mt-2.5 sm:mt-4 text-sm sm:text-base lg:text-lg text-muted-foreground leading-relaxed font-medium">
                  Report a breakdown, find the right technician, approve the repair, and get back to work.
                </p>

                {/* Mobile-only compact visual placement so context is immediate without extra scroll */}
                <div className="block lg:hidden my-4 w-full aspect-[3/2] rounded-2xl overflow-hidden border border-border/80 bg-card shadow-xs">
                  <AgriculturalHeroVisual isCompact />
                </div>

                {/* Primary Call to Actions */}
                <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3">
                  <Link
                    to="/login"
                    className="inline-flex h-11 sm:h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm sm:text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-all duration-200 shadow-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    Sign in to TerraByte <ArrowRight className="h-4 w-4" />
                  </Link>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
                    <Link
                      to="/register/farmer"
                      className="inline-flex h-11 sm:h-12 items-center justify-center rounded-xl border-2 border-border bg-card px-3 sm:px-4 text-xs sm:text-sm font-semibold text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-all duration-200 text-center active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      Register as Farmer
                    </Link>
                    <Link
                      to="/register/technician"
                      className="inline-flex h-11 sm:h-12 items-center justify-center rounded-xl border-2 border-border bg-card px-3 sm:px-4 text-xs sm:text-sm font-semibold text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-all duration-200 text-center active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      Register as Tech
                    </Link>
                  </div>
                </div>

                {/* Quick Demo Access Card */}
                <div className="mt-5 sm:mt-8 rounded-2xl border border-dashed border-border bg-card/70 p-3.5 sm:p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Quick Demo Evaluation · 1-Click Access
                    </p>
                    {demoBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  </div>
                  <p className="mt-1 text-[11px] sm:text-xs text-muted-foreground">
                    Instantly authenticate using pre-seeded Nagpur test accounts:
                  </p>
                  {demoErr && (
                    <p className="mt-2 text-xs font-medium text-destructive bg-destructive/10 p-2 rounded-lg">
                      {demoErr}
                    </p>
                  )}
                  <div className="mt-2.5 grid grid-cols-3 gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      disabled={demoBusy}
                      onClick={() =>
                        void handleDemoSignIn(
                          "farmer.nagpur@terrabyte.demo",
                          "TerraByte@2026",
                          "/farmer"
                        )
                      }
                      className="flex h-10 sm:h-11 items-center justify-center gap-1.5 rounded-xl border-2 border-border bg-card px-2 text-[11px] sm:text-xs font-semibold text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-all duration-200 disabled:opacity-60 active:scale-[0.98]"
                    >
                      <Tractor className="h-3.5 w-3.5 text-primary shrink-0" /> Farmer
                    </button>
                    <button
                      type="button"
                      disabled={demoBusy}
                      onClick={() =>
                        void handleDemoSignIn(
                          "tech.nagpur@terrabyte.demo",
                          "TerraByte@2026",
                          "/technician"
                        )
                      }
                      className="flex h-10 sm:h-11 items-center justify-center gap-1.5 rounded-xl border-2 border-border bg-card px-2 text-[11px] sm:text-xs font-semibold text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-all duration-200 disabled:opacity-60 active:scale-[0.98]"
                    >
                      <Wrench className="h-3.5 w-3.5 text-accent-foreground shrink-0" /> Technician
                    </button>
                    <button
                      type="button"
                      disabled={demoBusy}
                      onClick={() =>
                        void handleDemoSignIn(
                          "admin.nagpur@terrabyte.demo",
                          "TerraByte@2026",
                          "/admin"
                        )
                      }
                      className="flex h-10 sm:h-11 items-center justify-center gap-1.5 rounded-xl border-2 border-border bg-card px-2 text-[11px] sm:text-xs font-semibold text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-all duration-200 disabled:opacity-60 active:scale-[0.98]"
                    >
                      <Radio className="h-3.5 w-3.5 text-info shrink-0" /> Service Centre
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Desktop Agricultural Repair Illustration */}
              <div className="hidden lg:block lg:col-span-5">
                <div className="w-full aspect-[3/2] rounded-3xl overflow-hidden border border-border/80 bg-card shadow-md">
                  <AgriculturalHeroVisual />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. "How TerraByte Works" — Visual-First, Scannable 5 Stages */}
        <section className="border-b border-border py-10 sm:py-14 bg-muted/20">
          <div className="mx-auto max-w-6xl px-3 sm:px-6">
            <div className="max-w-2xl">
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-primary">
                Unbroken Repair Coordination
              </p>
              <h2 className="mt-1 sm:mt-1.5 font-display text-2xl sm:text-3xl font-bold tracking-tight">
                How TerraByte works
              </h2>
            </div>

            {/* 5 Stages with clean visual flow indicators */}
            <div className="mt-6 sm:mt-8 grid gap-2.5 sm:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
              {[
                {
                  step: "01",
                  title: "Report",
                  desc: "Tell us what's wrong.",
                  icon: Tractor,
                },
                {
                  step: "02",
                  title: "Diagnose",
                  desc: "Identify the likely issue.",
                  icon: Search,
                },
                {
                  step: "03",
                  title: "Match",
                  desc: "Connect with the right technician.",
                  icon: Users,
                },
                {
                  step: "04",
                  title: "Repair",
                  desc: "Approve and track the repair.",
                  icon: Wrench,
                },
                {
                  step: "05",
                  title: "Back to Work",
                  desc: "Keep a digital service record.",
                  icon: CheckCircle2,
                },
              ].map((item, idx) => (
                <div
                  key={item.step}
                  className="relative rounded-2xl border border-border bg-card p-4 flex flex-col justify-between shadow-2xs hover:border-primary/40 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-muted-foreground">
                        {item.step}
                      </span>
                      <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
                        <item.icon className="h-4 w-4" />
                      </div>
                    </div>
                    <h3 className="mt-3 font-display font-bold text-base text-foreground">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground font-medium">
                      "{item.desc}"
                    </p>
                  </div>

                  {/* Flow arrow indicator between stages on desktop */}
                  {idx < 4 && (
                    <div className="hidden lg:flex items-center justify-center absolute left-[calc(100%+0.375rem)] top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 h-5 w-5 rounded-full border border-border bg-background text-muted-foreground shadow-2xs pointer-events-none">
                      <ChevronRight className="h-3 w-3" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. Simplified Participant Section with Visual Keywords */}
        <section className="py-10 sm:py-16">
          <div className="mx-auto max-w-6xl px-3 sm:px-6">
            <div className="max-w-2xl">
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-primary">
                Ecosystem Participants
              </p>
              <h2 className="mt-1 sm:mt-1.5 font-display text-2xl sm:text-3xl font-bold tracking-tight">
                Designed for everyone in the repair lifecycle
              </h2>
            </div>

            <div className="mt-6 sm:mt-8 grid gap-4 sm:gap-6 md:grid-cols-3">
              {/* Farmer Card */}
              <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                    <Tractor className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-display text-xl font-bold">Farmer</h3>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    "Get your machine repaired faster."
                  </p>

                  {/* Visual Keywords */}
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {["Report", "Track", "Approve"].map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary"
                      >
                        <Check className="h-3 w-3" /> {kw}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border">
                  <Link
                    to="/register/farmer"
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all duration-200 shadow-xs active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    Register as Farmer
                  </Link>
                </div>
              </div>

              {/* Technician Card */}
              <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent/20 text-accent-foreground">
                    <Wrench className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-display text-xl font-bold">Technician</h3>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    "Find repair jobs that match your skills."
                  </p>

                  {/* Visual Keywords */}
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {["Receive", "Repair", "Update"].map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent-foreground"
                      >
                        <Check className="h-3 w-3" /> {kw}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border">
                  <Link
                    to="/register/technician"
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 text-sm font-semibold text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-xs transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    Register as Technician
                  </Link>
                </div>
              </div>

              {/* Service Centre Card */}
              <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-info/15 text-info">
                    <Radio className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-display text-xl font-bold">Service Centre</h3>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    "Coordinate repairs across your area."
                  </p>

                  {/* Visual Keywords */}
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {["Dispatch", "Monitor", "Manage"].map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center gap-1 rounded-lg border border-info/30 bg-info/10 px-2.5 py-1 text-xs font-semibold text-info"
                      >
                        <Check className="h-3 w-3" /> {kw}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border">
                  <Link
                    to="/login"
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 text-sm font-semibold text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-xs transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    Service Centre Sign In
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 6. Minimal Footer */}
      <footer className="border-t border-border bg-card/40 py-6 sm:py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-3 text-center sm:flex-row sm:text-left sm:px-6">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 sm:h-7 sm:w-7 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Tractor className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </span>
            <span className="font-display font-bold text-xs sm:text-sm">TerraByte</span>
            <span className="text-[11px] sm:text-xs text-muted-foreground">· Nagpur RISE 2026</span>
          </div>
          <p className="text-[11px] sm:text-xs text-muted-foreground">
            Agricultural machinery repair coordination platform for Vidarbha.
          </p>
          <div className="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-xs font-semibold text-muted-foreground">
            <Link to="/login" className="hover:text-foreground transition-colors">
              Sign In
            </Link>
            <Link to="/register/farmer" className="hover:text-foreground transition-colors">
              Farmer
            </Link>
            <Link to="/register/technician" className="hover:text-foreground transition-colors">
              Technician
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
