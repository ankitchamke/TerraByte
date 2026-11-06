import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getFacilityManagementProfile,
  getFacilityMembers,
  inviteFacilityMember,
  removeFacilityMember,
  revokeFacilityInvitation,
  updateFacility,
  type DetailedFacility,
  type FacilityMemberWithProfile,
  type FacilityRole,
} from "@/lib/services/facilities";
import { TransferOwnershipDialog } from "./TransferOwnershipDialog";

interface ManageWorkshopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  facilityName: string;
  userRole: FacilityRole;
  currentUserId: string;
  onFacilityUpdated: () => void;
}

export function ManageWorkshopDialog({
  open,
  onOpenChange,
  facilityId,
  facilityName,
  userRole,
  currentUserId,
  onFacilityUpdated,
}: ManageWorkshopDialogProps) {
  const [activeTab, setActiveTab] = useState<string>("details");
  const [loading, setLoading] = useState(true);
  const [savingDetails, setSavingDetails] = useState(false);
  const [facility, setFacility] = useState<DetailedFacility | null>(null);
  const [members, setMembers] = useState<FacilityMemberWithProfile[]>([]);

  // Edit details form state
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [capacity, setCapacity] = useState<number>(4);
  const [openTime, setOpenTime] = useState("08:00");
  const [closeTime, setCloseTime] = useState("19:00");

  // Invite state
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<"MANAGER" | "TECHNICIAN">("TECHNICIAN");
  const [inviting, setInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);

  // Transfer ownership dialog state
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [facData, membersData] = await Promise.all([
        getFacilityManagementProfile(facilityId),
        getFacilityMembers(facilityId),
      ]);
      setFacility(facData);
      setMembers(membersData);

      setPhone(facData.phone || "");
      setEmail(facData.email || "");
      setCapacity(facData.max_equipment_capacity || 4);

      const hours = (facData.operating_hours as any) || {};
      if (hours.open) setOpenTime(hours.open);
      if (hours.close) setCloseTime(hours.close);
    } catch (err: any) {
      console.error("[TerraByte] Error loading facility management data:", err);
      toast.error(err?.message || "Failed to load facility data.");
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    if (open) {
      void loadData();
    }
  }, [open, loadData]);

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    if (cleanPhone.length < 10) {
      toast.error("Please enter a valid 10-digit Indian phone number.");
      return;
    }

    try {
      setSavingDetails(true);
      await updateFacility(facilityId, {
        phone: cleanPhone.slice(-10),
        email: email.trim() || null,
        max_equipment_capacity: capacity,
        operating_hours: {
          open: openTime,
          close: closeTime,
          days: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
        },
      });
      toast.success("Workshop details updated successfully.");
      onFacilityUpdated();
      void loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update workshop details.");
    } finally {
      setSavingDetails(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = invitePhone.replace(/[^0-9]/g, "");
    if (cleanPhone.length < 10) {
      toast.error("Enter a valid 10-digit registered mobile phone number.");
      return;
    }

    try {
      setInviting(true);
      const res = await inviteFacilityMember(facilityId, cleanPhone.slice(-10), inviteRole);
      toast.success(
        `Invitation sent to ${res.technician_name || "technician"} as ${inviteRole}. Pending acceptance.`
      );
      setInvitePhone("");
      setShowInviteForm(false);
      void loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to send invitation.");
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvitation = async (membershipId: string) => {
    try {
      setBusyMemberId(membershipId);
      await revokeFacilityInvitation(membershipId);
      toast.success("Invitation revoked successfully.");
      void loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to revoke invitation.");
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleRemoveMember = async (member: FacilityMemberWithProfile) => {
    if (member.role === "OWNER") {
      toast.error("Cannot remove facility owner. Transfer ownership first.");
      return;
    }

    const confirmMsg = `Remove ${member.profile?.full_name || "this technician"} from the facility?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setBusyMemberId(member.id);
      await removeFacilityMember(facilityId, member.technician_profile_id);
      toast.success("Member removed from facility.");
      void loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to remove member.");
    } finally {
      setBusyMemberId(null);
    }
  };

  const isOwner = userRole === "OWNER";
  const isManager = userRole === "MANAGER";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <DialogTitle>{facilityName}</DialogTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    isOwner
                      ? "bg-primary text-primary-foreground"
                      : "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                  }
                >
                  Your Role: {userRole}
                </Badge>
                {facility?.drop_off_approved ? (
                  <Badge variant="outline" className="border-success/40 bg-success/10 text-success gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Drop-Off Approved
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    Private Field Base
                  </Badge>
                )}
              </div>
            </div>
            <DialogDescription>
              {facility?.village}, {facility?.tahsil} · Nagpur District
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm">Loading workshop governance data…</p>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2 space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
                <TabsTrigger value="governance" disabled={!isOwner}>
                  Governance & Ownership
                </TabsTrigger>
              </TabsList>

              {/* DETAILS TAB */}
              <TabsContent value="details" className="space-y-4">
                <form onSubmit={handleSaveDetails} className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="manage-phone">Counter Phone *</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="manage-phone"
                          className="pl-9"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manage-email">Contact Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="manage-email"
                          type="email"
                          className="pl-9"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="workshop@example.com"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="manage-cap">Capacity (Bays)</Label>
                      <Input
                        id="manage-cap"
                        type="number"
                        min={1}
                        max={50}
                        value={capacity}
                        onChange={(e) => setCapacity(parseInt(e.target.value, 10) || 1)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manage-open">Opens At</Label>
                      <Input
                        id="manage-open"
                        type="time"
                        value={openTime}
                        onChange={(e) => setOpenTime(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manage-close">Closes At</Label>
                      <Input
                        id="manage-close"
                        type="time"
                        value={closeTime}
                        onChange={(e) => setCloseTime(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground">Coarse Public Address:</p>
                    <p>
                      {facility?.address}, {facility?.village}, {facility?.tahsil} (GPS:{" "}
                      {Number(facility?.latitude).toFixed(4)}, {Number(facility?.longitude).toFixed(4)})
                    </p>
                    <p className="mt-1 italic">
                      Physical coordinates and counter contacts are revealed to farmers strictly during
                      authorized equipment pickup windows.
                    </p>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={savingDetails}>
                      {savingDetails ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        "Save Workshop Details"
                      )}
                    </Button>
                  </div>
                </form>
              </TabsContent>

              {/* MEMBERS TAB */}
              <TabsContent value="members" className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold">Affiliated Technicians</h3>
                    <p className="text-xs text-muted-foreground">
                      Technicians registered at this facility can take bay jobs and operate repairs.
                    </p>
                  </div>
                  {!showInviteForm && (
                    <Button
                      size="sm"
                      onClick={() => setShowInviteForm(true)}
                      className="gap-1.5 text-xs h-9"
                    >
                      <UserPlus className="h-4 w-4" />
                      Invite Technician
                    </Button>
                  )}
                </div>

                {/* Invite Form */}
                {showInviteForm && (
                  <form
                    onSubmit={handleInvite}
                    className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-foreground">
                        Invite Technician via Registered Phone
                      </h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowInviteForm(false)}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="inv-phone" className="text-xs">
                          Technician Mobile Number (10 digits) *
                        </Label>
                        <Input
                          id="inv-phone"
                          type="tel"
                          maxLength={14}
                          placeholder="9876543210"
                          value={invitePhone}
                          onChange={(e) => setInvitePhone(e.target.value)}
                          required
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Must be an existing verified technician account in the TerraByte network.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="inv-role" className="text-xs">
                          Facility Role *
                        </Label>
                        <Select
                          value={inviteRole}
                          onValueChange={(v) => setInviteRole(v as "MANAGER" | "TECHNICIAN")}
                        >
                          <SelectTrigger id="inv-role">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TECHNICIAN">TECHNICIAN (Standard member)</SelectItem>
                            <SelectItem value="MANAGER">MANAGER (Can invite/manage tech)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-end pt-1">
                      <Button type="submit" size="sm" disabled={inviting}>
                        {inviting ? (
                          <>
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            Sending Invitation…
                          </>
                        ) : (
                          "Send Membership Invitation"
                        )}
                      </Button>
                    </div>
                  </form>
                )}

                {/* Members List */}
                <div className="space-y-2">
                  {members.map((m) => {
                    const isSelf = m.technician_profile_id === currentUserId;
                    const canRemove =
                      !isSelf &&
                      m.role !== "OWNER" &&
                      (isOwner || (isManager && m.role === "TECHNICIAN"));

                    return (
                      <div
                        key={m.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-sm">
                              {m.profile?.full_name || "Unnamed Technician"}
                              {isSelf && " (You)"}
                            </p>

                            {/* Role Badge */}
                            {m.role === "OWNER" ? (
                              <Badge className="bg-primary text-primary-foreground text-xs">
                                OWNER
                              </Badge>
                            ) : m.role === "MANAGER" ? (
                              <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-500/20 text-xs">
                                MANAGER
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground text-xs">
                                TECHNICIAN
                              </Badge>
                            )}

                            {/* Status Badge */}
                            {m.status === "INVITED" && (
                              <Badge
                                variant="outline"
                                className="border-warning/50 bg-warning/10 text-warning-foreground text-xs gap-1"
                              >
                                <Clock className="h-3 w-3" /> Pending Acceptance
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {m.profile?.village || "Vidarbha"} · {m.profile?.phone || "No phone"}
                          </p>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5">
                          {m.status === "INVITED" && (isOwner || isManager) && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busyMemberId === m.id}
                              onClick={() => void handleRevokeInvitation(m.id)}
                              className="text-xs h-8 text-destructive hover:bg-destructive/10"
                            >
                              Revoke
                            </Button>
                          )}

                          {canRemove && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busyMemberId === m.id}
                              onClick={() => void handleRemoveMember(m)}
                              className="text-xs h-8 text-destructive hover:bg-destructive/10"
                              title="Remove member"
                            >
                              <UserMinus className="h-3.5 w-3.5 mr-1" />
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              {/* GOVERNANCE TAB */}
              {isOwner && (
                <TabsContent value="governance" className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-primary" />
                      <h3 className="font-bold">Facility Ownership & Governance</h3>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      As the registered Owner of <strong>{facilityName}</strong>, you have exclusive
                      authority to transfer ownership to another active member.
                    </p>

                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1">
                      <p className="font-semibold">Single-Owner Invariant:</p>
                      <p className="text-muted-foreground">
                        Each facility has strictly one Owner at any time. When you transfer ownership,
                        you will be automatically and atomically reassigned as a Manager.
                      </p>
                    </div>

                    <div className="pt-2">
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => setShowTransferDialog(true)}
                        className="gap-2"
                      >
                        <KeyRound className="h-4 w-4" />
                        Transfer Facility Ownership…
                      </Button>
                    </div>
                  </div>
                </TabsContent>
              )}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* Transfer Ownership Modal */}
      {showTransferDialog && (
        <TransferOwnershipDialog
          open={showTransferDialog}
          onOpenChange={setShowTransferDialog}
          facilityId={facilityId}
          facilityName={facilityName}
          eligibleMembers={members}
          onSuccess={() => {
            onFacilityUpdated();
            void loadData();
          }}
        />
      )}
    </>
  );
}
