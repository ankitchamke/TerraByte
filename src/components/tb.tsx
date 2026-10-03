import { Link, useNavigate, useLocation, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Info,
  Loader2,
  LogOut,
  Package,
  Phone,
  Radio,
  RotateCcw,
  ShieldCheck,
  Tractor,
  User,
  UserCheck,
  WifiOff,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { actions, ago, FARMER_LABEL, resetDemo, STAFF_LABEL, useTB, type Repair, type RepairStatus, type Role } from "@/lib/tb-store";
import { homeFor, refreshProfile, signOut, useAuth, type AppRole } from "@/lib/auth";
import {
  getNotificationCategory,
  getNotificationsForCurrentUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type NotificationCategory,
  type NotificationRow,
} from "@/lib/services/notifications";
import { isDesignatedDemoAccount, resetDemoData } from "@/lib/services/demo";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

function getCategoryBadgeConfig(category: NotificationCategory) {
  switch (category) {
    case "Breakdown":
      return {
        label: "Breakdown",
        Icon: AlertTriangle,
        badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      };
    case "Quote":
      return {
        label: "Quote",
        Icon: FileText,
        badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      };
    case "Parts":
      return {
        label: "Parts",
        Icon: Package,
        badgeClass: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-400",
      };
    case "Testing":
      return {
        label: "Testing",
        Icon: CheckCircle2,
        badgeClass: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
      };
    case "Repair":
      return {
        label: "Repair",
        Icon: Wrench,
        badgeClass: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
      };
    case "Account":
      return {
        label: "Account",
        Icon: ShieldCheck,
        badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      };
    case "Assignment":
      return {
        label: "Assignment",
        Icon: UserCheck,
        badgeClass: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
      };
    case "Alert":
      return {
        label: "Alert",
        Icon: AlertCircle,
        badgeClass: "border-destructive/30 bg-destructive/10 text-destructive",
      };
    default:
      return {
        label: "Notice",
        Icon: Info,
        badgeClass: "border-border bg-muted text-muted-foreground",
      };
  }
}
export { ImageLightbox, ClickableImage } from "./image-lightbox";
export { formatEtaDateTime, toDateTimeLocalString, valueToDateTimeLocal, getEtaPresets } from "@/lib/date-utils";
export { DateTimePicker } from "./date-time-picker";

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
      actions.login(role, profile?.demo_code || profile?.id || PERSONA[role]);
    }
  }, [ok, sessionRole, role, isPending, profile?.is_verified, profile?.demo_code, profile?.id]);

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
  const { email } = useAuth();
  if (!isDesignatedDemoAccount(email)) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-dashed border-current px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider opacity-70",
        className
      )}
    >
      Demo data
    </span>
  );
}

export function Shell({ role, children, wide }: { role: Role; children: ReactNode; wide?: boolean }) {
  const s = useTB();
  const { profile, email, userId } = useAuth();
  const online = useOnline();
  const nav = useNavigate();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Demo account detection and reset state
  const isDemo = Boolean(userId && isDesignatedDemoAccount(email));
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const handleExecuteReset = async () => {
    if (resetBusy) return;
    setResetBusy(true);
    setResetError(null);

    try {
      // 1. Call secure PostgreSQL RPC with ZERO parameters
      await resetDemoData();

      // 2. Synchronize in-memory / localStorage demo store
      resetDemo();

      // 3. Refresh authenticated profile from database
      await refreshProfile();

      // 4. Refresh shell notifications
      await fetchNotifications();

      // 5. Invalidate TanStack router cache
      await router.invalidate();

      // 6. Remount child route components so data hooks reload clean DB state
      setResetKey((prev) => prev + 1);

      // 7. Close modal and show success toast
      setResetDialogOpen(false);
      toast.success("Demo environment reset to baseline.");
    } catch (err: any) {
      console.error("[TerraByte] Demo reset failed:", err);
      const friendlyMsg = err?.message || "Failed to reset demo data. Please try again.";
      setResetError(friendlyMsg);
      toast.error(friendlyMsg);
    } finally {
      setResetBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Task 5 / Phase 4.1.5 & Phase 5.3: Real notifications for all authenticated roles
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const lastFetchedRef = useRef<number>(0);

  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    try {
      setLoadingNotifs(true);
      setNotifError(null);
      // Phase 5.3: Bounded notification query (limit 25) preserving newest entries
      const data = await getNotificationsForCurrentUser({ limit: 25 });
      setNotifications(data);
      lastFetchedRef.current = Date.now();
    } catch (err: any) {
      console.error("[TerraByte] Failed to load notifications:", err);
      setNotifError(err?.message || "Failed to load notifications");
    } finally {
      setLoadingNotifs(false);
    }
  }, [userId]);

  useEffect(() => {
    // Phase 5.3: Clear notification state immediately on user sign-out / null userId
    if (!userId) {
      setNotifications([]);
      setNotifError(null);
      setOpen(false);
      lastFetchedRef.current = 0;
      return;
    }

    // Phase 5.3: When switching to a new user, clear prior user's notifications immediately
    // so previous user's alerts never display under new user
    setNotifications([]);
    setNotifError(null);
    lastFetchedRef.current = 0;

    void fetchNotifications();

    // Supabase Realtime channel subscription for live notifications
    const channel = supabase
      .channel(`notifications-live-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
        },
        () => {
          void fetchNotifications();
        }
      )
      .subscribe();

    const handleFocus = () => {
      void fetchNotifications();
    };
    window.addEventListener("focus", handleFocus);

    const pollTimer = setInterval(() => {
      void fetchNotifications();
    }, 15000);

    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener("focus", handleFocus);
      clearInterval(pollTimer);
    };
  }, [userId, fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const who = profile?.full_name?.trim() || email || "Signed in";
  const home = `/${role}` as "/farmer";

  const handleToggleNotifications = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);

    // Phase 5.3: Avoid redundant duplicate fetch if notifications were fetched within the last 5 seconds
    if (nextOpen && userId && Date.now() - lastFetchedRef.current > 5000) {
      void fetchNotifications();
    }
  };

  const handleNotificationClick = async (notif: { id: string; link?: string | null; isRead?: boolean }) => {
    if (!notif.link) {
      if (!notif.isRead) {
        try {
          await markNotificationAsRead(notif.id);
          setNotifications((prev) =>
            prev.map((item) => (item.id === notif.id ? { ...item, is_read: true } : item))
          );
        } catch (err: any) {
          console.warn("[TerraByte] Failed to mark notification as read:", err);
        }
      }
      return;
    }

    setOpen(false);
    if (!notif.isRead) {
      try {
        await markNotificationAsRead(notif.id);
        setNotifications((prev) =>
          prev.map((item) => (item.id === notif.id ? { ...item, is_read: true } : item))
        );
      } catch (err: any) {
        console.warn("[TerraByte] Failed to mark notification as read:", err);
      }
    }
    let targetLink = notif.link;
    if (role === "admin" && targetLink) {
      if (targetLink.startsWith("/farmer/repair/")) {
        targetLink = targetLink.replace("/farmer/repair/", "/admin/repair/");
      } else if (targetLink.startsWith("/technician/job/")) {
        targetLink = targetLink.replace("/technician/job/", "/admin/repair/");
      }
    }
    void nav({ to: targetLink as "/" });
  };

  const handleMarkAllAsRead = async () => {
    if (!userId || unreadCount === 0) return;
    try {
      await markAllNotificationsAsRead();
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
    } catch (err: any) {
      console.warn("[TerraByte] Failed to mark all notifications as read:", err);
    }
  };

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
          {typeof window !== "undefined" && sessionStorage.getItem("tb_demo_origin") === "home" && (
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem("tb_demo_origin");
                actions.logout();
                void signOut().then(() => nav({ to: "/" }));
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Link
              to="/profile"
              aria-label="Profile settings"
              title="Profile settings"
              className="grid h-11 w-11 place-items-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <User className="h-5 w-5" />
            </Link>
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                aria-label="Notifications"
                onClick={handleToggleNotifications}
                className="relative grid h-11 w-11 place-items-center rounded-lg hover:bg-muted"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                    {unreadCount}
                  </span>
                )}
              </button>
              {open && (
                <div className="absolute right-0 top-12 z-50 w-80 sm:w-96 max-w-[92vw] overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
                  <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">Notifications</span>
                      {unreadCount > 0 && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                          {unreadCount} unread
                        </span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkAllAsRead}
                        className="text-xs font-medium text-primary hover:underline transition-colors"
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto divide-y divide-border/60">
                    {loadingNotifs && notifications.length === 0 && (
                      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span>Loading notifications…</span>
                      </div>
                    )}
                    {notifError && notifications.length === 0 && (
                      <p className="p-4 text-xs text-destructive">{notifError}</p>
                    )}
                    {!loadingNotifs && !notifError && notifications.length === 0 && (
                      <div className="p-8 text-center">
                        <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                          <Bell className="h-5 w-5 opacity-60" />
                        </div>
                        <p className="text-sm font-semibold text-foreground">No notifications</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">You're all caught up.</p>
                      </div>
                    )}
                    {notifications.map((n) => {
                      const isActionable = Boolean(n.link_target);
                      const category = getNotificationCategory(n.notification_text);
                      const cat = getCategoryBadgeConfig(category);
                      return (
                        <div
                          key={n.id}
                          role={isActionable ? "button" : "article"}
                          tabIndex={isActionable ? 0 : undefined}
                          onClick={() =>
                            handleNotificationClick({
                              id: n.id,
                              link: n.link_target,
                              isRead: n.is_read,
                            })
                          }
                          onKeyDown={(e) => {
                            if (isActionable && (e.key === "Enter" || e.key === " ")) {
                              e.preventDefault();
                              void handleNotificationClick({
                                id: n.id,
                                link: n.link_target,
                                isRead: n.is_read,
                              });
                            }
                          }}
                          className={cn(
                            "relative block w-full p-3.5 text-left transition-colors",
                            isActionable ? "cursor-pointer hover:bg-muted/60" : "cursor-default",
                            !n.is_read
                              ? "bg-primary/[0.04]"
                              : "bg-transparent opacity-85 hover:opacity-100"
                          )}
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase",
                                cat.badgeClass
                              )}
                            >
                              <cat.Icon className="h-3 w-3" />
                              {cat.label}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                {ago(new Date(n.created_at).getTime())} ago
                              </span>
                              {!n.is_read && (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full bg-primary ring-2 ring-primary/20"
                                  title="Unread"
                                />
                              )}
                            </div>
                          </div>
                          <p
                            className={cn(
                              "text-xs leading-relaxed",
                              !n.is_read
                                ? "font-semibold text-foreground"
                                : "font-normal text-muted-foreground"
                            )}
                          >
                            {n.notification_text}
                          </p>
                          {isActionable && (
                            <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary">
                              <span>View details</span>
                              <ChevronRight className="h-3 w-3" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {isDemo && (
              <button
                type="button"
                aria-label="Reset demo data"
                title="Reset demo data"
                onClick={() => {
                  setResetError(null);
                  setResetDialogOpen(true);
                }}
                className="grid h-11 w-11 place-items-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            )}
            <button
              aria-label="Sign out"
              title="Sign out"
              onClick={() => {
                const isDemoOrigin = typeof window !== "undefined" && sessionStorage.getItem("tb_demo_origin") === "home";
                if (typeof window !== "undefined") sessionStorage.removeItem("tb_demo_origin");
                actions.logout();
                void signOut().then(() => nav({ to: isDemoOrigin ? "/" : "/login" }));
              }}
              className="grid h-11 w-11 place-items-center rounded-lg hover:bg-muted"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Confirmation Dialog for Demo Reset */}
      {isDemo && (
        <AlertDialog
          open={resetDialogOpen}
          onOpenChange={(nextOpen) => {
            if (!resetBusy) {
              setResetDialogOpen(nextOpen);
              if (!nextOpen) setResetError(null);
            }
          }}
        >
          <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl p-5 sm:p-6 bg-card border-border shadow-xl space-y-4">
            <AlertDialogHeader className="space-y-3 text-left">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
                  <RotateCcw className="h-5 w-5" />
                </div>
                <div>
                  <AlertDialogTitle className="font-display text-lg font-bold text-foreground">
                    Reset demo data?
                  </AlertDialogTitle>
                  <p className="text-xs text-muted-foreground">TerraByte Demonstration Environment</p>
                </div>
              </div>
              <AlertDialogDescription className="text-xs text-muted-foreground space-y-2 pt-1 text-left leading-relaxed">
                <span className="block">
                  This will restore demo equipment, repairs, quotes, and timeline to their original baseline.
                </span>
                <span className="block">
                  Any newly created demo records will be removed. Real user data is not affected.
                </span>
                <span className="block font-medium text-foreground">
                  Your demo account and password will remain active.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>

            {resetError && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{resetError}</span>
              </div>
            )}

            <AlertDialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:space-x-2 pt-2">
              <AlertDialogCancel
                disabled={resetBusy}
                onClick={() => {
                  setResetDialogOpen(false);
                  setResetError(null);
                }}
                className="h-11 sm:h-9 px-4 text-xs font-semibold w-full sm:w-auto min-h-[44px] sm:min-h-0"
              >
                Cancel
              </AlertDialogCancel>
              <button
                type="button"
                disabled={resetBusy}
                onClick={handleExecuteReset}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 h-11 sm:h-9 w-full sm:w-auto min-h-[44px] sm:min-h-0"
                )}
              >
                {resetBusy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Resetting Demo…</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset Demo Data</span>
                  </>
                )}
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <main key={resetKey} className={cn("mx-auto px-4 pb-24 pt-6", wide ? "max-w-7xl" : "max-w-3xl")}>{children}</main>
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
export function StatusPill({
  r,
  audience,
}: {
  r: Pick<Repair, "status" | "testing"> & { technicianId?: string | null; technician_id?: string | null };
  audience: "farmer" | "staff";
}) {
  const techAssigned = r.technicianId || r.technician_id;
  const isUnassignedRequest = audience === "farmer" && r.status === "REQUESTED" && !techAssigned;

  let label: string;
  let toneClass = TONE[r.status];

  if (isUnassignedRequest) {
    label = "Send request to technician";
    toneClass = "bg-accent/25 text-accent-foreground border-accent/50";
  } else if (r.testing && r.status === "IN_PROGRESS") {
    label = audience === "farmer" ? "Testing Your Machine" : "Testing";
  } else {
    label = (audience === "farmer" ? FARMER_LABEL : STAFF_LABEL)[r.status];
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold",
        toneClass
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
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
              {cur && paused ? "Paused: Waiting for Spare Parts" : s}
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
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground", className)}>{children}</p>;
}
export const btn = {
  primary: "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40",
  urgent: "inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-destructive px-5 text-lg font-bold text-destructive-foreground hover:bg-destructive/90",
  ghost: "inline-flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 font-semibold hover:bg-muted disabled:opacity-40",
  amber: "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-foreground hover:bg-accent/90",
};
export const input = "w-full rounded-xl border-2 border-input bg-background px-3 py-3 text-base outline-none focus:border-primary";

export interface ContextualBackProps {
  to: string;
  label: string;
  className?: string;
}

export function ContextualBack({ to, label, className }: ContextualBackProps) {
  return (
    <Link
      to={to as any}
      className={cn(
        "inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg transition-colors",
        className
      )}
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </Link>
  );
}
