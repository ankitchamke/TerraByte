import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileCheck2,
  Filter,
  Info,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  UserCheck,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ContextualBack } from "@/components/tb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { meta } from "@/lib/seo";
import {
  APPROVED_KYC_DOCUMENT_TYPES,
  approveTechnicianSkill,
  detectIllegalFullId,
  detectSensitiveDataInRemarks,
  dismissTechnicianSkill,
  getAllTechniciansAdmin,
  isValidMaskedId,
  setTechnicianVerification,
  verifyTechnicianKyc,
  type AdminTechnicianRow,
} from "@/lib/services/technicians";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/technicians")({
  ssr: false,
  head: () =>
    meta(
      "Technician Verification & Trust",
      "Manage physical KYC identity verification and certified AI skills for the TerraByte network.",
    ),
  component: AdminTechniciansPage,
});

type FilterTab = "ALL" | "PENDING_APPROVAL" | "KYC_PENDING" | "KYC_VERIFIED";

function AdminTechniciansPage() {
  const [rows, setRows] = useState<AdminTechnicianRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Action busy states
  const [busyTechId, setBusyTechId] = useState<string | null>(null);

  // In-person KYC dialog state
  const [kycTarget, setKycTarget] = useState<AdminTechnicianRow | null>(null);

  // Skill certification dialog state
  const [skillTarget, setSkillTarget] = useState<AdminTechnicianRow | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const data = await getAllTechniciansAdmin();
      setRows(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load technicians.";
      console.error("[TerraByte] Admin technicians load error:", err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  const handleToggleGeneralVerification = async (tech: AdminTechnicianRow, newStatus: boolean) => {
    setBusyTechId(tech.id);
    try {
      await setTechnicianVerification(tech.id, newStatus);
      toast.success(
        newStatus
          ? `Technician account approved for ${tech.full_name || "technician"}.`
          : `Technician access revoked for ${tech.full_name || "technician"}.`,
      );
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update technician verification.";
      toast.error(msg);
    } finally {
      setBusyTechId(null);
    }
  };

  // Filtered rows
  const filteredRows = useMemo(() => {
    let result = rows;

    if (filterTab === "PENDING_APPROVAL") {
      result = result.filter((r) => !r.is_verified);
    } else if (filterTab === "KYC_PENDING") {
      result = result.filter((r) => r.is_verified && !r.kyc_verified);
    } else if (filterTab === "KYC_VERIFIED") {
      result = result.filter((r) => r.kyc_verified);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (r) =>
          r.full_name.toLowerCase().includes(q) ||
          r.workshop_name.toLowerCase().includes(q) ||
          (r.village && r.village.toLowerCase().includes(q)) ||
          (r.phone && r.phone.includes(q)) ||
          r.skills.some((s) => s.toLowerCase().includes(q)) ||
          r.verified_skills.some((s) => s.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [rows, filterTab, searchQuery]);

  // Metric counts
  const totalCount = rows.length;
  const pendingApprovalCount = rows.filter((r) => !r.is_verified).length;
  const kycPendingCount = rows.filter((r) => r.is_verified && !r.kyc_verified).length;
  const kycVerifiedCount = rows.filter((r) => r.kyc_verified).length;

  return (
    <div className="space-y-6">
      <ContextualBack to="/admin" label="Pipeline" />

      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-widest text-primary">
              Governance & Compliance
            </span>
            <Badge variant="outline" className="text-xs">
              Phase 13
            </Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Technician Verification & Trust</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            In-person physical KYC identity audits at Nagpur Service Centre and human-in-the-loop AI
            skill endorsements.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading || refreshing}
          className="gap-1.5 self-start sm:self-center"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div
          onClick={() => setFilterTab("ALL")}
          className={cn(
            "cursor-pointer rounded-2xl border p-4 transition-all",
            filterTab === "ALL"
              ? "border-primary bg-primary/5 ring-1 ring-primary"
              : "border-border bg-card hover:border-border/80",
          )}
        >
          <p className="text-xs font-semibold text-muted-foreground">Total Registered</p>
          <p className="mt-1 text-2xl font-bold">{totalCount}</p>
          <p className="text-[11px] text-muted-foreground">All accounts</p>
        </div>

        <div
          onClick={() => setFilterTab("PENDING_APPROVAL")}
          className={cn(
            "cursor-pointer rounded-2xl border p-4 transition-all",
            filterTab === "PENDING_APPROVAL"
              ? "border-warning bg-warning/5 ring-1 ring-warning"
              : "border-border bg-card hover:border-border/80",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-warning-foreground">Pending Approval</p>
            <Clock className="h-4 w-4 text-warning" />
          </div>
          <p className="mt-1 text-2xl font-bold text-warning-foreground">{pendingApprovalCount}</p>
          <p className="text-[11px] text-muted-foreground">Account unverified</p>
        </div>

        <div
          onClick={() => setFilterTab("KYC_PENDING")}
          className={cn(
            "cursor-pointer rounded-2xl border p-4 transition-all",
            filterTab === "KYC_PENDING"
              ? "border-amber-500 bg-amber-500/5 ring-1 ring-amber-500"
              : "border-border bg-card hover:border-border/80",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">KYC Pending</p>
            <FileCheck2 className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {kycPendingCount}
          </p>
          <p className="text-[11px] text-muted-foreground">Awaiting Nagpur visit</p>
        </div>

        <div
          onClick={() => setFilterTab("KYC_VERIFIED")}
          className={cn(
            "cursor-pointer rounded-2xl border p-4 transition-all",
            filterTab === "KYC_VERIFIED"
              ? "border-success bg-success/5 ring-1 ring-success"
              : "border-border bg-card hover:border-border/80",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-success">KYC Verified</p>
            <ShieldCheck className="h-4 w-4 text-success" />
          </div>
          <p className="mt-1 text-2xl font-bold text-success">{kycVerifiedCount}</p>
          <p className="text-[11px] text-muted-foreground">In-person certified</p>
        </div>
      </div>

      {/* In-Person Verification Policy Reminder Banner */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-semibold text-foreground flex items-center gap-1.5 text-sm">
          <Info className="h-4 w-4 text-primary shrink-0" />
          <span>In-Person Physical Identity Audit Policy (Nagpur Service Centre)</span>
        </p>
        <p>
          Technicians must present their original identity documents (Aadhaar, PAN, Voter ID,
          Driving License, or Trade License) physically at the Nagpur Service Centre (MIDC Hingna
          Road).
          <strong>
            {" "}
            Never store full 12-digit Aadhaar numbers or collect document scans.
          </strong>{" "}
          Only the canonical masked last-4 identifier is stored in the audit trail.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: "ALL", label: `All (${totalCount})` },
            { id: "PENDING_APPROVAL", label: `Pending Approval (${pendingApprovalCount})` },
            { id: "KYC_PENDING", label: `KYC Pending (${kycPendingCount})` },
            { id: "KYC_VERIFIED", label: `KYC Certified (${kycVerifiedCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id as FilterTab)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
                filterTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <Input
            placeholder="Search by name, village, skill…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 text-xs"
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-2">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Failed to load technician roster</p>
            <p className="text-xs">{error}</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary mb-2" />
          Loading registered technicians…
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredRows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground space-y-2">
          <UserCheck className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="text-base font-semibold text-foreground">No technicians found</p>
          <p className="text-xs max-w-sm mx-auto">
            {searchQuery
              ? `No technicians matched your search "${searchQuery}".`
              : "No technician profiles match the selected status filter."}
          </p>
        </div>
      )}

      {/* Technician Roster Grid */}
      {!loading && filteredRows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredRows.map((tech) => {
            const hasPendingAiSkills = tech.ai_suggested_skills.length > 0;
            const isFullyVerified = tech.is_verified && tech.kyc_verified;

            return (
              <div
                key={tech.id}
                className={cn(
                  "rounded-2xl border bg-card p-5 space-y-4 transition-all",
                  isFullyVerified
                    ? "border-success/40 shadow-xs"
                    : !tech.is_verified
                      ? "border-warning/60 bg-warning/[0.02]"
                      : "border-border",
                )}
              >
                {/* Header: Name, Workshop, Badges */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-bold text-lg truncate">
                        {tech.full_name || "Unnamed Technician"}
                      </p>
                      {tech.kyc_verified && (
                        <ShieldCheck
                          className="h-5 w-5 text-success shrink-0"
                          aria-label="KYC Certified"
                        />
                      )}
                    </div>
                    <p className="text-xs font-semibold text-muted-foreground truncate">
                      {tech.workshop_name}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3" />
                      <span>{tech.village || "Vidarbha"}</span>
                      <span>·</span>
                      <Phone className="h-3 w-3" />
                      <span>{tech.phone || "No phone"}</span>
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                      <Star
                        className={cn(
                          "h-3.5 w-3.5",
                          tech.rating != null ? "fill-accent text-accent" : "text-muted-foreground",
                        )}
                      />
                      <span className="font-semibold text-foreground">
                        {tech.rating != null ? Number(tech.rating).toFixed(1) : "New / Unrated"}
                      </span>
                      <span>·</span>
                      <span>{tech.jobs_completed} repairs</span>
                    </p>
                  </div>

                  {/* Semantic Status Badges */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {tech.is_verified ? (
                      <Badge className="bg-primary text-primary-foreground text-[10px]">
                        Account Approved
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-warning text-warning-foreground text-[10px]"
                      >
                        Account Pending
                      </Badge>
                    )}

                    {tech.kyc_verified ? (
                      <Badge className="bg-success text-primary-foreground text-[10px] gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        KYC Certified
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-500/50 text-amber-600 dark:text-amber-400 text-[10px] gap-1"
                      >
                        <Clock className="h-3 w-3" />
                        KYC Pending
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Physical KYC Audit Information Banner */}
                {tech.kyc_verified ? (
                  <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between text-success font-semibold">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        In-Person Physical Audit Verified
                      </span>
                      <span className="font-mono text-[11px]">{tech.kyc_document_type}</span>
                    </div>
                    <p className="font-mono text-[11px] text-foreground">
                      Masked ID: <strong>{tech.kyc_masked_id}</strong>
                    </p>
                    {tech.kyc_remarks && (
                      <p className="text-[11px] text-muted-foreground italic">
                        "{tech.kyc_remarks}"
                      </p>
                    )}
                    {tech.kyc_verified_at && (
                      <p className="text-[10px] text-muted-foreground">
                        Verified on{" "}
                        {new Date(tech.kyc_verified_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1 text-muted-foreground">
                    <p className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Physical Identity Audit Pending
                    </p>
                    <p className="text-[11px]">
                      Technician must present physical credentials in person at Nagpur Service
                      Centre for physical inspection.
                    </p>
                  </div>
                )}

                {/* Skills Section: Verified & AI Suggested */}
                <div className="space-y-2 pt-1 border-t border-border/60">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Verified Technical Expertise
                    </p>
                    {hasPendingAiSkills && (
                      <Badge
                        variant="secondary"
                        className="bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-500/20 text-[10px] gap-1 cursor-pointer"
                        onClick={() => setSkillTarget(tech)}
                      >
                        <Sparkles className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                        {tech.ai_suggested_skills.length} AI Suggestions
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {tech.verified_skills && tech.verified_skills.length > 0 ? (
                      tech.verified_skills.map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-xs font-medium text-success"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {s}
                        </span>
                      ))
                    ) : tech.skills && tech.skills.length > 0 ? (
                      tech.skills.map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {s}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground italic">
                        No certified skills on file.
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Toolbar */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60 sm:flex sm:items-center sm:justify-end">
                  {/* AI Skills Review Button */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSkillTarget(tech)}
                    className="h-9 text-xs gap-1.5"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                    Review Skills
                    {hasPendingAiSkills && (
                      <span className="h-1.5 w-1.5 rounded-full bg-purple-600" />
                    )}
                  </Button>

                  {/* Physical KYC Button */}
                  <Button
                    size="sm"
                    variant={tech.kyc_verified ? "outline" : "default"}
                    onClick={() => setKycTarget(tech)}
                    className={cn(
                      "h-9 text-xs gap-1.5",
                      !tech.kyc_verified && "bg-amber-600 hover:bg-amber-700 text-white",
                    )}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {tech.kyc_verified ? "Update KYC" : "Verify Physical KYC"}
                  </Button>

                  {/* General Account Access Toggle */}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyTechId === tech.id}
                    onClick={() => void handleToggleGeneralVerification(tech, !tech.is_verified)}
                    className={cn(
                      "h-9 text-xs col-span-2 sm:col-span-1",
                      tech.is_verified
                        ? "text-destructive hover:bg-destructive/10"
                        : "text-primary hover:bg-primary/10",
                    )}
                  >
                    {busyTechId === tech.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : tech.is_verified ? (
                      "Revoke Access"
                    ) : (
                      "Approve Account"
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* In-Person Physical KYC Verification Dialog */}
      {kycTarget && (
        <VerifyKycDialog
          open={Boolean(kycTarget)}
          onOpenChange={(op) => {
            if (!op) setKycTarget(null);
          }}
          technician={kycTarget}
          onSuccess={() => {
            setKycTarget(null);
            void loadData();
          }}
        />
      )}

      {/* AI Skills Certification Workbench Dialog */}
      {skillTarget && (
        <SkillCertificationDialog
          open={Boolean(skillTarget)}
          onOpenChange={(op) => {
            if (!op) setSkillTarget(null);
          }}
          technician={skillTarget}
          onSuccess={() => {
            void loadData();
          }}
        />
      )}
    </div>
  );
}

// ==============================================================================
// VERIFY IN-PERSON PHYSICAL KYC DIALOG
// ==============================================================================

interface VerifyKycDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician: AdminTechnicianRow;
  onSuccess: () => void;
}

function VerifyKycDialog({ open, onOpenChange, technician, onSuccess }: VerifyKycDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [docType, setDocType] = useState<string>("AADHAAR_PHYSICAL");
  const [maskedId, setMaskedId] = useState("");
  const [remarks, setRemarks] = useState(
    technician.kyc_remarks || "Inspected physical card at Nagpur Service Centre.",
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const activeDocConfig = useMemo(() => {
    return (
      APPROVED_KYC_DOCUMENT_TYPES.find((d) => d.code === docType) || APPROVED_KYC_DOCUMENT_TYPES[0]
    );
  }, [docType]);

  // Live input validation guard
  useEffect(() => {
    const trimmed = maskedId.trim();
    if (!trimmed) {
      setValidationError(null);
      return;
    }

    const illegalCheck = detectIllegalFullId(trimmed);
    if (illegalCheck.isIllegal) {
      setValidationError(illegalCheck.message || "Illegal complete identifier.");
      return;
    }

    if (!isValidMaskedId(docType, trimmed)) {
      setValidationError(
        `Identifier must follow format ${activeDocConfig.example} (e.g. ${activeDocConfig.example}).`,
      );
      return;
    }

    if (detectSensitiveDataInRemarks(remarks)) {
      setValidationError("Remarks must not contain credential numbers (6 or more digits).");
      return;
    }

    setValidationError(null);
  }, [maskedId, docType, remarks, activeDocConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedId = maskedId.trim();

    if (!trimmedId) {
      toast.error("Please enter the masked document identifier.");
      return;
    }

    const illegalCheck = detectIllegalFullId(trimmedId);
    if (illegalCheck.isIllegal) {
      toast.error(illegalCheck.message);
      return;
    }

    if (!isValidMaskedId(docType, trimmedId)) {
      toast.error(`Invalid masked format. Please use ${activeDocConfig.example}.`);
      return;
    }

    if (detectSensitiveDataInRemarks(remarks)) {
      toast.error("Remarks must not contain credential numbers (6 or more digits).");
      return;
    }

    try {
      setSubmitting(true);
      await verifyTechnicianKyc({
        technicianProfileId: technician.id,
        documentType: docType,
        maskedId: trimmedId,
        remarks: remarks.trim(),
      });

      toast.success(`Physical KYC certified for ${technician.full_name || "technician"}.`);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to verify technician KYC.";
      console.error("[TerraByte] KYC verification submission error:", err);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <DialogTitle>In-Person Physical Identity Verification</DialogTitle>
          </div>
          <DialogDescription>
            Certify physical identity audit for{" "}
            <strong>{technician.full_name || "technician"}</strong> ({technician.workshop_name}).
          </DialogDescription>
        </DialogHeader>

        {/* Anti-PII & Physical Visit Policy Banner */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4 text-primary shrink-0" />
            <span>Strict Privacy & Zero-Aadhaar-Storage Mandate</span>
          </p>
          <p>
            Verify the technician's original government document physically at the Nagpur Service
            Centre counter.
            <strong> Do NOT upload scans, photographs, or full numbers.</strong> Only the canonical
            masked last-4 digits are recorded.
          </p>
        </div>

        {/* Live Validation Warning Banner */}
        {validationError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="font-medium">{validationError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Document Type Selector */}
          <div className="space-y-1.5">
            <Label htmlFor="docType" className="text-xs font-semibold">
              Government Document Inspected *
            </Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger id="docType" className="h-10 text-xs">
                <SelectValue placeholder="Select inspected document" />
              </SelectTrigger>
              <SelectContent>
                {APPROVED_KYC_DOCUMENT_TYPES.map((d) => (
                  <SelectItem key={d.code} value={d.code} className="text-xs">
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{activeDocConfig.description}</p>
          </div>

          {/* Masked ID Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="maskedId" className="text-xs font-semibold">
                Masked Document Identifier *
              </Label>
              <span className="font-mono text-[11px] text-muted-foreground">
                Format: {activeDocConfig.example}
              </span>
            </div>
            <Input
              id="maskedId"
              placeholder={activeDocConfig.example}
              value={maskedId}
              onChange={(e) => setMaskedId(e.target.value)}
              className={cn(
                "font-mono text-sm uppercase",
                validationError && "border-destructive focus-visible:ring-destructive",
              )}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Example: <strong>{activeDocConfig.example}</strong>. Full numbers are strictly
              rejected by backend triggers.
            </p>
          </div>

          {/* Remarks */}
          <div className="space-y-1.5">
            <Label htmlFor="remarks" className="text-xs font-semibold">
              Audit Notes & Physical Inspection Remarks
            </Label>
            <Input
              id="remarks"
              placeholder="e.g. Inspected original PVC card at Nagpur depot counter."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Note verifying officer name and inspection desk details. Do not type numbers longer
              than 5 digits.
            </p>
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || Boolean(validationError) || !maskedId.trim()}
              className="gap-1.5 bg-success text-primary-foreground hover:bg-success/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recording Audit…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Confirm Physical KYC
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ==============================================================================
// AI SKILLS CERTIFICATION WORKBENCH DIALOG
// ==============================================================================

interface SkillCertificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician: AdminTechnicianRow;
  onSuccess: () => void;
}

function SkillCertificationDialog({
  open,
  onOpenChange,
  technician,
  onSuccess,
}: SkillCertificationDialogProps) {
  const [workingTech, setWorkingTech] = useState<AdminTechnicianRow>(technician);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  useEffect(() => {
    setWorkingTech(technician);
  }, [technician]);

  const handleApprove = async (skill: string) => {
    setActionBusy(skill);
    try {
      const res = await approveTechnicianSkill(workingTech.id, skill);
      toast.success(`Skill "${skill}" certified and published to farmer view.`);
      setWorkingTech((prev) => ({
        ...prev,
        ai_suggested_skills: prev.ai_suggested_skills.filter((s) => s !== skill),
        verified_skills: res.verified_skills || [...prev.verified_skills, skill],
      }));
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to approve skill.";
      toast.error(msg);
    } finally {
      setActionBusy(null);
    }
  };

  const handleDismiss = async (skill: string) => {
    setActionBusy(skill);
    try {
      await dismissTechnicianSkill(workingTech.id, skill);
      toast.info(`Skill "${skill}" dismissed.`);
      setWorkingTech((prev) => ({
        ...prev,
        ai_suggested_skills: prev.ai_suggested_skills.filter((s) => s !== skill),
      }));
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to dismiss skill.";
      toast.error(msg);
    } finally {
      setActionBusy(null);
    }
  };

  const suggestedSkills = workingTech.ai_suggested_skills || [];
  const verifiedSkills = workingTech.verified_skills || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <DialogTitle>AI Skill Endorsement Workbench</DialogTitle>
          </div>
          <DialogDescription>
            Review machine learning suggestions and certify verified technical capabilities for{" "}
            <strong>{workingTech.full_name || "technician"}</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* Human-in-the-Loop Governance Notice */}
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-purple-600" />
            <span>Human-in-the-Loop Quality Gate</span>
          </p>
          <p>
            Skills extracted by Google Gemini visual breakdown assessments remain quarantined in{" "}
            <strong>AI Suggested Skills</strong> until certified by a Service Centre administrator.
            Once approved, they immediately publish to farmers on public cards.
          </p>
        </div>

        <div className="space-y-5 py-2">
          {/* Pending AI Suggested Skills */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Pending AI Suggested Skills ({suggestedSkills.length})
              </h3>
              <Badge variant="outline" className="text-[10px]">
                Quarantined
              </Badge>
            </div>

            {suggestedSkills.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                No pending AI skill suggestions for this technician.
              </div>
            ) : (
              <div className="space-y-2">
                {suggestedSkills.map((skill) => {
                  const isBusy = actionBusy === skill;
                  return (
                    <div
                      key={skill}
                      className="flex items-center justify-between gap-3 rounded-xl border border-purple-500/20 bg-purple-500/[0.03] p-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{skill}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Extracted from diagnostic history · Nagpur Depot catalog
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => void handleDismiss(skill)}
                          className="h-7 text-xs text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          disabled={isBusy}
                          onClick={() => void handleApprove(skill)}
                          className="h-7 text-xs bg-success text-primary-foreground hover:bg-success/90"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Approve Skill
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Currently Verified Skills */}
          <div className="space-y-2 pt-2 border-t border-border">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Publicly Verified Skills ({verifiedSkills.length})
            </h3>
            {verifiedSkills.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No skills certified yet. Approved skills will appear here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {verifiedSkills.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2.5 py-1 text-xs font-semibold text-success"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
