import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  HelpCircle,
  Layers,
  Minus,
  TrendingDown,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { ClickableImage } from "@/components/tb";
import { inr } from "@/lib/tb-store";
import { cn } from "@/lib/utils";
import {
  compareQuoteVersions,
  type QuoteItemDiff,
  type QuoteRevisionInfo,
  type QuoteVersionComparison,
  type QuoteVersionDetail,
} from "@/lib/services/quotes";
import { ComponentErrorBoundary } from "@/components/component-error-boundary";

export interface QuoteComparisonProps {
  comparison?: QuoteVersionComparison | undefined;
  v1?: QuoteVersionDetail | undefined;
  v2?: QuoteVersionDetail | undefined;
  farmerRequest?: QuoteRevisionInfo | null | undefined;
  technicianResponse?: string | null | undefined;
  className?: string | undefined;
}

function QuoteComparisonInner({
  comparison: passedComparison,
  v1,
  v2,
  farmerRequest: passedFarmerRequest,
  technicianResponse: passedTechResponse,
  className,
}: QuoteComparisonProps) {
  let comparison: QuoteVersionComparison | null = passedComparison || null;

  if (!comparison && v1 && v2) {
    try {
      comparison = compareQuoteVersions(v1, v2);
    } catch (err) {
      console.error("[QuoteComparison] Error comparing quote versions:", err);
    }
  }

  if (!comparison) {
    return null;
  }

  const {
    v1: prevQuote,
    v2: newQuote,
    item_diffs,
    labour_v1,
    labour_v2,
    labour_difference,
    parts_v1,
    parts_v2,
    parts_difference,
    total_v1,
    total_v2,
    total_difference,
    percentage_change,
  } = comparison;

  // Resolve Farmer Revision Request
  const farmerRequest =
    passedFarmerRequest ??
    comparison.farmer_revision_request ??
    newQuote.revision_request ??
    prevQuote.revision_request;

  // Resolve Technician Response / Explanation
  const techResponse =
    passedTechResponse ??
    comparison.technician_explanation ??
    newQuote.technician_explanation;

  const isCostReduced = total_difference < 0;
  const isCostIncreased = total_difference > 0;

  return (
    <div className={cn("space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xs", className)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-bold">Quote Version Comparison</h3>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className="rounded-md bg-muted px-2 py-0.5 font-semibold text-muted-foreground">
            v{prevQuote.version} ({inr(total_v1)})
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="rounded-md bg-primary/15 px-2 py-0.5 font-bold text-primary">
            v{newQuote.version} ({inr(total_v2)})
          </span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {/* Total Price Diff */}
        <div
          className={cn(
            "rounded-xl border p-3 transition-colors",
            isCostReduced
              ? "border-success/30 bg-success/5"
              : isCostIncreased
              ? "border-warning/30 bg-warning/5"
              : "border-border bg-muted/40"
          )}
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Difference</span>
            {isCostReduced ? (
              <TrendingDown className="h-4 w-4 text-success" />
            ) : isCostIncreased ? (
              <TrendingUp className="h-4 w-4 text-warning-foreground" />
            ) : (
              <Minus className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <p
            className={cn(
              "mt-1 text-xl font-bold font-display",
              isCostReduced
                ? "text-success"
                : isCostIncreased
                ? "text-warning-foreground"
                : "text-foreground"
            )}
          >
            {total_difference > 0 ? `+${inr(total_difference)}` : inr(total_difference)}
          </p>
          <p className="text-[11px] font-medium text-muted-foreground">
            {total_difference === 0
              ? "No overall price change"
              : `${Math.abs(percentage_change)}% ${isCostReduced ? "lower" : "higher"} than v${prevQuote.version}`}
          </p>
        </div>

        {/* Parts Diff */}
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Parts & Consumables</span>
            <span className="font-mono text-[10px]">
              {inr(parts_v1)} → {inr(parts_v2)}
            </span>
          </div>
          <p
            className={cn(
              "mt-1 text-xl font-bold font-display",
              parts_difference < 0
                ? "text-success"
                : parts_difference > 0
                ? "text-warning-foreground"
                : "text-foreground"
            )}
          >
            {parts_difference > 0 ? `+${inr(parts_difference)}` : inr(parts_difference)}
          </p>
          <p className="text-[11px] font-medium text-muted-foreground">
            {parts_difference === 0
              ? "Identical parts cost"
              : parts_difference < 0
              ? "Reduced parts cost"
              : "Adjusted parts cost"}
          </p>
        </div>

        {/* Labour Diff */}
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Labour Charge</span>
            <span className="font-mono text-[10px]">
              {inr(labour_v1)} → {inr(labour_v2)}
            </span>
          </div>
          <p
            className={cn(
              "mt-1 text-xl font-bold font-display",
              labour_difference < 0
                ? "text-success"
                : labour_difference > 0
                ? "text-warning-foreground"
                : "text-foreground"
            )}
          >
            {labour_difference > 0 ? `+${inr(labour_difference)}` : inr(labour_difference)}
          </p>
          <p className="text-[11px] font-medium text-muted-foreground">
            {labour_difference === 0
              ? "Unchanged labour"
              : labour_difference < 0
              ? "Discounted labour"
              : "Adjusted labour"}
          </p>
        </div>
      </div>

      {/* Revision Request & Technician Response Preservation Callouts */}
      {(farmerRequest || techResponse) && (
        <div className="grid gap-3 sm:grid-cols-2 pt-1">
          {/* Farmer Request Callout */}
          {farmerRequest && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-2 text-sm">
              <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200">
                <HelpCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Farmer Revision Request</span>
              </div>
              {farmerRequest.reason && (
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Reason:
                  </span>{" "}
                  <span className="font-semibold text-foreground">{farmerRequest.reason}</span>
                </div>
              )}
              {farmerRequest.explanation && (
                <p className="rounded-lg bg-card/70 border border-amber-500/20 p-2 text-xs italic text-foreground leading-relaxed">
                  "{farmerRequest.explanation}"
                </p>
              )}
              {farmerRequest.photo && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Attachment:
                  </p>
                  <ClickableImage
                    src={farmerRequest.photo}
                    alt="Farmer revision photo"
                    className="mt-1 h-16 w-16"
                    thumbnailClassName="h-16 w-16 object-cover rounded-md"
                  />
                </div>
              )}
            </div>
          )}

          {/* Technician Response Callout */}
          {techResponse && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 space-y-2 text-sm">
              <div className="flex items-center gap-1.5 font-bold text-primary">
                <Wrench className="h-4 w-4 shrink-0 text-primary" />
                <span>Technician Response / Explanation</span>
              </div>
              <p className="rounded-lg bg-card/70 border border-primary/20 p-2 text-xs text-foreground leading-relaxed">
                "{techResponse}"
              </p>
            </div>
          )}
        </div>
      )}

      {/* Itemized Line-by-Line Diffs */}
      <div className="space-y-2 pt-1">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Line Item Changes
        </h4>
        <div className="space-y-1.5">
          {item_diffs.map((diff, idx) => (
            <ItemDiffRow key={idx} diff={diff} />
          ))}

          {/* Labour Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 p-2.5 text-xs sm:text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    labour_difference === 0
                      ? "bg-muted text-muted-foreground border border-border"
                      : labour_difference < 0
                      ? "bg-success/15 text-success border border-success/30"
                      : "bg-warning/15 text-warning-foreground border border-warning/30"
                  )}
                >
                  {labour_difference === 0 ? "Unchanged" : "Modified"}
                </span>
                <span className="font-semibold text-foreground">Labour Charge</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                {newQuote.labour_description || "Inspection, repair and test run"}
              </p>
            </div>
            <div className="text-right">
              <div className="font-mono font-semibold">
                {labour_difference !== 0 ? (
                  <>
                    <span className="text-muted-foreground line-through mr-1.5">
                      {inr(labour_v1)}
                    </span>
                    <span className="text-foreground">{inr(labour_v2)}</span>
                  </>
                ) : (
                  <span>{inr(labour_v2)}</span>
                )}
              </div>
              {labour_difference !== 0 && (
                <span
                  className={cn(
                    "text-[10px] font-mono font-semibold",
                    labour_difference < 0 ? "text-success" : "text-warning-foreground"
                  )}
                >
                  {labour_difference > 0 ? `+${inr(labour_difference)}` : inr(labour_difference)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemDiffRow({ diff }: { diff: QuoteItemDiff }) {
  const badgeConfig = {
    added: {
      label: "+ Added",
      className: "bg-success/15 text-success border-success/30",
    },
    removed: {
      label: "- Removed",
      className: "bg-destructive/15 text-destructive border-destructive/30",
    },
    modified: {
      label: "Modified",
      className: "bg-warning/15 text-warning-foreground border-warning/30",
    },
    unchanged: {
      label: "Unchanged",
      className: "bg-muted text-muted-foreground border-border",
    },
  }[diff.status];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-xl p-2.5 text-xs sm:text-sm border transition-colors",
        diff.status === "added"
          ? "border-success/20 bg-success/5"
          : diff.status === "removed"
          ? "border-destructive/20 bg-destructive/5 opacity-75"
          : diff.status === "modified"
          ? "border-warning/20 bg-warning/5"
          : "border-border/60 bg-muted/30"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border",
              badgeConfig.className
            )}
          >
            {badgeConfig.label}
          </span>
          <span
            className={cn(
              "font-semibold text-foreground truncate",
              diff.status === "removed" && "line-through text-muted-foreground"
            )}
          >
            {diff.part_name}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
          {diff.part_spec && <span>{diff.part_spec}</span>}
          {diff.part_source && <span>· {diff.part_source}</span>}
          {diff.status === "modified" && (
            <span>
              · Qty {diff.v1_quantity} @ {inr(diff.v1_unit_price || 0)} → Qty {diff.v2_quantity} @{" "}
              {inr(diff.v2_unit_price || 0)}
            </span>
          )}
          {diff.status === "added" && (
            <span>
              · Qty {diff.v2_quantity} @ {inr(diff.v2_unit_price || 0)}
            </span>
          )}
          {diff.status === "removed" && (
            <span>
              · Qty {diff.v1_quantity} @ {inr(diff.v1_unit_price || 0)}
            </span>
          )}
          {diff.status === "unchanged" && (
            <span>
              · Qty {diff.v1_quantity} @ {inr(diff.v1_unit_price || 0)}
            </span>
          )}
        </div>
      </div>

      <div className="text-right">
        <div className="font-mono font-semibold">
          {diff.status === "modified" ? (
            <>
              <span className="text-muted-foreground line-through mr-1.5 text-xs">
                {inr(diff.v1_total || 0)}
              </span>
              <span className="text-foreground">{inr(diff.v2_total || 0)}</span>
            </>
          ) : diff.status === "added" ? (
            <span className="text-foreground">{inr(diff.v2_total || 0)}</span>
          ) : diff.status === "removed" ? (
            <span className="text-muted-foreground line-through">{inr(diff.v1_total || 0)}</span>
          ) : (
            <span>{inr(diff.v1_total || 0)}</span>
          )}
        </div>
        {diff.price_difference !== undefined && diff.price_difference !== 0 && (
          <span
            className={cn(
              "text-[10px] font-mono font-semibold",
              diff.price_difference < 0 ? "text-success" : "text-warning-foreground"
            )}
          >
            {diff.price_difference > 0
              ? `+${inr(diff.price_difference)}`
              : inr(diff.price_difference)}
          </span>
        )}
      </div>
    </div>
  );
}

export function QuoteComparison(props: QuoteComparisonProps) {
  return (
    <ComponentErrorBoundary name="Quote Comparison">
      <QuoteComparisonInner {...props} />
    </ComponentErrorBoundary>
  );
}
