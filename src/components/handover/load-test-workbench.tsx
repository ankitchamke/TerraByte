import { useState } from "react";
import { AlertCircle, CheckCircle2, Gauge, Loader2, Thermometer, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Card, Label, btn, input } from "@/components/tb";
import { cn } from "@/lib/utils";
import { formatLoadTestNotes, recordLoadTestSignoff } from "@/lib/services/handover";

export interface LoadTestWorkbenchProps {
  repairId: string;
  isTesting?: boolean;
  loadTestPassed?: boolean | null;
  loadTestNotes?: string | null;
  loadTestedAt?: string | null;
  onSignoffSuccess?: (passed: boolean, notes: string) => Promise<void> | void;
  onResumeRepair?: () => Promise<void> | void;
  className?: string;
}

export function LoadTestWorkbench({
  repairId,
  isTesting = false,
  loadTestPassed,
  loadTestNotes,
  loadTestedAt,
  onSignoffSuccess,
  onResumeRepair,
  className,
}: LoadTestWorkbenchProps) {
  const [tempC, setTempC] = useState("");
  const [pressureBar, setPressureBar] = useState("");
  const [rpm, setRpm] = useState("");
  const [observations, setObservations] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);

  const effectivePassed = editing ? null : loadTestPassed;
  const effectiveNotes = loadTestNotes || "";

  const handleSignoff = async (passed: boolean) => {
    const formattedNotes = formatLoadTestNotes({
      temperatureC: tempC.trim() || undefined,
      hydraulicPressureBar: pressureBar.trim() || undefined,
      engineRpm: rpm.trim() || undefined,
      observations:
        observations.trim() ||
        (passed
          ? "Operational load testing completed. Machinery performing within factory specifications."
          : "Operational load testing failed. Deficiencies identified under load."),
    });

    if (formattedNotes.length < 10) {
      toast.error("Please enter at least 10 characters of observations.");
      return;
    }

    setSubmitting(true);
    try {
      await recordLoadTestSignoff({
        repairId,
        passed,
        notes: formattedNotes,
      });

      setEditing(false);
      if (passed) {
        toast.success("Operational load-test sign-off recorded: PASSED");
      } else {
        toast.error("Operational load-test sign-off recorded: FAILED. Repair sign-off blocked.");
      }

      if (onSignoffSuccess) {
        await onSignoffSuccess(passed, formattedNotes);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to record load-test sign-off";
      console.error("[TerraByte] Load test signoff error:", err);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* State 1: Test Passed */}
      {effectivePassed === true && (
        <Card className="border-success/40 bg-success/5 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-success">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>Operational Load Test Passed & Verified</span>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground underline"
            >
              Re-test / update
            </button>
          </div>
          {effectiveNotes && (
            <p className="text-xs font-mono text-muted-foreground bg-background/80 p-2.5 rounded-lg border border-border">
              {effectiveNotes}
            </p>
          )}
          {loadTestedAt && (
            <p className="text-[11px] text-muted-foreground">
              Sign-off verified: {new Date(loadTestedAt).toLocaleString()}
            </p>
          )}
        </Card>
      )}

      {/* State 2: Test Failed - AC-13-F13: Prominent red warning banner */}
      {effectivePassed === false && (
        <Card className="border-destructive bg-destructive/10 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-destructive text-base">
                Operational Load Test FAILED — Sign-Off Blocked
              </h4>
              <p className="text-xs text-destructive/90 leading-relaxed">
                The machinery did not meet operational benchmarks under load. Final repair sign-off
                is strictly BLOCKED. You must resume repair to resolve mechanical issues before this
                job can be completed.
              </p>
            </div>
          </div>
          {effectiveNotes && (
            <p className="text-xs font-mono text-destructive bg-background/90 p-2.5 rounded-lg border border-destructive/30">
              {effectiveNotes}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {onResumeRepair && (
              <button
                type="button"
                onClick={onResumeRepair}
                className={cn(btn.urgent, "text-xs py-2 px-3")}
              >
                <Wrench className="h-3.5 w-3.5" />
                Resume Repair to Fix Deficiencies
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(btn.ghost, "text-xs py-2 px-3")}
            >
              Re-run Load Test
            </button>
          </div>
        </Card>
      )}

      {/* State 3: Test Entry Form (Not recorded yet or editing) */}
      {(effectivePassed === null || effectivePassed === undefined) && (
        <Card className="border-border space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            <h4 className="font-bold text-foreground text-sm">
              Operational Load Testing Workbench
            </h4>
          </div>
          <p className="text-xs text-muted-foreground">
            Test the machinery under real operational load (operating temperature, hydraulic load,
            and working RPM) before final sign-off.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs flex items-center gap-1">
                <Thermometer className="h-3 w-3 text-muted-foreground" />
                Engine Temp (°C)
              </Label>
              <input
                type="number"
                min={0}
                max={150}
                placeholder="e.g. 85"
                className={input}
                value={tempC}
                onChange={(e) => setTempC(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">
                <Gauge className="h-3 w-3 text-muted-foreground" />
                Pressure (bar)
              </Label>
              <input
                type="number"
                min={0}
                max={500}
                placeholder="e.g. 190"
                className={input}
                value={pressureBar}
                onChange={(e) => setPressureBar(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">
                <Gauge className="h-3 w-3 text-muted-foreground" />
                Engine RPM
              </Label>
              <input
                type="number"
                min={0}
                max={5000}
                placeholder="e.g. 2100"
                className={input}
                value={rpm}
                onChange={(e) => setRpm(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">
              Observations & Performance Notes <span className="text-destructive">*</span> (min 10
              chars)
            </Label>
            <textarea
              rows={2}
              className={input}
              placeholder="e.g. Operating temperature stable under full load, hydraulic cylinders responsive, zero fluid leaks."
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSignoff(false)}
              className={cn(btn.urgent, "text-xs py-2 disabled:opacity-50")}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5" />
              )}
              Record Test Failure
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSignoff(true)}
              className={cn(btn.primary, "text-xs py-2 disabled:opacity-50")}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Record Test Pass
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
