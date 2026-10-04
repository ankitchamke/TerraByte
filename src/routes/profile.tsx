import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Radio,
  Tractor,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, ContextualBack, Label, Shell, btn, input } from "@/components/tb";
import { refreshProfile, signOut, useAuth, type AppRole } from "@/lib/auth";
import { meta } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteUserAccount,
  getTechnicianWorkshopDetails,
  updateProfile,
  updateTechnicianWorkshop,
} from "@/lib/services/profile";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/profile")({
  head: () =>
    meta(
      "Profile settings",
      "Manage your personal and workspace profile details."
    ),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, email, ready, userId, emailConfirmed } = useAuth();
  const nav = useNavigate();

  // Common profile state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [village, setVillage] = useState("");

  // Technician-specific workshop state
  const [workshopName, setWorkshopName] = useState("");
  const [workshopPhone, setWorkshopPhone] = useState("");
  const [loadingWorkshop, setLoadingWorkshop] = useState(false);

  // Submission state
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Account Security state
  const isDemoAccount = Boolean(
    email?.endsWith("@terrabyte.demo") || Boolean(profile?.demo_code)
  );
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);

  // Danger Zone / Account Deletion state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Authentication check: bounce if not signed in or email unconfirmed
  useEffect(() => {
    if (ready && (!userId || !profile || !emailConfirmed)) {
      void nav({ to: "/login" });
    }
  }, [ready, userId, profile, emailConfirmed, nav]);

  // Sync initial profile values into form state
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setPhone(profile.phone || "");
      setVillage(profile.village || "");
    }
  }, [profile]);

  // If technician, fetch workshop details
  useEffect(() => {
    if (profile?.role !== "technician") return;

    let isMounted = true;
    setLoadingWorkshop(true);
    void getTechnicianWorkshopDetails()
      .then((details) => {
        if (!isMounted) return;
        if (details) {
          setWorkshopName(details.workshop_name || "");
          setWorkshopPhone(details.phone || "");
        }
      })
      .finally(() => {
        if (isMounted) setLoadingWorkshop(false);
      });

    return () => {
      isMounted = false;
    };
  }, [profile?.role]);

  if (!ready || !profile) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading profile…</span>
        </div>
      </div>
    );
  }

  const role: AppRole = profile.role;
  const shellRole = role === "service_centre" ? "admin" : role;

  const backTarget =
    role === "service_centre"
      ? { to: "/admin", label: "Pipeline" }
      : role === "technician"
      ? { to: "/technician", label: "Jobs" }
      : { to: "/farmer", label: "Home" };

  const roleLabel =
    role === "service_centre"
      ? "Service Centre Staff"
      : role === "technician"
      ? profile.is_verified
        ? "Verified Technician"
        : "Technician (Pending Approval)"
      : "Farmer";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setErrorMsg("Full name is required.");
      return;
    }

    if (role === "technician" && !workshopName.trim()) {
      setErrorMsg("Workshop name is required for technicians.");
      return;
    }

    setSaving(true);
    try {
      // 1. Update common profile fields
      await updateProfile({
        fullName: trimmedName,
        phone: phone.trim() || null,
        village: village.trim() || null,
      });

      // 2. If technician, update workshop information
      if (role === "technician") {
        await updateTechnicianWorkshop({
          workshopName: workshopName.trim(),
          workshopPhone: workshopPhone.trim() || null,
        });
      }

      // 3. Immediately refresh auth state across application
      await refreshProfile();

      setSuccessMsg("Profile updated successfully.");
      toast.success("Profile updated successfully.");
    } catch (err: any) {
      console.error("[TerraByte] Profile update error:", err);
      const friendlyMessage =
        err?.message && !err.message.includes("violates")
          ? err.message
          : "Failed to update profile. Please try again.";
      setErrorMsg(friendlyMessage);
      toast.error(friendlyMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecurityError(null);
    setSecuritySuccess(null);

    const curr = currentPassword.trim();
    const next = newPassword;
    const conf = confirmPassword;

    if (!curr) {
      setSecurityError("Current password is required.");
      return;
    }

    if (next.length < 8) {
      setSecurityError("New password must be at least 8 characters long.");
      return;
    }

    if (next !== conf) {
      setSecurityError("New password and confirmation do not match.");
      return;
    }

    if (next === curr) {
      setSecurityError("New password must be different from current password.");
      return;
    }

    const targetEmail = email;
    if (!targetEmail) {
      setSecurityError("No authenticated email address found.");
      return;
    }

    setSecurityBusy(true);

    try {
      // 1. Verify current password
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: curr,
      });

      if (signInErr) {
        setSecurityError("Current password is incorrect.");
        setSecurityBusy(false);
        return;
      }

      // 2. Update to new password
      const { error: updateErr } = await supabase.auth.updateUser({
        password: next,
        current_password: curr,
      });

      if (updateErr) {
        setSecurityError(updateErr.message || "Failed to update password.");
        setSecurityBusy(false);
        return;
      }

      // 3. Reset form and inform user
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowChangePassword(false);
      setSecuritySuccess("Password updated successfully.");
      toast.success("Password updated successfully.");
    } catch (err: any) {
      console.error("[TerraByte] Password change exception:", err);
      setSecurityError(err?.message || "An unexpected error occurred while updating password.");
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError(null);

    if (deleteConfirmText.trim() !== "DELETE") {
      setDeleteError("Please type DELETE to confirm account deletion.");
      return;
    }

    const currentEmail = email;
    if (!currentEmail) {
      setDeleteError("No authenticated email address found.");
      return;
    }

    if (!deletePassword) {
      setDeleteError("Please enter your current password.");
      return;
    }

    setDeleteBusy(true);

    try {
      // 1. Password verification
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password: deletePassword,
      });

      if (signInErr) {
        setDeleteError("Current password is incorrect.");
        setDeleteBusy(false);
        return;
      }

      // 2. Call secure deletion RPC
      await deleteUserAccount();

      // 3. Clear auth store and session
      await signOut();

      toast.success("Your account has been deleted.");

      // 4. Navigate directly to Home
      void nav({ to: "/" });
    } catch (err: any) {
      console.error("[TerraByte] Account deletion failed:", err);
      setDeleteError(err?.message || "Failed to delete account. Please try again.");
      setDeleteBusy(false);
    }
  };

  return (
    <Shell role={shellRole}>
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Contextual Back Navigation */}
        <ContextualBack to={backTarget.to} label={backTarget.label} />

        {/* Identity Summary Card */}
        <Card className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-card border-border p-5">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            {role === "technician" ? (
              <Wrench className="h-7 w-7" />
            ) : role === "service_centre" ? (
              <Radio className="h-7 w-7" />
            ) : (
              <Tractor className="h-7 w-7" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-2xl font-bold text-foreground">
                {profile.full_name || "TerraByte User"}
              </h1>
              {role === "technician" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    profile.is_verified
                      ? "bg-success/15 text-success border border-success/30"
                      : "bg-warning/20 text-warning-foreground border border-warning/40"
                  )}
                >
                  {profile.is_verified ? (
                    <>
                      <BadgeCheck className="h-3.5 w-3.5" /> Verified
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5" /> Pending Approval
                    </>
                  )}
                </span>
              )}
            </div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground mt-0.5">
              {roleLabel}
            </p>
            <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5 truncate">
              <Lock className="h-3 w-3 shrink-0" />
              <span className="truncate">{email || "No email linked"}</span>
              <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground/80">
                (Sign-in email)
              </span>
            </p>
          </div>
        </Card>

        {/* Feedback Banners */}
        {successMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 p-3.5 text-sm font-semibold text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-sm font-semibold text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Profile Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Personal / Contact Details */}
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">
                {role === "service_centre"
                  ? "Service Centre Details"
                  : "Personal Information"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {role === "service_centre"
                  ? "Official facility and contact helpline details."
                  : "Your name and primary mobile number for repair notifications."}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <Label>
                  {role === "service_centre"
                    ? "Centre / Facility Name"
                    : "Full Name"}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <input
                  type="text"
                  required
                  disabled={saving}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={
                    role === "service_centre"
                      ? "e.g. Nagpur Central Service Centre"
                      : "e.g. Ramesh Patil"
                  }
                  className={input}
                />
              </div>

              <div>
                <Label>
                  {role === "technician"
                    ? "Personal / Direct Mobile"
                    : role === "service_centre"
                    ? "Helpline / Operations Phone"
                    : "Phone Number"}
                </Label>
                <input
                  type="tel"
                  disabled={saving}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className={input}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Used for SMS updates and direct call coordination.
                </p>
              </div>

              <div>
                <Label>
                  {role === "service_centre"
                    ? "District / Operating Territory"
                    : "Village / Location"}
                </Label>
                <input
                  type="text"
                  disabled={saving}
                  value={village}
                  onChange={(e) => setVillage(e.target.value)}
                  placeholder={
                    role === "service_centre"
                      ? "e.g. Nagpur District"
                      : "e.g. Saoner, Nagpur"
                  }
                  className={input}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="mb-0">Sign-in Email</Label>
                  <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                    <Lock className="h-3 w-3" /> Read-only
                  </span>
                </div>
                <input
                  type="email"
                  disabled
                  readOnly
                  value={email || ""}
                  className={cn(
                    input,
                    "cursor-not-allowed bg-muted/50 text-muted-foreground border-border/60"
                  )}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Your email address is managed exclusively by account security.
                </p>
              </div>
            </div>
          </Card>

          {/* Section 2: Technician Workshop Information */}
          {role === "technician" && (
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">
                  Workshop Information
                </h2>
                <p className="text-xs text-muted-foreground">
                  Your garage or service center identity displayed to farmers.
                </p>
              </div>

              {loadingWorkshop ? (
                <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading workshop details…</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label>
                      Workshop / Garage Name{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <input
                      type="text"
                      required
                      disabled={saving}
                      value={workshopName}
                      onChange={(e) => setWorkshopName(e.target.value)}
                      placeholder="e.g. Patil Tractor & Equipment Works"
                      className={input}
                    />
                  </div>

                  <div>
                    <Label>Workshop Landline / Alternate Phone</Label>
                    <input
                      type="tel"
                      disabled={saving}
                      value={workshopPhone}
                      onChange={(e) => setWorkshopPhone(e.target.value)}
                      placeholder="+91 712 2541234"
                      className={input}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Public workshop contact number shown on quotes and service cards.
                    </p>
                  </div>

                  {/* Verification Status Notice */}
                  <div
                    className={cn(
                      "mt-2 rounded-xl p-3.5 text-xs flex items-start gap-2.5",
                      profile.is_verified
                        ? "bg-success/10 border border-success/30 text-success-foreground"
                        : "bg-warning/15 border border-warning/40 text-warning-foreground"
                    )}
                  >
                    {profile.is_verified ? (
                      <BadgeCheck className="h-4 w-4 shrink-0 text-success mt-0.5" />
                    ) : (
                      <Clock className="h-4 w-4 shrink-0 text-warning-foreground mt-0.5" />
                    )}
                    <div>
                      <p className="font-semibold">
                        {profile.is_verified
                          ? "Authorized Network Technician"
                          : "Account Awaiting Verification"}
                      </p>
                      <p className="opacity-90 mt-0.5">
                        {profile.is_verified
                          ? "Your workshop has been verified by the Nagpur Central Service Centre. You are eligible to take live repair jobs."
                          : "Your workshop details are being reviewed by the service centre. You will be able to accept jobs once approved."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className={cn(btn.primary, "w-full sm:w-auto px-6")}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Saving changes…</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>

        {/* Account Security Card */}
        <Card className="bg-card border-border p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">Account Security</h2>
              <p className="text-xs text-muted-foreground">Manage your password and sign-in credentials.</p>
            </div>
          </div>

          {securitySuccess && (
            <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-xs font-semibold text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{securitySuccess}</span>
            </div>
          )}

          {securityError && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{securityError}</span>
            </div>
          )}

          {isDemoAccount ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-foreground font-medium flex items-start gap-3">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">Pre-seeded Nagpur Demo Account</p>
                <p className="text-muted-foreground mt-0.5">
                  Password modification is disabled for pre-seeded Nagpur demo accounts to preserve 1-click demo evaluation.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-1">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
                <div>
                  <p className="text-xs font-semibold text-foreground">Sign-in Password</p>
                  <p className="text-xs text-muted-foreground font-mono tracking-widest mt-0.5">••••••••••••</p>
                </div>
                {!showChangePassword && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowChangePassword(true);
                      setSecurityError(null);
                      setSecuritySuccess(null);
                    }}
                    className={cn(btn.secondary, "text-xs h-9 px-3 w-full sm:w-auto")}
                  >
                    Change Password
                  </button>
                )}
              </div>

              {showChangePassword && (
                <form onSubmit={handleChangePassword} className="rounded-xl border border-border bg-card p-4 space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Change Password</h3>

                  <div>
                    <Label>Current Password</Label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      disabled={securityBusy}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter your current password"
                      className={input}
                    />
                  </div>

                  <div>
                    <Label>New Password (min. 8 characters)</Label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      disabled={securityBusy}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter your new password"
                      className={input}
                    />
                  </div>

                  <div>
                    <Label>Confirm New Password</Label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      disabled={securityBusy}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your new password"
                      className={input}
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      disabled={securityBusy}
                      onClick={() => {
                        setShowChangePassword(false);
                        setCurrentPassword("");
                        setNewPassword("");
                        setConfirmPassword("");
                        setSecurityError(null);
                      }}
                      className={cn(btn.secondary, "text-xs h-9 px-3")}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={securityBusy}
                      className={cn(btn.primary, "text-xs h-9 px-4")}
                    >
                      {securityBusy ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Updating…</span>
                        </>
                      ) : (
                        <span>Update Password</span>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </Card>

        {/* Danger Zone Card */}
        <Card className="bg-card border-destructive/30 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-destructive">Danger Zone</h2>
              <p className="text-xs text-muted-foreground">Permanently delete your account and remove your access.</p>
            </div>
          </div>

          {isDemoAccount ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-foreground font-medium flex items-start gap-3">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">Pre-seeded TerraByte Demo Account</p>
                <p className="text-muted-foreground mt-0.5">
                  Account deletion is disabled for pre-seeded TerraByte demo accounts to preserve the demo environment.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3.5">
                <div>
                  <p className="text-xs font-semibold text-foreground">Delete Account</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permanently delete your login credentials, unlink machinery assets, and remove access.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteDialog(true);
                    setDeletePassword("");
                    setDeleteConfirmText("");
                    setDeleteError(null);
                  }}
                  className="h-9 px-4 rounded-xl border border-destructive/40 bg-background text-xs font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors shrink-0"
                >
                  Delete Account
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Delete Confirmation Modal */}
        {showDeleteDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-foreground">Permanently Delete Account?</h3>
                  <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
                </div>
              </div>

              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3.5 text-xs text-foreground/90 space-y-1.5 leading-relaxed">
                <p className="font-semibold text-destructive">Please read carefully:</p>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                  <li>Your sign-in credentials and active sessions will be permanently revoked.</li>
                  <li>Active repairs must be completed or cancelled before you can delete your account.</li>
                  <li>Completed repair records on machinery are preserved for permanent equipment service tracking.</li>
                </ul>
              </div>

              {deleteError && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}

              <form onSubmit={handleDeleteAccount} className="space-y-3.5">
                <div>
                  <Label>Current Password</Label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={deleteBusy}
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Enter your current password"
                    className={input}
                  />
                </div>

                <div>
                  <Label>
                    Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm
                  </Label>
                  <input
                    type="text"
                    required
                    disabled={deleteBusy}
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className={input}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={deleteBusy}
                    onClick={() => {
                      setShowDeleteDialog(false);
                      setDeletePassword("");
                      setDeleteConfirmText("");
                      setDeleteError(null);
                    }}
                    className={cn(btn.secondary, "text-xs h-10 px-4")}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={deleteBusy || deleteConfirmText.trim() !== "DELETE" || !deletePassword}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-destructive px-4 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                  >
                    {deleteBusy ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Deleting account…</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Permanently Delete Account</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
