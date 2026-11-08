import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  Clock,
  Filter,
  Loader2,
  Phone,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { ContextualBack, DemoTag } from "@/components/tb";
import { useAuth } from "@/lib/auth";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAllFacilitiesAdmin,
  toggleDropOffApproval,
  VIDARBHA_TAHSILS,
} from "@/lib/services/facilities";
import { WorkshopOperationsDesk } from "@/components/facilities/workshop-operations-desk";

export const Route = createFileRoute("/admin/facilities")({
  head: () =>
    meta(
      "Workshop & Facility Governance",
      "Manage registered field workshops and public drop-off points across Vidarbha.",
    ),
  component: FacilitiesManagement,
});

type AdminFacilityItem = Awaited<ReturnType<typeof getAllFacilitiesAdmin>>[number];

function FacilitiesManagement() {
  const { profile, loading: authLoading } = useAuth();
  const [facilities, setFacilities] = useState<AdminFacilityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTahsil, setSelectedTahsil] = useState<string>("ALL");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedDeskFacility, setSelectedDeskFacility] = useState<AdminFacilityItem | null>(null);

  const loadFacilities = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getAllFacilitiesAdmin();
      setFacilities(data);
    } catch (err: unknown) {
      console.error("[TerraByte] Error loading facilities for admin:", err);
      setError(err instanceof Error ? err.message : "Failed to load facilities.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFacilities();
  }, [loadFacilities]);

  const handleToggleDropOff = async (fac: AdminFacilityItem, nextVal: boolean) => {
    try {
      setUpdatingId(fac.id);
      await toggleDropOffApproval(fac.id, nextVal);
      toast.success(
        nextVal
          ? `Public drop-off approved for ${fac.name}. Farmers can now route drop-offs here.`
          : `Drop-off status set to Private Field Base for ${fac.name}.`,
      );
      // Optimistic update in local list
      setFacilities((prev) =>
        prev.map((f) => (f.id === fac.id ? { ...f, drop_off_approved: nextVal } : f)),
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update drop-off approval.");
      void loadFacilities();
    } finally {
      setUpdatingId(null);
    }
  };

  const filtered = facilities.filter((f) => {
    const matchesSearch =
      search.trim() === "" ||
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.village.toLowerCase().includes(search.toLowerCase()) ||
      f.tahsil.toLowerCase().includes(search.toLowerCase()) ||
      f.owner_name.toLowerCase().includes(search.toLowerCase());

    const matchesTahsil = selectedTahsil === "ALL" || f.tahsil === selectedTahsil;

    return matchesSearch && matchesTahsil;
  });

  const totalFacilities = facilities.length;
  const approvedDropOffs = facilities.filter((f) => f.drop_off_approved).length;
  const totalBays = facilities.reduce((acc, f) => acc + (f.max_equipment_capacity || 4), 0);
  const uniqueTahsils = new Set(facilities.map((f) => f.tahsil)).size;

  if (
    !authLoading &&
    profile &&
    profile.role !== "admin" &&
    (profile as any).role !== "service_centre"
  ) {
    return (
      <div className="space-y-6">
        <ContextualBack to="/admin" label="Repair operations" />
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-8 text-center space-y-3">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
          <h2 className="text-xl font-bold text-destructive">Access Restricted</h2>
          <p className="max-w-md mx-auto text-sm text-muted-foreground">
            Only Nagpur Service Centre administrators have permission to manage workshop facilities
            and grant public drop-off authorizations.
          </p>
          <div className="pt-2">
            <Link
              to="/admin"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Return to Pipeline
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ContextualBack to="/admin" label="Repair operations" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Nagpur Regional Network · Vidarbha
          </p>
          <h1 className="text-3xl font-bold">Workshop facilities & bays</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Governance of registered field workshops and public drop-off bay authorization.
          </p>
        </div>
        <DemoTag />
      </div>

      {/* Quick Metrics Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Total Workshops</p>
          <p className="text-2xl font-bold">{totalFacilities}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Approved Drop-Offs</p>
          <p className="text-2xl font-bold text-success">{approvedDropOffs}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Total Bay Capacity</p>
          <p className="text-2xl font-bold">{totalBays} machines</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Tahsils Covered</p>
          <p className="text-2xl font-bold">{uniqueTahsils} / 13</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by workshop, village, owner…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="w-[180px]">
          <Select value={selectedTahsil} onValueChange={setSelectedTahsil}>
            <SelectTrigger>
              <SelectValue placeholder="All Tahsils" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Tahsils</SelectItem>
              {VIDARBHA_TAHSILS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load facilities: {error}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Loading Vidarbha workshop network…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground space-y-2">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="font-semibold">No workshop facilities match your criteria</p>
          <p className="text-xs">
            Adjust search query or tahsil filter to see registered workshops.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((fac) => {
            const isUpdating = updatingId === fac.id;
            const hours = (fac.operating_hours as Record<string, unknown> | null) || {};

            return (
              <div
                key={fac.id}
                className={cn(
                  "rounded-2xl border bg-card p-5 transition-colors space-y-4",
                  fac.drop_off_approved ? "border-success/40" : "border-border",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold">{fac.name}</h2>
                      {fac.drop_off_approved ? (
                        <Badge className="bg-success text-success-foreground text-xs gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Approved Drop-Off Point
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-xs">
                          Private Field Base
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {fac.village}, {fac.tahsil} · Nagpur District
                    </p>
                  </div>

                  {/* Drop-off approval toggle switch */}
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2">
                    <div className="text-right">
                      <p className="text-xs font-semibold leading-none">Public Drop-Off</p>
                      <p className="text-[11px] text-muted-foreground">
                        {fac.drop_off_approved
                          ? "Approved & routing enabled"
                          : "Disabled (Field only)"}
                      </p>
                    </div>
                    <Switch
                      checked={fac.drop_off_approved}
                      disabled={isUpdating}
                      onCheckedChange={(checked) => void handleToggleDropOff(fac, checked)}
                      aria-label={`Toggle public drop-off approval for ${fac.name}`}
                    />
                  </div>
                </div>

                {/* Facility Operational Details Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                    <span className="text-muted-foreground">Current Owner</span>
                    <p className="font-semibold text-foreground truncate">{fac.owner_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {fac.owner_phone || "No phone"}
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                    <span className="text-muted-foreground">Capacity & Active Bays</span>
                    <p className="font-semibold text-foreground">
                      {fac.max_equipment_capacity || 4} Machine Bays
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {fac.active_members_count} active technician
                      {fac.active_members_count === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                    <span className="text-muted-foreground">Operating Hours</span>
                    <p className="font-semibold text-foreground">
                      {hours.open || "08:00"} – {hours.close || "19:00"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {Array.isArray(hours.days) ? hours.days.join(", ") : "Mon–Sat"}
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-0.5">
                    <span className="text-muted-foreground">Drop-Off Status</span>
                    <p className="font-semibold text-foreground">
                      {fac.drop_off_approved ? "Publicly Accessible" : "Private Operational Base"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {fac.drop_off_approved
                        ? "Coordinates visible for ticket drop-off"
                        : "Hidden from public discovery"}
                    </p>
                  </div>
                </div>

                {/* Operations Desk Action Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border/40">
                  <span className="text-xs text-muted-foreground">
                    {fac.drop_off_approved
                      ? "Public drop-off routing active for this workshop."
                      : "Private operational base only."}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => setSelectedDeskFacility(fac)}
                  >
                    <Wrench className="h-3.5 w-3.5 text-primary" />
                    Workshop Operations Desk
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedDeskFacility && (
        <WorkshopOperationsDesk
          open={Boolean(selectedDeskFacility)}
          onOpenChange={(next) => {
            if (!next) setSelectedDeskFacility(null);
          }}
          facility={{
            id: selectedDeskFacility.id,
            name: selectedDeskFacility.name,
            village: selectedDeskFacility.village,
            tahsil: selectedDeskFacility.tahsil,
            owner_name: selectedDeskFacility.owner_name,
            owner_phone: selectedDeskFacility.owner_phone,
            max_equipment_capacity: selectedDeskFacility.max_equipment_capacity,
            drop_off_approved: selectedDeskFacility.drop_off_approved,
          }}
          onFacilityUpdated={() => void loadFacilities()}
        />
      )}
    </div>
  );
}
