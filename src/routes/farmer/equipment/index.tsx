import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, Plus, Tractor, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { btn, Card, input, Label } from "@/components/tb";
import { actions, useTB, type EquipmentType } from "@/lib/tb-store";
import { fileToSmallDataUrl } from "@/lib/image";
import { meta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/farmer/equipment/")({
  head: () => meta("My equipment", "Register and manage your agricultural machines."),
  component: EquipmentList,
});

const TYPES: EquipmentType[] = ["Tractor", "Harvester", "Power Tiller", "Pump", "Sprayer"];
const schema = z.object({
  make: z.string().trim().min(2, "Enter manufacturer").max(40),
  model: z.string().trim().min(1, "Enter model").max(40),
  year: z.number().int().min(1980).max(2026),
  serial: z.string().trim().min(3, "Enter serial / chassis no.").max(40),
  hours: z.number().int().min(0).max(100000),
});

function EquipmentList() {
  const s = useTB();
  const fid = s.session!.userId;
  const eq = s.equipment.filter((e) => e.farmerId === fid);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    type: "Tractor" as EquipmentType,
    make: "",
    model: "",
    year: "2022",
    serial: "",
    hours: "0",
    photo: "",
  });

  const save = () => {
    const p = schema.safeParse({ ...f, year: Number(f.year), hours: Number(f.hours) });
    if (!p.success) {
      toast.error(p.error.issues[0]?.message ?? "Check the form");
      return;
    }
    actions.addEquipment({ farmerId: fid, type: f.type, photo: f.photo || undefined, ...p.data });
    toast.success(`${p.data.make} ${p.data.model} registered`);
    setOpen(false);
    setF({ type: "Tractor", make: "", model: "", year: "2022", serial: "", hours: "0", photo: "" });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">My equipment</h1>
        <button onClick={() => setOpen(!open)} className={btn.primary}>
          {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {open ? "Close" : "Add"}
        </button>
      </div>
      {open && (
        <Card className="space-y-4">
          <div>
            <Label>Type</Label>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setF({ ...f, type: t })}
                  className={cn(
                    "h-11 rounded-xl border-2 px-4 text-sm font-semibold",
                    f.type === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Manufacturer</Label>
              <input
                className={input}
                placeholder="Mahindra"
                value={f.make}
                onChange={(e) => setF({ ...f, make: e.target.value })}
              />
            </div>
            <div>
              <Label>Model</Label>
              <input
                className={input}
                placeholder="575 DI"
                value={f.model}
                onChange={(e) => setF({ ...f, model: e.target.value })}
              />
            </div>
            <div>
              <Label>Year of purchase</Label>
              <input
                className={input}
                inputMode="numeric"
                value={f.year}
                onChange={(e) => setF({ ...f, year: e.target.value })}
              />
            </div>
            <div>
              <Label>Operating hours</Label>
              <input
                className={input}
                inputMode="numeric"
                value={f.hours}
                onChange={(e) => setF({ ...f, hours: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Registration / serial / chassis no.</Label>
              <input
                className={input}
                value={f.serial}
                onChange={(e) => setF({ ...f, serial: e.target.value })}
              />
            </div>
          </div>
          <label className={cn(btn.ghost, "w-full cursor-pointer")}>
            <Camera className="h-4 w-4" />{" "}
            {f.photo ? "Photo added ✓" : "Add machine photo (optional)"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setF({ ...f, photo: await fileToSmallDataUrl(file) });
              }}
            />
          </label>
          <button onClick={save} className={cn(btn.primary, "w-full")}>
            Register machine
          </button>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {eq.map((e) => {
          const recs = s.service.filter((x) => x.equipmentId === e.id).length;
          return (
            <Link
              key={e.id}
              to="/farmer/equipment/$id"
              params={{ id: e.id }}
              className="rounded-2xl border border-border bg-card p-5 hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-2">
                {e.photo ? (
                  <img src={e.photo} alt="" className="h-16 w-16 rounded-xl object-cover" />
                ) : (
                  <span className="grid h-16 w-16 place-items-center rounded-xl bg-muted">
                    <Tractor className="h-8 w-8 text-muted-foreground" />
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold",
                    e.status === "Operational"
                      ? "bg-success/15 text-success"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  {e.status}
                </span>
              </div>
              <h2 className="mt-3 text-xl font-bold">
                {e.make} {e.model}
              </h2>
              <p className="text-sm text-muted-foreground">
                {e.type} · {e.year} · {e.hours.toLocaleString("en-IN")} hrs
              </p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {recs} service record{recs === 1 ? "" : "s"}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
