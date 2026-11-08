import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/tb";
import { Badge } from "@/components/ui/badge";
import { History, Loader2, UserCheck, Wrench } from "lucide-react";
import {
  getRepairAssignmentHistory,
  type RepairAssignmentHistoryItem,
} from "@/lib/services/technicians";

interface AssignmentHistoryCardProps {
  repairId: string;
  refreshTrigger?: number;
}

export function AssignmentHistoryCard({ repairId, refreshTrigger }: AssignmentHistoryCardProps) {
  const [history, setHistory] = useState<RepairAssignmentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    if (!repairId) return;
    try {
      setLoading(true);
      const items = await getRepairAssignmentHistory(repairId);
      setHistory(items);
    } catch (err) {
      console.warn("[TerraByte] Failed to load assignment history:", err);
    } finally {
      setLoading(false);
    }
  }, [repairId]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory, refreshTrigger]);

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <History className="h-5 w-5 text-muted-foreground" />
          Technician Assignment History
        </h2>
        {history.length > 0 && (
          <Badge variant="outline" className="font-mono text-xs">
            {history.length} {history.length === 1 ? "entry" : "entries"}
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Loading assignment history…</span>
        </div>
      ) : history.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-2">
          No technician assignments or reassignments recorded for this repair yet.
        </p>
      ) : (
        <div className="space-y-3 divide-y divide-border/60">
          {history.map((item) => {
            const isReassignment = item.assignmentType === "REASSIGNMENT";
            const dateStr = new Date(item.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            });

            return (
              <div key={item.id} className="pt-3 first:pt-0 space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={isReassignment ? "secondary" : "default"}
                      className={`text-xs gap-1 font-semibold ${
                        isReassignment
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                          : "bg-primary text-primary-foreground"
                      }`}
                    >
                      {isReassignment ? (
                        <>
                          <UserCheck className="h-3 w-3" />
                          Reassignment
                        </>
                      ) : (
                        <>
                          <Wrench className="h-3 w-3" />
                          Initial Dispatch
                        </>
                      )}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{dateStr}</span>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">
                    By {item.assignedByName} ({item.assignedByRole})
                  </span>
                </div>

                <div className="text-foreground">
                  {isReassignment ? (
                    <p className="font-medium">
                      <span className="text-muted-foreground">
                        {item.previousTechnicianName || "Previous Technician"}
                      </span>
                      {" → "}
                      <span className="text-foreground font-semibold">
                        {item.assignedTechnicianName}
                      </span>
                    </p>
                  ) : (
                    <p className="font-medium">
                      Assigned to{" "}
                      <span className="font-semibold text-foreground">
                        {item.assignedTechnicianName}
                      </span>
                    </p>
                  )}
                </div>

                {item.reason && (
                  <div className="rounded-lg bg-muted/50 p-2 text-xs italic text-muted-foreground border border-border/50">
                    <span className="font-medium not-italic text-foreground">Reason: </span>
                    {item.reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
