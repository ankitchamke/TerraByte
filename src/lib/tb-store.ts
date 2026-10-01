import { useSyncExternalStore } from "react";
import { assess, type Assessment } from "./assessment";

export type Role = "farmer" | "technician" | "admin";
export type EquipmentType = "Tractor" | "Harvester" | "Power Tiller" | "Pump" | "Sprayer";
export type EquipStatus = "Operational" | "In Repair" | "Needs Attention";
export type RepairStatus =
  | "REQUESTED"
  | "ACCEPTED"
  | "QUOTE_PENDING"
  | "QUOTE_REVISED"
  | "IN_PROGRESS"
  | "WAITING_FOR_PARTS"
  | "COMPLETED"
  | "CANCELLED";

export interface Farmer { id: string; name: string; village: string; phone: string }
export interface Equipment {
  id: string; farmerId: string; type: EquipmentType; make: string; model: string;
  year: number; serial: string; hours: number; photo?: string | undefined; status: EquipStatus;
}
export interface Technician {
  id: string; name: string; workshop: string; brands: string[]; skills: string[];
  verified: boolean; distanceKm: number; etaMin: number; available: boolean;
  rating: number; jobsDone: number; phone: string;
}
export interface QuotePart { name: string; spec: string; qty: number; price: number; source: string }
export interface Quote {
  parts: QuotePart[]; labourDesc: string; labour: number; taxPct: number;
  eta: string; warranty: string; version: number; sentAt: number;
}
export interface PartsHold { part: string; reason: string; eta: string; note: string; revisedCompletion: string; since: number }
export interface TimelineEntry { status: RepairStatus | "TESTING" | "NOTE" | "REASSIGNED" | "VERIFIED"; at: number; note?: string; by: Role | "system" }
export interface Repair {
  id: string; equipmentId: string; farmerId: string; technicianId: string | null;
  status: RepairStatus; testing: boolean; symptoms: string[]; description: string;
  photos: string[]; assessment: Assessment; createdAt: number; statusSince: number;
  declinedBy: string[]; quote?: Quote; clarification?: string | undefined; parts?: PartsHold | undefined;
  notes: { at: number; text: string }[]; timeline: TimelineEntry[];
  completion?: { notes: string; photo?: string | undefined; at: number }; verifiedAt?: number;
  location: string;
}
export interface ServiceRecord {
  id: string; equipmentId: string; repairId?: string; date: number; hours: number;
  type: string; issue: string; parts: string[]; labour: number; total: number;
  technician: string; workshop: string; notes: string; advice: string; downtimeH: number; invoice: string;
}
export interface Notification { id: string; role: Role; userId?: string; text: string; at: number; read: boolean; link?: string }

export interface TBState {
  session: { role: Role; userId: string } | null;
  farmers: Farmer[]; equipment: Equipment[]; technicians: Technician[];
  repairs: Repair[]; service: ServiceRecord[]; notifications: Notification[];
}

const KEY = "terrabyte-demo-v1";
const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;

export const quoteTotals = (q: Quote) => {
  const parts = q.parts.reduce((s, p) => s + p.qty * p.price, 0);
  const sub = parts + q.labour;
  const tax = Math.round((sub * q.taxPct) / 100);
  return { parts, labour: q.labour, tax, total: sub + tax };
};

function seed(): TBState {
  const now = Date.now();
  const farmers: Farmer[] = [
    { id: "f1", name: "Balasaheb Patil", village: "Pimpalgaon, Nashik", phone: "+91 98220 11111" },
    { id: "f2", name: "Suresh Jadhav", village: "Sinnar, Nashik", phone: "+91 98220 22222" },
    { id: "f3", name: "Anil Pawar", village: "Niphad, Nashik", phone: "+91 98220 33333" },
  ];
  const equipment: Equipment[] = [
    { id: "e1", farmerId: "f1", type: "Tractor", make: "Mahindra", model: "575 DI", year: 2021, serial: "MH575-21-0048821", hours: 1420, status: "In Repair" },
    { id: "e2", farmerId: "f1", type: "Harvester", make: "Kubota", model: "DC-68G", year: 2023, serial: "KBDC68-23-7710", hours: 680, status: "Operational" },
    { id: "e3", farmerId: "f1", type: "Pump", make: "Kirloskar", model: "KDS 5HP", year: 2019, serial: "KIR-5HP-19-3321", hours: 2210, status: "Operational" },
    { id: "e4", farmerId: "f2", type: "Tractor", make: "John Deere", model: "5050D", year: 2020, serial: "JD5050D-20-11902", hours: 2380, status: "In Repair" },
    { id: "e5", farmerId: "f3", type: "Tractor", make: "Swaraj", model: "744 FE", year: 2018, serial: "SW744-18-55120", hours: 3105, status: "In Repair" },
  ];
  const technicians: Technician[] = [
    { id: "t1", name: "Ramesh Kumar", workshop: "Green Earth Mobile Repairs", brands: ["Mahindra", "Swaraj"], skills: ["Fuel system", "Engine", "Cooling system"], verified: true, distanceKm: 7, etaMin: 45, available: false, rating: 4.8, jobsDone: 312, phone: "+91 90110 00001" },
    { id: "t2", name: "Vikas Shinde", workshop: "Shinde Agro Works", brands: ["John Deere", "New Holland", "Mahindra"], skills: ["Hydraulics", "Transmission", "Steering & brakes"], verified: true, distanceKm: 11, etaMin: 60, available: true, rating: 4.7, jobsDone: 244, phone: "+91 90110 00002" },
    { id: "t3", name: "Imran Shaikh", workshop: "Deccan Tractor Clinic", brands: ["Swaraj", "Sonalika", "Massey Ferguson"], skills: ["Engine", "Electrical", "Fuel system"], verified: true, distanceKm: 4, etaMin: 30, available: true, rating: 4.6, jobsDone: 189, phone: "+91 90110 00003" },
    { id: "t4", name: "Prakash More", workshop: "More Harvester Service", brands: ["Kubota", "Class", "John Deere"], skills: ["Harvester systems", "Hydraulics", "Transmission"], verified: true, distanceKm: 18, etaMin: 80, available: true, rating: 4.9, jobsDone: 401, phone: "+91 90110 00004" },
    { id: "t5", name: "Sachin Gaikwad", workshop: "Gaikwad Pump & Motor", brands: ["Kirloskar", "Crompton", "Mahindra"], skills: ["Electrical", "Pump & motor", "Engine"], verified: false, distanceKm: 9, etaMin: 50, available: true, rating: 4.3, jobsDone: 76, phone: "+91 90110 00005" },
  ];
  const r1Created = now - 26 * HR;
  const repairs: Repair[] = [
    {
      id: "TB-8841", equipmentId: "e1", farmerId: "f1", technicianId: "t1", status: "WAITING_FOR_PARTS", testing: false,
      symptoms: ["Loss of power", "Black smoke"], location: "Pimpalgaon, Nashik",
      description: "Tractor lost pulling power in field, heavy black smoke coming from exhaust and engine is sputtering under load.",
      photos: [], assessment: assess(["Loss of power", "Black smoke"], ""), createdAt: r1Created, statusSince: now - 3 * HR,
      declinedBy: [],
      quote: { parts: [
        { name: "Fuel Injector Nozzle Set", spec: "Bosch 0433171 (x4)", qty: 1, price: 2200, source: "Taluka distributor" },
        { name: "Inline Fuel Filter", spec: "Mahindra 005556958R1", qty: 1, price: 350, source: "In van stock" },
      ], labourDesc: "Injector removal, nozzle replacement, fuel line bleed & load test", labour: 900, taxPct: 0, eta: "Tomorrow, 1:00 PM", warranty: "90 days on parts & labour", version: 1, sentAt: r1Created + 3 * HR },
      parts: { part: "OEM Bosch Fuel Injector Nozzle", reason: "Nozzle set not in van stock; OEM required for 575 DI", eta: "Tomorrow 9:30 AM", note: "Part is being picked up from Taluka distributor.", revisedCompletion: "Tomorrow, 1:00 PM", since: now - 3 * HR },
      notes: [{ at: now - 5 * HR, text: "Inline filter replaced. Injector 3 spray pattern poor – confirms nozzle wear." }],
      timeline: [
        { status: "REQUESTED", at: r1Created, by: "farmer" },
        { status: "ACCEPTED", at: r1Created + 20 * MIN, by: "technician" },
        { status: "QUOTE_PENDING", at: r1Created + 3 * HR, by: "technician" },
        { status: "IN_PROGRESS", at: r1Created + 3.5 * HR, by: "farmer", note: "Quote approved" },
        { status: "NOTE", at: now - 5 * HR, by: "technician", note: "Inline filter replaced. Injector 3 spray pattern poor." },
        { status: "WAITING_FOR_PARTS", at: now - 3 * HR, by: "technician", note: "OEM Bosch Fuel Injector Nozzle" },
      ],
    },
    {
      id: "TB-8902", equipmentId: "e4", farmerId: "f2", technicianId: "t2", status: "QUOTE_PENDING", testing: false,
      symptoms: ["Hydraulic lift failure"], location: "Sinnar, Nashik",
      description: "Hydraulic arms dropping under load. Plough won't stay raised.",
      photos: [], assessment: assess(["Hydraulic lift failure"], "hydraulic arms dropping"), createdAt: now - 4 * HR, statusSince: now - 70 * MIN,
      declinedBy: [],
      quote: { parts: [
        { name: "Lift Cylinder Seal Kit", spec: "JD AL120788", qty: 1, price: 1650, source: "Shinde Agro stock" },
        { name: "Hydraulic Oil 15W-30", spec: "JD Hy-Gard, litres", qty: 8, price: 320, source: "In van stock" },
      ], labourDesc: "Lift cylinder reseal, oil flush and pressure test", labour: 1400, taxPct: 18, eta: "Today, 6:30 PM", warranty: "60 days on seals", version: 1, sentAt: now - 70 * MIN },
      notes: [], timeline: [
        { status: "REQUESTED", at: now - 4 * HR, by: "farmer" },
        { status: "ACCEPTED", at: now - 3.6 * HR, by: "technician" },
        { status: "QUOTE_PENDING", at: now - 70 * MIN, by: "technician" },
      ],
    },
    {
      id: "TB-8898", equipmentId: "e5", farmerId: "f3", technicianId: null, status: "REQUESTED", testing: false,
      symptoms: ["Engine won't start", "Electrical/battery issue"], location: "Niphad, Nashik",
      description: "Starter clicks but engine doesn't crank. Battery was fine yesterday.",
      photos: [], assessment: assess(["Engine won't start", "Electrical/battery issue"], ""), createdAt: now - 28 * MIN, statusSince: now - 28 * MIN,
      declinedBy: [], notes: [], timeline: [{ status: "REQUESTED", at: now - 28 * MIN, by: "farmer" }],
    },
  ];
  const service: ServiceRecord[] = [
    { id: "S-1", equipmentId: "e1", date: now - 45 * DAY, hours: 1310, type: "Fuel System Overhaul", issue: "Hard starting, rough idle", parts: ["Fuel Injector Nozzle Set", "Inline Filter"], labour: 900, total: 3450, technician: "Ramesh Kumar", workshop: "Green Earth Mobile Repairs", notes: "Water contamination found in fuel tank. Drained and flushed.", advice: "Replace fuel filter every 250 hrs. Use filtered diesel.", downtimeH: 4.5, invoice: "INV-GE-2291" },
    { id: "S-2", equipmentId: "e1", date: now - 160 * DAY, hours: 1020, type: "Scheduled Service", issue: "1000-hour service", parts: ["Engine Oil 15W-40 (7L)", "Oil Filter", "Air Filter Element"], labour: 600, total: 4150, technician: "Ramesh Kumar", workshop: "Green Earth Mobile Repairs", notes: "Clutch free play adjusted.", advice: "Next service at 1250 hrs.", downtimeH: 2, invoice: "INV-GE-1874" },
    { id: "S-3", equipmentId: "e2", date: now - 70 * DAY, hours: 540, type: "Header Belt Replacement", issue: "Header drive belt slipping", parts: ["Header Drive Belt"], labour: 800, total: 2600, technician: "Prakash More", workshop: "More Harvester Service", notes: "Tensioner pulley bearing checked OK.", advice: "Inspect belts before each season.", downtimeH: 3, invoice: "INV-MH-0442" },
  ];
  return {
    session: null, farmers, equipment, technicians, repairs, service,
    notifications: [
      { id: "n1", role: "farmer", userId: "f1", text: "Repair TB-8841 paused: waiting for Bosch injector nozzle (ETA tomorrow 9:30 AM)", at: now - 3 * HR, read: false, link: "/farmer/repair/TB-8841" },
      { id: "n2", role: "technician", userId: "t2", text: "Quote for TB-8902 sent to Suresh Jadhav", at: now - 70 * MIN, read: true },
      { id: "n3", role: "admin", text: "TB-8898 unassigned for 28 min — exception", at: now - 5 * MIN, read: false, link: "/admin/repair/TB-8898" },
    ],
  };
}

export const demoTechnicians = () => seed().technicians;

let state: TBState = seed();
let hydrated = false;
const listeners = new Set<() => void>();

function load() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw);
  } catch { /* ignore */ }
}
function set(fn: (s: TBState) => TBState) {
  load();
  state = fn(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
  listeners.forEach((l) => l());
}
const serverSnap = state;
export function useTB(): TBState {
  load();
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
    () => serverSnap,
  );
}
export const getTB = () => { load(); return state; };
export function resetDemo() { set(() => ({ ...seed(), session: state.session })); }

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 9);
function notify(s: TBState, n: Omit<Notification, "id" | "at" | "read">): Notification[] {
  return [{ ...n, id: uid(), at: Date.now(), read: false }, ...s.notifications].slice(0, 60);
}
function patchRepair(id: string, fn: (r: Repair, s: TBState) => Partial<Repair>, extra?: (s: TBState, r: Repair) => Partial<TBState>) {
  set((s) => {
    const r = s.repairs.find((x) => x.id === id);
    if (!r) return s;
    const nr = { ...r, ...fn(r, s) };
    if (nr.status !== r.status) nr.statusSince = Date.now();
    const base = { ...s, repairs: s.repairs.map((x) => (x.id === id ? nr : x)) };
    return { ...base, ...(extra ? extra(base, nr) : {}) };
  });
}
const tl = (r: Repair, e: Omit<TimelineEntry, "at">) => [...r.timeline, { ...e, at: Date.now() }];
const eqName = (s: TBState, r: Repair) => { const e = s.equipment.find((x) => x.id === r.equipmentId); return e ? `${e.make} ${e.model}` : "machine"; };

// ---------- actions ----------
export const actions = {
  login(role: Role, userId: string) { set((s) => ({ ...s, session: { role, userId } })); },
  logout() { set((s) => ({ ...s, session: null })); },
  markRead(role: Role, userId?: string) {
    set((s) => ({ ...s, notifications: s.notifications.map((n) => n.role === role && (!n.userId || n.userId === userId) ? { ...n, read: true } : n) }));
  },
  addEquipment(e: Omit<Equipment, "id" | "status">) {
    const id = "e" + uid();
    set((s) => ({ ...s, equipment: [...s.equipment, { ...e, id, status: "Operational" }] }));
    return id;
  },
  createRepair(p: { equipmentId: string; farmerId: string; symptoms: string[]; description: string; photos: string[]; location: string }) {
    const id = "TB-" + (9000 + Math.floor(Math.random() * 900));
    const now = Date.now();
    const r: Repair = {
      id, ...p, technicianId: null, status: "REQUESTED", testing: false,
      assessment: assess(p.symptoms, p.description), createdAt: now, statusSince: now,
      declinedBy: [], notes: [], timeline: [{ status: "REQUESTED", at: now, by: "farmer", note: "Breakdown reported" }],
    };
    set((s) => ({
      ...s, repairs: [r, ...s.repairs],
      equipment: s.equipment.map((e) => (e.id === p.equipmentId ? { ...e, status: "In Repair" } : e)),
    }));
    return id;
  },
  requestTechnician(id: string, techId: string) {
    patchRepair(id, () => ({ technicianId: techId }), (s, r) => ({
      notifications: notify(s, { role: "technician", userId: techId, text: `New repair request ${id}: ${eqName(s, r)}`, link: `/technician/job/${id}` }),
    }));
  },
  accept(id: string) {
    patchRepair(id, (r) => ({ status: "ACCEPTED", timeline: tl(r, { status: "ACCEPTED", by: "technician" }) }), (s, r) => ({
      notifications: notify(s, { role: "farmer", userId: r.farmerId, text: `Technician assigned to ${id}. Inspection on the way.`, link: `/farmer/repair/${id}` }),
    }));
  },
  decline(id: string, reason: string) {
    patchRepair(id, (r) => ({
      declinedBy: r.technicianId ? [...r.declinedBy, r.technicianId] : r.declinedBy, technicianId: null, status: "REQUESTED",
      timeline: tl(r, { status: "REQUESTED", by: "technician", note: `Declined: ${reason}. Returned to dispatch.` }),
    }), (s, r) => ({
      notifications: notify(
        { ...s, notifications: notify(s, { role: "admin", text: `${id} declined (${reason}) — needs reassignment`, link: `/admin/repair/${id}` }) },
        { role: "farmer", userId: r.farmerId, text: `Technician couldn't take ${id}. Please pick another technician.`, link: `/farmer/repair/${id}` }),
    }));
  },
  sendQuote(id: string, q: Omit<Quote, "version" | "sentAt">) {
    patchRepair(id, (r) => ({
      quote: { ...q, version: (r.quote?.version ?? 0) + 1, sentAt: Date.now() }, status: "QUOTE_PENDING", clarification: undefined,
      timeline: tl(r, { status: "QUOTE_PENDING", by: "technician", note: r.quote ? "Revised quote sent" : "Quote sent" }),
    }), (s, r) => ({
      notifications: notify(s, { role: "farmer", userId: r.farmerId, text: `Quote ready for ${id}: ₹${quoteTotals(r.quote!).total.toLocaleString("en-IN")}`, link: `/farmer/repair/${id}` }),
    }));
  },
  approveQuote(id: string) {
    patchRepair(id, (r) => ({ status: "IN_PROGRESS", timeline: tl(r, { status: "IN_PROGRESS", by: "farmer", note: "Quote approved & repair authorized" }) }), (s, r) => ({
      notifications: notify(s, { role: "technician", userId: r.technicianId!, text: `${id} quote approved — you may start work`, link: `/technician/job/${id}` }),
    }));
  },
  declineQuote(id: string, reason: string) {
    patchRepair(id, (r) => ({ status: "QUOTE_REVISED", clarification: reason, timeline: tl(r, { status: "QUOTE_REVISED", by: "farmer", note: reason }) }), (s, r) => ({
      notifications: notify(s, { role: "technician", userId: r.technicianId!, text: `${id}: farmer asked for quote revision — "${reason}"`, link: `/technician/job/${id}` }),
    }));
  },
  waitForParts(id: string, p: Omit<PartsHold, "since">) {
    patchRepair(id, (r) => ({ status: "WAITING_FOR_PARTS", testing: false, parts: { ...p, since: Date.now() }, timeline: tl(r, { status: "WAITING_FOR_PARTS", by: "technician", note: `${p.part} — ETA ${p.eta}` }) }), (s, r) => ({
      notifications: notify(s, { role: "farmer", userId: r.farmerId, text: `Repair ${id} paused: waiting for ${p.part} (ETA ${p.eta})`, link: `/farmer/repair/${id}` }),
    }));
  },
  updatePartsEta(id: string, eta: string, by: Role) {
    patchRepair(id, (r) => ({ parts: r.parts ? { ...r.parts, eta } : r.parts, timeline: tl(r, { status: "NOTE", by, note: `Parts ETA updated: ${eta}` }) }), (s, r) => ({
      notifications: notify(s, { role: "farmer", userId: r.farmerId, text: `${id}: spare part ETA updated to ${eta}`, link: `/farmer/repair/${id}` }),
    }));
  },
  resume(id: string) {
    patchRepair(id, (r) => ({ status: "IN_PROGRESS", timeline: tl(r, { status: "IN_PROGRESS", by: "technician", note: `Part arrived (${r.parts?.part ?? "part"}). Work resumed.` }) }), (s, r) => ({
      notifications: notify(s, { role: "farmer", userId: r.farmerId, text: `Part arrived — repair ${id} resumed`, link: `/farmer/repair/${id}` }),
    }));
  },
  startTesting(id: string) {
    patchRepair(id, (r) => ({ testing: true, timeline: tl(r, { status: "TESTING", by: "technician", note: "Repair done, testing under load" }) }));
  },
  addNote(id: string, text: string) {
    patchRepair(id, (r) => ({ notes: [...r.notes, { at: Date.now(), text }], timeline: tl(r, { status: "NOTE", by: "technician", note: text }) }));
  },
  complete(id: string, notes: string, photo?: string) {
    set((s) => {
      const r = s.repairs.find((x) => x.id === id);
      if (!r || !r.quote) return s;
      const now = Date.now();
      const t = s.technicians.find((x) => x.id === r.technicianId);
      const e = s.equipment.find((x) => x.id === r.equipmentId)!;
      const tot = quoteTotals(r.quote);
      const rec: ServiceRecord = {
        id: "S-" + uid(), equipmentId: r.equipmentId, repairId: r.id, date: now, hours: e.hours,
        type: r.assessment.system + " Repair", issue: r.assessment.possibleIssue,
        parts: r.quote.parts.map((p) => `${p.name}${p.qty > 1 ? ` ×${p.qty}` : ""}`), labour: tot.labour, total: tot.total,
        technician: t?.name ?? "—", workshop: t?.workshop ?? "—", notes, advice: r.assessment.maintenanceAdvice,
        downtimeH: Math.round(((now - r.createdAt) / HR) * 10) / 10, invoice: `INV-${r.id}`,
      };
      const nr: Repair = { ...r, status: "COMPLETED", testing: false, statusSince: now, completion: { notes, photo, at: now }, timeline: [...r.timeline, { status: "COMPLETED", at: now, by: "technician", note: "Repair completed & tested" }] };
      const ns = { ...s, repairs: s.repairs.map((x) => (x.id === id ? nr : x)), service: [rec, ...s.service], equipment: s.equipment.map((x) => (x.id === e.id ? { ...x, status: "Operational" as const } : x)) };
      return { ...ns, notifications: notify(ns, { role: "farmer", userId: r.farmerId, text: `${e.make} ${e.model} is repaired! Please confirm handover.`, link: `/farmer/repair/${id}` }) };
    });
  },
  verify(id: string) {
    patchRepair(id, (r) => ({ verifiedAt: Date.now(), timeline: tl(r, { status: "VERIFIED", by: "farmer", note: "Farmer confirmed handover" }) }), (s, r) => ({
      notifications: notify(s, { role: "technician", userId: r.technicianId!, text: `${id} handover confirmed by farmer`, link: `/technician/job/${id}` }),
    }));
  },
  cancel(id: string) {
    set((s) => {
      const r = s.repairs.find((x) => x.id === id);
      if (!r) return s;
      return {
        ...s,
        repairs: s.repairs.map((x) => (x.id === id ? { ...x, status: "CANCELLED" as const, statusSince: Date.now(), timeline: tl(x, { status: "CANCELLED", by: "farmer" }) } : x)),
        equipment: s.equipment.map((e) => (e.id === r.equipmentId ? { ...e, status: "Operational" as const } : e)),
      };
    });
  },
  reassign(id: string, techId: string) {
    patchRepair(id, (r, s) => ({
      technicianId: techId, status: r.status === "REQUESTED" ? "REQUESTED" : r.status,
      timeline: tl(r, { status: "REASSIGNED", by: "admin", note: `Assigned to ${s.technicians.find((t) => t.id === techId)?.name}` }),
    }), (s, r) => ({
      notifications: notify(s, { role: "technician", userId: techId, text: `Service centre assigned you ${id}: ${eqName(s, r)}`, link: `/technician/job/${id}` }),
    }));
  },
  setAvailability(techId: string, available: boolean) {
    set((s) => ({ ...s, technicians: s.technicians.map((t) => (t.id === techId ? { ...t, available } : t)) }));
  },
};

// ---------- labels ----------
export const FARMER_LABEL: Record<RepairStatus, string> = {
  REQUESTED: "Finding Your Technician",
  ACCEPTED: "Technician Assigned",
  QUOTE_PENDING: "Quote Ready for Your Review",
  QUOTE_REVISED: "Quote Being Revised",
  IN_PROGRESS: "Repair in Progress",
  WAITING_FOR_PARTS: "Paused: Waiting for Spare Parts",
  COMPLETED: "Repair Complete & Verified",
  CANCELLED: "Cancelled",
};
export const STAFF_LABEL: Record<RepairStatus, string> = {
  REQUESTED: "Requested", ACCEPTED: "Accepted", QUOTE_PENDING: "Quote pending", QUOTE_REVISED: "Quote revision",
  IN_PROGRESS: "In progress", WAITING_FOR_PARTS: "Waiting for parts", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
export const isActive = (r: Repair) => r.status !== "CANCELLED" && !(r.status === "COMPLETED" && r.verifiedAt);
export const OVERDUE_MIN: Partial<Record<RepairStatus, number>> = { REQUESTED: 20, ACCEPTED: 180, QUOTE_PENDING: 240, QUOTE_REVISED: 120, WAITING_FOR_PARTS: 24 * 60 };
export const isOverdue = (r: Repair) => {
  const lim = OVERDUE_MIN[r.status];
  return lim !== undefined && Date.now() - r.statusSince > lim * MIN;
};
export const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)} days`;
};
export const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
export const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
export const fmtTime = (t: number) => new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
