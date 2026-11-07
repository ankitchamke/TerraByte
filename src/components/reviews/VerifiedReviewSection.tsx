import React, { useState, useEffect } from "react";
import { Star, ShieldCheck, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import {
  getRepairReview,
  submitTechnicianReview,
  checkReviewEligibility,
  detectSensitiveDataInComment,
  type TechnicianReview,
} from "@/lib/services/reviews";
import { getServiceHistoryForRepair } from "@/lib/services/service-history";

interface VerifiedReviewSectionProps {
  repairId: string;
  technicianName: string;
  technicianProfileId: string;
  serviceHistoryId?: string | null;
  facilityId?: string | null;
  isCompleted: boolean;
  onReviewSubmitted?: (review: TechnicianReview) => void;
}

export function VerifiedReviewSection({
  repairId,
  technicianName,
  technicianProfileId,
  serviceHistoryId,
  facilityId,
  isCompleted,
  onReviewSubmitted,
}: VerifiedReviewSectionProps) {
  const { t } = useTranslation();

  const [review, setReview] = useState<TechnicianReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [overallRating, setOverallRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [timelinessRating, setTimelinessRating] = useState<number>(0);
  const [qualityRating, setQualityRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [resolvedHistoryId, setResolvedHistoryId] = useState<string | null>(
    serviceHistoryId || null,
  );

  useEffect(() => {
    let isMounted = true;
    async function loadExistingReview() {
      if (!repairId) return;
      try {
        setLoading(true);
        const existing = await getRepairReview(repairId);
        if (isMounted) {
          setReview(existing);
        }

        // Resolve service history ID if not passed
        if (!serviceHistoryId) {
          const history = await getServiceHistoryForRepair(repairId).catch(() => null);
          if (isMounted && history?.id) {
            setResolvedHistoryId(history.id);
          }
        }
      } catch (err: unknown) {
        console.warn("[TerraByte] Review load note:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadExistingReview();
    return () => {
      isMounted = false;
    };
  }, [repairId, serviceHistoryId]);

  if (!isCompleted) {
    return null;
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground space-y-2">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
        <p>Loading verified review status…</p>
      </div>
    );
  }

  // 1. Existing Review Card (Read-Only)
  if (review) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/5 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-success/20 pb-4">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-success/15 p-2 text-success">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">{t("reviews.submittedTitle")}</h3>
              <p className="text-xs text-muted-foreground">
                Permanently recorded for {technicianName}
              </p>
            </div>
          </div>
          <Badge className="bg-success text-primary-foreground text-xs gap-1 py-1 px-3">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("reviews.verifiedBadge")}
          </Badge>
        </div>

        {/* Stars and Ratings Display */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={cn(
                    "h-6 w-6",
                    star <= review.rating ? "fill-accent text-accent" : "text-muted-foreground/30",
                  )}
                />
              ))}
            </div>
            <span className="font-display text-xl font-bold text-foreground">
              {review.rating}.0 / 5.0
            </span>
          </div>

          {(review.timeliness_rating || review.quality_rating) && (
            <div className="grid grid-cols-2 gap-3 text-xs pt-1">
              {review.timeliness_rating && (
                <div className="rounded-xl bg-card border border-border/60 p-2.5 space-y-1">
                  <p className="text-muted-foreground">{t("reviews.timelinessRating")}</p>
                  <p className="font-semibold text-foreground flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                    {review.timeliness_rating} / 5
                  </p>
                </div>
              )}
              {review.quality_rating && (
                <div className="rounded-xl bg-card border border-border/60 p-2.5 space-y-1">
                  <p className="text-muted-foreground">{t("reviews.qualityRating")}</p>
                  <p className="font-semibold text-foreground flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                    {review.quality_rating} / 5
                  </p>
                </div>
              )}
            </div>
          )}

          {review.comment && (
            <div className="rounded-xl bg-card border border-border/80 p-3.5 text-sm text-foreground">
              <p className="text-xs text-muted-foreground font-semibold mb-1">
                {t("reviews.commentsLabel")}
              </p>
              <p className="whitespace-pre-wrap">{review.comment}</p>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground italic">
            Submitted on{" "}
            {new Date(review.created_at).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}{" "}
            · Immutable machinery service ledger
          </p>
        </div>
      </div>
    );
  }

  // 2. Review Submission Form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (overallRating < 1 || overallRating > 5) {
      setError(t("reviews.errorRequiredRating"));
      return;
    }

    if (detectSensitiveDataInComment(comment)) {
      setError(t("reviews.errorCommentsSensitive"));
      return;
    }

    try {
      setSubmitting(true);

      // Check eligibility & resolve service history if needed
      let targetHistoryId = resolvedHistoryId;
      if (!targetHistoryId) {
        const eligibility = await checkReviewEligibility(repairId);
        if (!eligibility.isEligible) {
          throw new Error(eligibility.reason || "Not eligible to review this repair.");
        }
        targetHistoryId = eligibility.serviceHistory?.id || null;
      }

      if (!targetHistoryId) {
        throw new Error(
          "Service history record is not yet available for this completed repair. Please try again shortly.",
        );
      }

      const created = await submitTechnicianReview({
        repairId,
        serviceHistoryId: targetHistoryId,
        technicianProfileId,
        facilityId: facilityId || null,
        rating: overallRating,
        comment: comment.trim() || null,
        timelinessRating: timelinessRating > 0 ? timelinessRating : null,
        qualityRating: qualityRating > 0 ? qualityRating : null,
      });

      setReview(created);
      toast.success(t("reviews.successToast"));
      if (onReviewSubmitted) {
        onReviewSubmitted(created);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit review";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-primary/20 bg-card p-6 space-y-4">
      <div className="flex items-start gap-3 border-b border-border/60 pb-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Star className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-foreground">{t("reviews.rateTechnician")}</h3>
          <p className="text-xs text-muted-foreground">{t("reviews.reviewSubtitle")}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Overall Star Rating */}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground flex items-center gap-1">
            <span>{t("reviews.overallRating")}</span>
            <span className="text-destructive">*</span>
          </label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => {
                const isActive = (hoverRating || overallRating) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setOverallRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1 rounded-lg transition-transform hover:scale-110 focus:outline-hidden focus:ring-2 focus:ring-primary"
                    aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                  >
                    <Star
                      className={cn(
                        "h-8 w-8 transition-colors",
                        isActive
                          ? "fill-accent text-accent"
                          : "text-muted-foreground/30 hover:text-muted-foreground/60",
                      )}
                    />
                  </button>
                );
              })}
            </div>
            {overallRating > 0 && (
              <span className="font-display text-lg font-bold text-primary ml-2">
                {overallRating}.0 / 5
              </span>
            )}
          </div>
        </div>

        {/* Sub-ratings: Timeliness & Quality */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Timeliness */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-1.5">
            <label className="text-xs font-semibold text-foreground block">
              {t("reviews.timelinessRating")}
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setTimelinessRating(star === timelinessRating ? 0 : star)}
                  className="p-0.5 rounded-sm"
                  aria-label={`Timeliness ${star} stars`}
                >
                  <Star
                    className={cn(
                      "h-5 w-5",
                      star <= timelinessRating
                        ? "fill-accent text-accent"
                        : "text-muted-foreground/30",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Quality of Work */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-1.5">
            <label className="text-xs font-semibold text-foreground block">
              {t("reviews.qualityRating")}
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setQualityRating(star === qualityRating ? 0 : star)}
                  className="p-0.5 rounded-sm"
                  aria-label={`Quality ${star} stars`}
                >
                  <Star
                    className={cn(
                      "h-5 w-5",
                      star <= qualityRating
                        ? "fill-accent text-accent"
                        : "text-muted-foreground/30",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Written Review Comments */}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground block">
            {t("reviews.commentsLabel")}
          </label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("reviews.commentsPlaceholder")}
            rows={3}
            maxLength={500}
            className="text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            {500 - comment.length} characters remaining · Do not include private phone numbers.
          </p>
        </div>

        {/* Submit Action */}
        <Button
          type="submit"
          disabled={submitting || overallRating === 0}
          className="w-full h-11 text-base font-bold bg-primary text-primary-foreground"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("reviews.submittingBtn")}
            </>
          ) : (
            t("reviews.submitBtn")
          )}
        </Button>
      </form>
    </div>
  );
}
