import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Package,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, Label, StatusPill } from "@/components/tb";
import { inr } from "@/lib/tb-store";
import { DefectAnnotationCanvas } from "./defect-annotation-canvas";
import {
  triggerVisualDiagnostic,
  grantFarmerVisualConsent,
  revokeFarmerVisualConsent,
} from "@/lib/services/visual-diagnostics-client";
import {
  type ConfidenceLevel,
  type DefectSeverity,
  type VisualAnomaly,
  type VisualDiagnosticsData,
} from "@/lib/types/visual-diagnostics";
import { cn } from "@/lib/utils";

export interface VisualDefectDiagnosticViewerProps {
  repairId: string;
  visualDiagnostics?: VisualDiagnosticsData | null | undefined;
  photos?: string[] | undefined;
  equipment?:
    | {
        make: string;
        model: string;
        year?: number | null | undefined;
      }
    | null
    | undefined;
  userRole?: "farmer" | "technician" | "admin" | undefined;
  isAssignedTechnician?: boolean | undefined;
  onRefresh?: (() => Promise<void> | void) | undefined;
  className?: string | undefined;
}

function getConfidenceBadge(confidence?: ConfidenceLevel) {
  switch (confidence) {
    case "HIGH":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-bold text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> High Confidence
        </span>
      );
    case "MEDIUM":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-info/15 px-2.5 py-0.5 text-xs font-bold text-info">
          <CheckCircle2 className="h-3.5 w-3.5" /> Medium Confidence
        </span>
      );
    case "LOW":
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-bold text-warning-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Low Confidence
        </span>
      );
  }
}

function getSeverityBadge(sev: DefectSeverity) {
  switch (sev) {
    case "CRITICAL":
      return (
        <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground uppercase tracking-wider">
          Critical
        </span>
      );
    case "HIGH":
      return (
        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white uppercase tracking-wider">
          High
        </span>
      );
    case "MEDIUM":
      return (
        <span className="rounded-full bg-info px-2 py-0.5 text-[11px] font-bold text-info-foreground uppercase tracking-wider">
          Medium
        </span>
      );
    case "LOW":
    default:
      return (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Low
        </span>
      );
  }
}

export function VisualDefectDiagnosticViewer({
  repairId,
  visualDiagnostics,
  photos = [],
  equipment,
  userRole = "farmer",
  isAssignedTechnician = false,
  onRefresh,
  className,
}: VisualDefectDiagnosticViewerProps) {
  const [selectedAnomalyIndex, setSelectedAnomalyIndex] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [consentUpdating, setConsentUpdating] = useState(false);

  const vd = visualDiagnostics;
  const status = vd?.status || "NOT_REQUESTED";
  const consent = vd?.consent;
  const hasConsent = consent?.optInGranted === true;

  const canForceRescan =
    userRole === "admin" || (userRole === "technician" && isAssignedTechnician);

  const handleTriggerAnalysis = async (force: boolean = false) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await triggerVisualDiagnostic(repairId, force);
      if (res.success) {
        toast.success("AI visual defect analysis complete.");
        if (onRefresh) await onRefresh();
      } else {
        if (res.error === "COOLDOWN_ACTIVE") {
          toast.info(
            `Cooldown active. Please wait ${res.retryAfterSeconds || 30}s before retrying.`,
          );
        } else {
          toast.error(res.details || res.error || "Analysis failed.");
        }
        if (onRefresh) await onRefresh();
      }
    } catch (err: unknown) {
      toast.error("An unexpected error occurred during visual defect analysis.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleConsent = async (grant: boolean) => {
    if (consentUpdating || isSubmitting) return;
    setConsentUpdating(true);
    try {
      const res = grant
        ? await grantFarmerVisualConsent(repairId)
        : await revokeFarmerVisualConsent(repairId);

      if (res.success) {
        toast.success(
          grant ? "AI visual analysis authorized." : "AI visual analysis consent withdrawn.",
        );
        if (onRefresh) await onRefresh();
        if (grant) {
          await handleTriggerAnalysis(false);
        }
      } else {
        toast.error(res.error || "Failed to update consent status.");
      }
    } catch {
      toast.error("Failed to update consent status.");
    } finally {
      setConsentUpdating(false);
    }
  };

  return (
    <Card className={cn("space-y-4 border-primary/20", className)}>
      {/* Header with Title, Status & Confidence Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary">
            <Eye className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              Visual Defect Diagnostics
              <span className="rounded-sm border border-dashed border-primary/40 px-1.5 py-0.2 font-mono text-[10px] uppercase tracking-wider text-primary">
                Gemini 3.5 AI
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Multimodal photo inspection & component damage assessment
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {status === "ANALYZED" && getConfidenceBadge(vd?.visualConfidence)}
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-semibold",
              status === "ANALYZED" && "bg-success/15 text-success",
              status === "PROCESSING" && "bg-primary/15 text-primary animate-pulse",
              status === "RETRYABLE_ERROR" && "bg-warning/15 text-warning-foreground",
              status === "FAILED" && "bg-destructive/15 text-destructive",
              status === "SKIPPED" && "bg-muted text-muted-foreground",
              status === "NOT_REQUESTED" && "bg-muted text-muted-foreground",
            )}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Mandatory Non-Authoritative Assistive Disclaimer */}
      <div className="rounded-xl bg-info/10 border border-info/20 p-2.5 text-xs text-info flex items-start gap-2">
        <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <p className="leading-relaxed">
          <span className="font-semibold text-foreground">Assistive Preliminary Assessment:</span>{" "}
          Physical on-site inspection by a certified technician is authoritative. AI visual
          observations do not commit parts, quotes, or repair authorization.
        </p>
      </div>

      {/* State View 1: PROCESSING */}
      {status === "PROCESSING" && (
        <div className="space-y-4 py-6 text-center">
          <div className="flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <h4 className="text-base font-bold text-foreground">Analyzing Breakdown Photos</h4>
            <p className="text-xs text-muted-foreground max-w-md">
              Google Gemini 3.5 Flash-Lite is inspecting machinery photographs for visible cracks,
              fluid leaks, wiring faults, and matching Central Nagpur Depot catalog parts...
            </p>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onRefresh && onRefresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh Status
          </button>
        </div>
      )}

      {/* State View 2: RETRYABLE_ERROR or FAILED */}
      {(status === "RETRYABLE_ERROR" || status === "FAILED") && (
        <div className="space-y-3 rounded-2xl bg-destructive/10 border border-destructive/20 p-4">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-destructive">
                {status === "RETRYABLE_ERROR"
                  ? "Diagnostic Capacity or Timeout Notice"
                  : "Visual Analysis Incomplete"}
              </h4>
              <p className="text-xs text-foreground/80 leading-relaxed">
                {vd?.lastErrorMessage ||
                  "The visual diagnostics engine encountered an issue. Standard symptom-based triage remains active."}
              </p>
              {vd?.lastErrorCode && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  Code: {vd.lastErrorCode} · Attempts: {vd.attempts ?? 0}/3
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleTriggerAnalysis(canForceRescan)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-destructive px-3.5 py-1.5 text-xs font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {canForceRescan ? "Staff Force Rescan" : "Retry Analysis"}
            </button>
          </div>
        </div>
      )}

      {/* State View 3: SKIPPED (Consent Not Granted or Withdrawn) */}
      {status === "SKIPPED" && (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-center space-y-2">
          <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <h4 className="text-sm font-bold text-foreground">
            AI Visual Diagnostics Not Authorized
          </h4>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {vd?.reason === "CONSENT_WITHDRAWN_BY_FARMER"
              ? "Consent for AI visual analysis was withdrawn by the farmer. Photos were not transmitted to Gemini."
              : "Farmer has not opted in to AI visual diagnostics for this ticket. The repair continues using standard field triage."}
          </p>

          {userRole === "farmer" && (
            <div className="pt-2">
              <button
                type="button"
                disabled={consentUpdating || isSubmitting}
                onClick={() => handleToggleConsent(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {consentUpdating || isSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {isSubmitting ? "Running AI Analysis…" : "Authorize & Run AI Analysis"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* State View 4: NOT_REQUESTED */}
      {status === "NOT_REQUESTED" && (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-center space-y-2">
          <Eye className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <h4 className="text-sm font-bold text-foreground">Visual Defect Diagnostics Available</h4>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {photos.length > 0
              ? `${photos.length} photo(s) attached. AI visual inspection can identify visible anomalies and suggest compatible depot parts.`
              : "No photos attached. Take or upload breakdown photos to run visual defect diagnostics."}
          </p>

          {photos.length > 0 && (
            <div className="pt-2 flex items-center justify-center gap-2">
              {!hasConsent && userRole === "farmer" && (
                <button
                  type="button"
                  disabled={consentUpdating || isSubmitting}
                  onClick={() => handleToggleConsent(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {consentUpdating || isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {isSubmitting ? "Running AI Analysis…" : "Authorize AI Analysis"}
                </button>
              )}
              {hasConsent && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleTriggerAnalysis(false)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Run Visual Analysis
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* State View 5: ANALYZED (Findings Display) */}
      {status === "ANALYZED" && (
        <div className="space-y-4">
          {/* Overall Visual Summary */}
          {vd?.overallVisualSummary && (
            <div className="rounded-2xl bg-card border-2 border-border p-3.5 space-y-1">
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Overall Visual Assessment
              </Label>
              <p className="text-sm font-medium leading-relaxed text-foreground">
                {vd.overallVisualSummary}
              </p>
              {vd.analyzedAt && (
                <p className="font-mono text-[10px] text-muted-foreground pt-1">
                  Analyzed: {new Date(vd.analyzedAt).toLocaleString("en-IN")}
                </p>
              )}
            </div>
          )}

          {/* Interactive Defect Canvas & Annotations */}
          {photos && photos.length > 0 && (
            <div>
              <Label className="mb-2 block text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Interactive Defect Map
              </Label>
              <DefectAnnotationCanvas
                photos={photos}
                anomalies={vd?.visualAnomalies || []}
                selectedAnomalyIndex={selectedAnomalyIndex}
                onSelectAnomaly={setSelectedAnomalyIndex}
                allowUserPins={true}
              />
            </div>
          )}

          {/* Visual Anomalies List */}
          {vd?.visualAnomalies && vd.visualAnomalies.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Detected Anomalies ({vd.visualAnomalies.length})
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Select an item to highlight on photo
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {vd.visualAnomalies.map((anomaly, idx) => {
                  const isSelected = selectedAnomalyIndex === idx;
                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedAnomalyIndex(isSelected ? null : idx)}
                      className={cn(
                        "cursor-pointer rounded-2xl border-2 p-3 transition-all",
                        isSelected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-card hover:border-foreground/20",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-bold text-foreground">
                            {anomaly.system}
                          </span>
                        </div>
                        {getSeverityBadge(anomaly.severity)}
                      </div>

                      <h4 className="mt-1.5 text-sm font-semibold text-foreground">
                        {anomaly.defectType}
                      </h4>

                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {anomaly.observation}
                      </p>

                      {anomaly.recommendation && (
                        <p className="mt-2 text-[11px] font-medium text-primary/90 bg-muted/40 rounded-lg p-1.5">
                          <b>Advice:</b> {anomaly.recommendation}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Staged Nagpur Central Depot Catalog Parts */}
          {vd?.stagedParts && vd.stagedParts.length > 0 && (
            <div className="space-y-2 rounded-2xl border-2 border-border bg-card p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <Label className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Staged Depot Parts ({vd.stagedParts.length})
                  </Label>
                </div>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  Nagpur Central Depot
                </span>
              </div>

              <div className="space-y-2 pt-1">
                {vd.stagedParts.map((part, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 p-2.5 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{part.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          #{part.partNumber}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-[11px]">
                        Category: {part.category} · Qty {part.estimatedQuantity} · Stock:{" "}
                        {part.currentStock}
                      </p>
                      {part.reasoning && (
                        <p className="text-[11px] text-foreground/80 italic">"{part.reasoning}"</p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-bold text-foreground">{inr(part.unitPrice)}</p>
                      <span className="text-[10px] font-semibold text-primary">
                        {part.confidence} Match
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Essential Safety Guidance */}
          {vd?.safetyGuidance && vd.safetyGuidance.length > 0 && (
            <div className="rounded-2xl border border-warning/30 bg-warning/10 p-3.5 space-y-1.5">
              <div className="flex items-center gap-2 text-warning-foreground font-bold text-xs uppercase tracking-wider">
                <Shield className="h-4 w-4" /> Safety Guidance
              </div>
              <ul className="list-disc list-inside space-y-1 text-xs text-foreground/90 leading-relaxed">
                {vd.safetyGuidance.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Staff Action & Consent Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60 text-xs">
            <div className="text-muted-foreground">
              {hasConsent ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Farmer Consent Active
                </span>
              ) : (
                <span className="text-muted-foreground">No active consent</span>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {userRole === "farmer" && hasConsent && (
                <button
                  type="button"
                  disabled={consentUpdating}
                  onClick={() => handleToggleConsent(false)}
                  className="text-xs text-muted-foreground hover:text-destructive underline"
                >
                  Revoke Consent
                </button>
              )}

              {canForceRescan && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleTriggerAnalysis(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Force Re-scan
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
