import { useSyncExternalStore } from "react";
import { assess, type Assessment } from "./assessment.ts";

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
  | "CANCELLATION_REQUESTED"
  | "CANCELLED";

export interface Farmer {
  id: string;
  name: string;
  village: string;
  phone: string;
}
export interface Equipment {
  id: string;
  farmerId: string;
  type: EquipmentType;
  make: string;
  model: string;
  year: number;
  serial: string;
  hours: number;
  photo?: string | undefined;
  status: EquipStatus;
}
export interface Technician {
  id: string;
  name: string;
  workshop: string;
  brands: string[];
  skills: string[];
  verified: boolean;
  distanceKm: number;
  etaMin: number;
  available: boolean;
  rating: number;
  jobsDone: number;
  phone: string;
}
export interface QuotePart {
  name: string;
  spec: string;
  qty: number;
  price: number;
  source: string;
  catalogPartId?: string | null;
}

export function syncPartRequestToQuoteLines(
  existingParts: QuotePart[],
  requestedPart: {
    id: string;
    name: string;
    part_number?: string | null;
    spec?: string | null;
    unit_price: number | string;
  },
  quantity: number,
): QuotePart[] {
  const parts = [...existingParts];
  const targetId = requestedPart.id;
  const targetName = requestedPart.name.trim().toLowerCase();
  const targetNum = (requestedPart.part_number || "").trim().toLowerCase();

  const matchIdx = parts.findIndex(
    (p) =>
      (p.catalogPartId && p.catalogPartId === targetId) ||
      p.name.trim().toLowerCase() === targetName ||
      (targetNum && (p.spec || "").trim().toLowerCase() === targetNum),
  );

  const price = Number(requestedPart.unit_price) || 0;
  const spec = requestedPart.spec || requestedPart.part_number || "";

  if (matchIdx >= 0 && parts[matchIdx]) {
    const prev = parts[matchIdx]!;
    parts[matchIdx] = {
      ...prev,
      name: prev.name,
      qty: quantity,
      price: price,
      spec: spec,
      catalogPartId: targetId,
      source: "Nagpur Service Centre Depot",
    };
  } else {
    const newLine: QuotePart = {
      name: requestedPart.name,
      spec: spec,
      qty: quantity,
      price: price,
      source: "Nagpur Service Centre Depot",
      catalogPartId: targetId,
    };

    if (parts.length === 1 && parts[0] && !parts[0].name.trim() && parts[0].qty === 1) {
      parts[0] = newLine;
    } else {
      parts.push(newLine);
    }
  }

  return parts;
}
export interface Quote {
  parts: QuotePart[];
  labourDesc: string;
  labour: number;
  taxPct: number;
  eta: string;
  warranty: string;
  version: number;
  sentAt: number;
}
export interface BlockerPartItem {
  id?: string | undefined;
  part: string;
  partId?: string | null | undefined;
  quantity?: number | undefined;
  reason: string;
  eta: string;
  revisedCompletion?: string | null | undefined;
  status: "PENDING" | "HANDED_OFF" | "RESOLVED";
  since: number | string;
  eta_updated_by?: string | null | undefined;
  eta_updated_at?: string | null | undefined;
}
export interface PartsHold {
  part: string;
  reason: string;
  eta: string;
  note: string;
  revisedCompletion: string;
  since: number;
  items?: BlockerPartItem[] | undefined;
  allPartsArrived?: boolean | undefined;
}
export interface TimelineEntry {
  status: RepairStatus | "TESTING" | "TESTING_FAILED" | "NOTE" | "REASSIGNED" | "VERIFIED";
  at: number;
  note?: string;
  by: Role | "system";
}
export interface Repair {
  id: string;
  equipmentId: string;
  farmerId: string;
  technicianId: string | null;
  status: RepairStatus;
  testing: boolean;
  symptoms: string[];
  description: string;
  photos: string[];
  assessment: Assessment;
  createdAt: number;
  statusSince: number;
  declinedBy: string[];
  quote?: Quote;
  clarification?: string | undefined;
  parts?: PartsHold | undefined;
  notes: { at: number; text: string }[];
  timeline: TimelineEntry[];
  completion?: { notes: string; photo?: string | undefined; at: number };
  verifiedAt?: number;
  location: string;
  cancellation_previous_status?: RepairStatus;
  cancellationPreviousStatus?: RepairStatus;
  cancellation_reason?: string;
  cancellationReason?: string;
  cancellation_note?: string;
  cancellation_requested_at?: string | number;
  cancellation_admin_response?: string;
  service_type?: "DOORSTEP" | "WORKSHOP";
  serviceType?: "DOORSTEP" | "WORKSHOP";
  urgency_level?: "CRITICAL" | "HIGH" | "STANDARD" | "FLEXIBLE";
  urgencyLevel?: "CRITICAL" | "HIGH" | "STANDARD" | "FLEXIBLE";
  is_machine_stopped?: boolean;
  isMachineStopped?: boolean;
  preferred_time_slot?: string | null;
  preferredTimeSlot?: string | null;
  field_landmark?: string | null;
  fieldLandmark?: string | null;
}
export interface ServiceRecord {
  id: string;
  equipmentId: string;
  repairId?: string;
  date: number;
  hours: number;
  type: string;
  issue: string;
  parts: string[];
  labour: number;
  total: number;
  technician: string;
  workshop: string;
  notes: string;
  advice: string;
  downtimeH: number;
  invoice: string;
}
export interface Notification {
  id: string;
  role: Role;
  userId?: string;
  text: string;
  at: number;
  read: boolean;
  link?: string;
}
export interface DemoPart {
  id: string;
  service_centre_id?: string;
  part_number: string;
  name: string;
  spec: string | null;
  category: string;
  compatible_models: string[];
  stock_quantity: number;
  unit_price: number;
  location: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoPartRequest {
  id: string;
  repair_request_id: string;
  part_id: string;
  quantity: number;
  status: "PENDING" | "HANDED_OFF" | "CANCELLED";
  requested_by: string;
  handed_off_by?: string | null;
  handed_off_at?: string | null;
  notes?: string | null | undefined;
  estimated_arrival_at?: string | null;
  eta_updated_by?: string | null;
  eta_updated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoStockAudit {
  id: string;
  part_id: string;
  change_quantity: number;
  previous_stock: number;
  new_stock: number;
  movement_type: "RECEIVED" | "ISSUED_TO_REPAIR" | "RETURNED" | "ADJUSTMENT";
  reason: string;
  changed_by: string;
  repair_request_id?: string | null;
  part_request_id?: string | null;
  quote_id?: string | null;
  quote_item_id?: string | null;
  unit_price?: number | null;
  total_value?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface DemoPartSale {
  id: string;
  part_id: string;
  part_name: string;
  part_number: string;
  repair_request_id: string;
  quote_id: string;
  quote_item_id?: string | null;
  part_request_id?: string | null;
  movement_audit_id?: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  total_price?: number;
  sold_at: string;
  recorded_by: string;
  notes?: string | null;
  created_at: string;
}

export const INITIAL_DEMO_PARTS: DemoPart[] = [
  {
    id: "00000000-0000-0000-0040-000000000001",
    service_centre_id: "00000000-0000-0000-0003-000000000001",
    part_number: "0433171",
    name: "Fuel Injector Nozzle Set",
    spec: "Bosch 0433171 (x4)",
    category: "Fuel system",
    compatible_models: ["Mahindra 575 DI"],
    stock_quantity: 3,
    unit_price: 2200,
    location: "Depot Shelf A-02",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "00000000-0000-0000-0040-000000000002",
    service_centre_id: "00000000-0000-0000-0003-000000000001",
    part_number: "005556958R1",
    name: "Inline Fuel Filter",
    spec: "Mahindra 005556958R1",
    category: "Fuel system",
    compatible_models: ["Mahindra 575 DI"],
    stock_quantity: 8,
    unit_price: 350,
    location: "Depot Shelf A-03",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "00000000-0000-0000-0040-000000000003",
    service_centre_id: "00000000-0000-0000-0003-000000000001",
    part_number: "AL120788",
    name: "Lift Cylinder Seal Kit",
    spec: "JD AL120788",
    category: "Hydraulics",
    compatible_models: ["John Deere 5050D"],
    stock_quantity: 2,
    unit_price: 1650,
    location: "Depot Shelf B-01",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "00000000-0000-0000-0040-000000000004",
    service_centre_id: "00000000-0000-0000-0003-000000000001",
    part_number: "HY-GARD-15W30",
    name: "Hydraulic Oil 15W-30",
    spec: "JD Hy-Gard, litres",
    category: "Hydraulics",
    compatible_models: ["John Deere 5050D"],
    stock_quantity: 5,
    unit_price: 320,
    location: "Depot Drum Rack B-04",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "00000000-0000-0000-0040-000000000005",
    service_centre_id: "00000000-0000-0000-0003-000000000001",
    part_number: "26243171",
    name: "Starter Motor Assembly",
    spec: "Lucas-TVS 12V 2.2kW",
    category: "Electrical",
    compatible_models: ["Mahindra 575 DI", "Swaraj 744 FE"],
    stock_quantity: 1,
    unit_price: 5800,
    location: "Depot Shelf C-01",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
];

export interface TBState {
  session: { role: Role; userId: string } | null;
  farmers: Farmer[];
  equipment: Equipment[];
  technicians: Technician[];
  repairs: Repair[];
  service: ServiceRecord[];
  notifications: Notification[];
  serviceCentreParts: DemoPart[];
  serviceCentrePartRequests: DemoPartRequest[];
  serviceCentreStockAudit: DemoStockAudit[];
  serviceCentrePartSales?: DemoPartSale[];
}

const KEY = "terrabyte-demo-v1";
const MIN = 60_000,
  HR = 60 * MIN,
  DAY = 24 * HR;

export const quoteTotals = (q: Quote) => {
  const parts = q.parts.reduce((s, p) => s + p.qty * p.price, 0);
  const sub = parts + q.labour;
  const tax = Math.round((sub * q.taxPct) / 100);
  return { parts, labour: q.labour, tax, total: sub + tax };
};

function seed(): TBState {
  const now = Date.now();
  const farmers: Farmer[] = [
    { id: "f1", name: "Balasaheb Patil", village: "Katol, Nagpur", phone: "+91 98220 11111" },
  ];
  const equipment: Equipment[] = [
    {
      id: "e1",
      farmerId: "f1",
      type: "Tractor",
      make: "Mahindra",
      model: "575 DI",
      year: 2021,
      serial: "MH575-21-0048821",
      hours: 1420,
      status: "Operational",
    },
    {
      id: "e2",
      farmerId: "f1",
      type: "Harvester",
      make: "Kubota",
      model: "DC-68G",
      year: 2023,
      serial: "KBDC68-23-7710",
      hours: 680,
      status: "Operational",
    },
    {
      id: "e3",
      farmerId: "f1",
      type: "Pump",
      make: "Kirloskar",
      model: "KDS 5HP",
      year: 2019,
      serial: "KIR-5HP-19-3321",
      hours: 2210,
      status: "Operational",
    },
  ];
  const technicians: Technician[] = [
    {
      id: "t1",
      name: "Ramesh Kumar",
      workshop: "Green Earth Mobile Repairs",
      brands: ["Mahindra", "Swaraj"],
      skills: ["Fuel system", "Engine", "Cooling system"],
      verified: true,
      distanceKm: 7,
      etaMin: 45,
      available: true,
      rating: 5.0,
      jobsDone: 0,
      phone: "+91 90110 00001",
    },
  ];
  const repairs: Repair[] = [];
  const service: ServiceRecord[] = [];
  return {
    session: null,
    farmers,
    equipment,
    technicians,
    repairs,
    service,
    notifications: [],
    serviceCentreParts: INITIAL_DEMO_PARTS.map((p) => ({ ...p })),
    serviceCentrePartRequests: [],
    serviceCentreStockAudit: [],
    serviceCentrePartSales: [],
  };
}

export const demoTechnicians = () => seed().technicians;

let state: TBState = seed();
let hydrated = false;
const listeners = new Set<() => void>();

const SYNC_CHANNEL = "terrabyte_demo_store_sync";
let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  try {
    broadcastChannel = new BroadcastChannel(SYNC_CHANNEL);
    broadcastChannel.onmessage = (event) => {
      if (event.data?.type === "STORE_UPDATED") {
        hydrated = false;
        load();
        listeners.forEach((l) => l());
      }
    };
  } catch {
    /* channel error */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) {
      hydrated = false;
      load();
      listeners.forEach((l) => l());
    }
  });
}

function load() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      state = JSON.parse(raw);
    }
  } catch {
    /* ignore */
  }

  // Ensure demo parts, requests, audit, and sales arrays are always hydrated cleanly
  if (!state.serviceCentreParts || state.serviceCentreParts.length === 0) {
    state.serviceCentreParts = INITIAL_DEMO_PARTS.map((p) => ({ ...p }));
  }
  if (!state.serviceCentrePartRequests) {
    state.serviceCentrePartRequests = [];
  }
  if (!state.serviceCentreStockAudit) {
    state.serviceCentreStockAudit = [];
  }
  if (!state.serviceCentrePartSales) {
    state.serviceCentrePartSales = [];
  }
}
function set(fn: (s: TBState) => TBState) {
  load();
  state = fn(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: "STORE_UPDATED", timestamp: Date.now() });
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}
const serverSnap = state;
export function useTB(): TBState {
  load();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => serverSnap,
  );
}
export const getTB = () => {
  load();
  return state;
};
export function resetDemo() {
  set((current) => {
    const s = seed();
    const demoFarmerIds = new Set(["f1", "00000000-0000-0000-0001-000000000001"]);
    const nagpurCentreId = "00000000-0000-0000-0003-000000000001";

    // 1. Non-demo repairs are repairs where farmerId is explicitly a non-demo user (neither f1 nor Balasaheb's UUID)
    const nonDemoRepairs = (current.repairs || []).filter(
      (r) => r.farmerId && !demoFarmerIds.has(r.farmerId)
    );
    const nonDemoRepairIds = new Set(nonDemoRepairs.map((r) => r.id));

    // 2. Retain non-demo equipment
    const preservedEquipment = (current.equipment || []).filter(
      (e) => e.farmerId && !demoFarmerIds.has(e.farmerId)
    );

    // 3. Retain non-demo service centre parts (other service centres or unscoped non-canonical parts)
    const canonicalPartNumbers = new Set(INITIAL_DEMO_PARTS.map((p) => p.part_number));
    const preservedOtherCentreParts = (current.serviceCentreParts || []).filter(
      (p) =>
        (p.service_centre_id && p.service_centre_id !== nagpurCentreId) ||
        (!p.service_centre_id && !canonicalPartNumbers.has(p.part_number))
    );

    // 4. Retain part requests on non-demo repairs
    const preservedPartRequests = (current.serviceCentrePartRequests || []).filter(
      (req) => nonDemoRepairIds.has(req.repair_request_id)
    );

    // 5. Retain sales on non-demo repairs
    const preservedPartSales = (current.serviceCentrePartSales || []).filter(
      (sale) => nonDemoRepairIds.has(sale.repair_request_id)
    );

    // 6. Retain stock audits ONLY if they are for a non-demo repair OR for other/unscoped parts
    const otherPartIds = new Set(preservedOtherCentreParts.map((p) => p.id));
    const preservedStockAudit = (current.serviceCentreStockAudit || []).filter((audit) => {
      if (audit.repair_request_id) {
        return nonDemoRepairIds.has(audit.repair_request_id);
      }
      return otherPartIds.has(audit.part_id);
    });

    // 7. Retain non-demo notifications
    const preservedNotifications = (current.notifications || []).filter(
      (n) => n.userId && !demoFarmerIds.has(n.userId)
    );

    return {
      ...s,
      session: current.session,
      equipment: [...s.equipment, ...preservedEquipment],
      repairs: nonDemoRepairs,
      serviceCentreParts: [
        ...INITIAL_DEMO_PARTS.map((p) => ({ ...p, service_centre_id: nagpurCentreId })),
        ...preservedOtherCentreParts,
      ],
      serviceCentrePartRequests: preservedPartRequests,
      serviceCentreStockAudit: preservedStockAudit,
      serviceCentrePartSales: preservedPartSales,
      notifications: preservedNotifications,
    };
  });
}

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 9);
function notify(s: TBState, n: Omit<Notification, "id" | "at" | "read">): Notification[] {
  return [{ ...n, id: uid(), at: Date.now(), read: false }, ...s.notifications].slice(0, 60);
}
function patchRepair(
  id: string,
  fn: (r: Repair, s: TBState) => Partial<Repair>,
  extra?: (s: TBState, r: Repair) => Partial<TBState>,
) {
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
const eqName = (s: TBState, r: Repair) => {
  const e = s.equipment.find((x) => x.id === r.equipmentId);
  return e ? `${e.make} ${e.model}` : "machine";
};

// ---------- actions ----------
export function isDemoQuotePending(r: Repair): boolean {
  if (!r.quote || !r.quote.sentAt || r.quote.sentAt <= 0) return false;
  const tl = r.timeline || [];
  let lastApprovalIdx = -1;
  let lastRevisionIdx = -1;
  for (let i = 0; i < tl.length; i++) {
    const note = (tl[i]?.note || "").toLowerCase();
    if (note.includes("approved")) lastApprovalIdx = i;
    if (
      note.includes("revised quote") ||
      note.includes("quote formulated") ||
      note.includes("quote sent") ||
      note.includes("parts requested")
    ) {
      lastRevisionIdx = i;
    }
  }
  if (lastApprovalIdx === -1) return true;
  if (lastRevisionIdx >= lastApprovalIdx) return true;
  return false;
}

export const actions = {
  login(role: Role, userId: string) {
    set((s) => ({ ...s, session: { role, userId } }));
  },
  logout() {
    set((s) => ({ ...s, session: null }));
  },
  markRead(role: Role, userId?: string) {
    set((s) => ({
      ...s,
      notifications: s.notifications.map((n) =>
        n.role === role && (!n.userId || n.userId === userId) ? { ...n, read: true } : n,
      ),
    }));
  },
  addEquipment(e: Omit<Equipment, "id" | "status">) {
    const id = "e" + uid();
    set((s) => ({ ...s, equipment: [...s.equipment, { ...e, id, status: "Operational" }] }));
    return id;
  },
  createRepair(p: {
    equipmentId: string;
    farmerId: string;
    symptoms: string[];
    description: string;
    photos: string[];
    location: string;
  }) {
    const id = "TB-" + (9000 + Math.floor(Math.random() * 900));
    const now = Date.now();
    const r: Repair = {
      id,
      ...p,
      technicianId: null,
      status: "REQUESTED",
      testing: false,
      assessment: assess(p.symptoms, p.description),
      createdAt: now,
      statusSince: now,
      declinedBy: [],
      notes: [],
      timeline: [{ status: "REQUESTED", at: now, by: "farmer", note: "Breakdown reported" }],
    };
    set((s) => ({
      ...s,
      repairs: [r, ...s.repairs],
      equipment: s.equipment.map((e) =>
        e.id === p.equipmentId ? { ...e, status: "In Repair" } : e,
      ),
    }));
    return id;
  },
  requestTechnician(id: string, techId: string) {
    patchRepair(
      id,
      () => ({ technicianId: techId }),
      (s, r) => ({
        notifications: notify(s, {
          role: "technician",
          userId: techId,
          text: `New repair request ${id}: ${eqName(s, r)}`,
          link: `/technician/job/${id}`,
        }),
      }),
    );
  },
  accept(id: string) {
    patchRepair(
      id,
      (r) => ({ status: "ACCEPTED", timeline: tl(r, { status: "ACCEPTED", by: "technician" }) }),
      (s, r) => ({
        notifications: notify(s, {
          role: "farmer",
          userId: r.farmerId,
          text: `Technician assigned to ${id}. Inspection on the way.`,
          link: `/farmer/repair/${id}`,
        }),
      }),
    );
  },
  decline(id: string, reason: string) {
    patchRepair(
      id,
      (r) => ({
        declinedBy: r.technicianId ? [...r.declinedBy, r.technicianId] : r.declinedBy,
        technicianId: null,
        status: "REQUESTED",
        timeline: tl(r, {
          status: "REQUESTED",
          by: "technician",
          note: `Declined: ${reason}. Returned to dispatch.`,
        }),
      }),
      (s, r) => ({
        notifications: notify(
          {
            ...s,
            notifications: notify(s, {
              role: "admin",
              text: `${id} declined (${reason}) — needs reassignment`,
              link: `/admin/repair/${id}`,
            }),
          },
          {
            role: "farmer",
            userId: r.farmerId,
            text: `Technician couldn't take ${id}. Please pick another technician.`,
            link: `/farmer/repair/${id}`,
          },
        ),
      }),
    );
  },
  sendQuote(id: string, q: Omit<Quote, "version" | "sentAt">) {
    patchRepair(
      id,
      (r) => {
        const nextStatus = r.status === "WAITING_FOR_PARTS" ? "WAITING_FOR_PARTS" : "QUOTE_PENDING";
        const isRevision = Boolean(r.quote && r.quote.sentAt > 0);
        return {
          quote: {
            ...q,
            version: (r.quote?.version && r.quote.version > 0 ? r.quote.version : 0) + 1,
            sentAt: Date.now(),
          },
          status: nextStatus,
          clarification: undefined,
          timeline: tl(r, {
            status: nextStatus,
            by: "technician",
            note: isRevision ? "Revised quote sent" : "Quote sent",
          }),
        };
      },
      (s, r) => ({
        notifications: notify(s, {
          role: "farmer",
          userId: r.farmerId,
          text: `Quote ready for ${id}: ₹${quoteTotals(r.quote!).total.toLocaleString("en-IN")}`,
          link: `/farmer/repair/${id}`,
        }),
      }),
    );
  },
  approveQuote(id: string) {
    patchRepair(
      id,
      (r) => {
        const nextStatus = r.status === "WAITING_FOR_PARTS" ? "WAITING_FOR_PARTS" : "IN_PROGRESS";
        return {
          status: nextStatus,
          timeline: tl(r, {
            status: nextStatus,
            by: "farmer",
            note:
              r.status === "WAITING_FOR_PARTS"
                ? "Quote revision approved while waiting for parts"
                : "Quote approved & repair authorized",
          }),
        };
      },
      (s, r) => {
        const handedOffReqs = (s.serviceCentrePartRequests ?? []).filter(
          (req) => req.repair_request_id === id && req.status === "HANDED_OFF",
        );
        const existingSales = s.serviceCentrePartSales ?? [];
        const newSales: DemoPartSale[] = [];
        const nowIso = new Date().toISOString();

        for (const req of handedOffReqs) {
          const alreadySold = existingSales.some((sale) => sale.part_request_id === req.id);
          if (alreadySold) continue;

          const part = (s.serviceCentreParts ?? []).find((p) => p.id === req.part_id);
          if (!part || !r.quote?.parts) continue;

          const quotePart = r.quote.parts.find(
            (qp) =>
              (qp.catalogPartId && qp.catalogPartId === part.id) ||
              qp.name.toLowerCase() === part.name.toLowerCase() ||
              qp.spec.toLowerCase().includes(part.part_number.toLowerCase()),
          );
          if (quotePart) {
            const alreadySoldQtyForPart = [
              ...existingSales.filter(
                (sale) =>
                  sale.repair_request_id === id &&
                  (sale.quote_item_id === (quotePart.catalogPartId || part.id) ||
                    sale.part_id === part.id),
              ),
              ...newSales.filter(
                (sale) =>
                  sale.repair_request_id === id &&
                  (sale.quote_item_id === (quotePart.catalogPartId || part.id) ||
                    sale.part_id === part.id),
              ),
            ].reduce((sum, sale) => sum + sale.quantity, 0);

            const eligibleQty = Math.max(0, Math.min(req.quantity, quotePart.qty - alreadySoldQtyForPart));
            if (eligibleQty > 0) {
              newSales.push({
                id: "sale-" + uid(),
                part_id: part.id,
                part_name: part.name,
                part_number: part.part_number,
                repair_request_id: id,
                quote_id: "q-" + id,
                quote_item_id: quotePart.catalogPartId || part.id,
                part_request_id: req.id,
                quantity: eligibleQty,
                unit_price: quotePart.price,
                total_amount: eligibleQty * quotePart.price,
                sold_at: nowIso,
                recorded_by: "Farmer Approval",
                notes: "Sold upon quote approval for pre-issued component",
                created_at: nowIso,
              });
            }
          }
        }

        return {
          serviceCentrePartSales: [...newSales, ...existingSales],
          notifications: notify(s, {
            role: "technician",
            userId: r.technicianId!,
            text: `${id} quote approved — you may start work`,
            link: `/technician/job/${id}`,
          }),
        };
      },
    );
  },
  declineQuote(id: string, reason: string) {
    patchRepair(
      id,
      (r) => ({
        status: "QUOTE_REVISED",
        clarification: reason,
        timeline: tl(r, { status: "QUOTE_REVISED", by: "farmer", note: reason }),
      }),
      (s, r) => ({
        notifications: notify(s, {
          role: "technician",
          userId: r.technicianId!,
          text: `${id}: farmer asked for quote revision — "${reason}"`,
          link: `/technician/job/${id}`,
        }),
      }),
    );
  },
  waitForParts(
    id: string,
    p: Omit<PartsHold, "since"> & {
      items?: BlockerPartItem[];
      partId?: string;
      requestId?: string;
      quantity?: number;
    },
  ) {
    if (p.partId) {
      try {
        requestDemoPart({
          repairRequestId: id,
          partId: p.partId,
          quantity: p.quantity || 1,
          notes: p.reason,
          eta: p.eta,
          revisedCompletion: p.revisedCompletion,
          farmerNote: p.note,
        });
        return;
      } catch {
        // Fall back to standard patchRepair if part not in catalog
      }
    }
    patchRepair(
      id,
      (r) => {
        const existingItems: BlockerPartItem[] = Array.isArray(r.parts?.items)
          ? [...r.parts.items]
          : r.parts?.part
            ? [
                {
                  id: r.parts.part,
                  part: r.parts.part,
                  reason: r.parts.reason,
                  eta: r.parts.eta,
                  revisedCompletion: r.parts.revisedCompletion,
                  status: "PENDING",
                  since: r.parts.since,
                },
              ]
            : [];

        const newItem: BlockerPartItem = {
          id: p.requestId || p.partId || p.part,
          part: p.part,
          partId: p.partId || null,
          quantity: p.quantity || 1,
          reason: p.reason,
          eta: p.eta,
          revisedCompletion: p.revisedCompletion,
          status: "PENDING",
          since: Date.now(),
        };

        const existingIdx = existingItems.findIndex(
          (it) =>
            (newItem.id && it.id === newItem.id) ||
            (newItem.partId && it.partId === newItem.partId) ||
            it.part.toLowerCase() === newItem.part.toLowerCase(),
        );

        if (existingIdx >= 0) {
          existingItems[existingIdx] = { ...existingItems[existingIdx], ...newItem };
        } else {
          existingItems.push(newItem);
        }

        const pendingItems = existingItems.filter((it) => it.status === "PENDING");
        const summaryPart =
          pendingItems.length > 1
            ? `${pendingItems.length} parts (${pendingItems.map((i) => i.part).join(", ")})`
            : p.part;

        return {
          status: "WAITING_FOR_PARTS",
          testing: false,
          parts: {
            ...p,
            part: summaryPart,
            since: Date.now(),
            items: existingItems,
            allPartsArrived: pendingItems.length === 0,
          },
          timeline: tl(r, {
            status: "WAITING_FOR_PARTS",
            by: "technician",
            note: `${p.part} — ETA ${p.eta}`,
          }),
        };
      },
      (s, r) => ({
        notifications: notify(s, {
          role: "farmer",
          userId: r.farmerId,
          text: `Repair ${id} paused: waiting for ${p.part} (ETA ${p.eta})`,
          link: `/farmer/repair/${id}`,
        }),
      }),
    );
  },
  updatePartsEta(id: string, eta: string, by: Role, partIdOrRequestId?: string) {
    patchRepair(
      id,
      (r) => {
        if (!r.parts) return {};
        const existingItems: BlockerPartItem[] = Array.isArray(r.parts.items)
          ? [...r.parts.items]
          : [];

        if (partIdOrRequestId && existingItems.length > 0) {
          const matchIdx = existingItems.findIndex(
            (it) =>
              it.id === partIdOrRequestId ||
              it.partId === partIdOrRequestId ||
              it.part.toLowerCase().includes(partIdOrRequestId.toLowerCase()),
          );
          if (matchIdx >= 0 && existingItems[matchIdx]) {
            const currentItem = existingItems[matchIdx]!;
            existingItems[matchIdx] = {
              ...currentItem,
              part: currentItem.part,
              reason: currentItem.reason,
              eta,
              status: currentItem.status,
              since: currentItem.since,
            };
          }
        } else {
          existingItems.forEach((it, idx) => {
            if (it.status === "PENDING") {
              existingItems[idx] = {
                ...it,
                part: it.part,
                reason: it.reason,
                eta,
                status: it.status,
                since: it.since,
              };
            }
          });
        }

        const itemsPayload = existingItems.length > 0 ? existingItems : undefined;
        return {
          parts: {
            ...r.parts,
            eta,
            ...(itemsPayload ? { items: itemsPayload } : {}),
          },
          timeline: tl(r, { status: "NOTE", by, note: `Parts ETA updated: ${eta}` }),
        };
      },
      (s, r) => ({
        notifications: notify(s, {
          role: "farmer",
          userId: r.farmerId,
          text: `${id}: spare part ETA updated to ${eta}`,
          link: `/farmer/repair/${id}`,
        }),
      }),
    );
  },
  resume(id: string) {
    patchRepair(
      id,
      (r) => {
        const nextStatus = "IN_PROGRESS";
        const partName = r.parts?.part ?? "part";
        return {
          status: nextStatus,
          parts: r.parts ? { ...r.parts, allPartsArrived: true } : undefined,
          timeline: tl(r, {
            status: nextStatus,
            by: "technician",
            note: `Part arrived (${partName}). Work resumed.`,
          }),
        };
      },
      (s, r) => ({
        notifications: notify(s, {
          role: "farmer",
          userId: r.farmerId,
          text: `Part arrived — repair ${id} resumed`,
          link: `/farmer/repair/${id}`,
        }),
      }),
    );
  },
  startTesting(id: string) {
    patchRepair(id, (r) => {
      if (isDemoQuotePending(r)) return {};
      if (r.parts?.items?.some((it: any) => it.status === "PENDING")) return {};
      return {
        testing: true,
        timeline: tl(r, {
          status: "TESTING",
          by: "technician",
          note: "Repair done, testing under load",
        }),
      };
    });
  },
  addNote(id: string, text: string) {
    patchRepair(id, (r) => ({
      notes: [...r.notes, { at: Date.now(), text }],
      timeline: tl(r, { status: "NOTE", by: "technician", note: text }),
    }));
  },
  complete(id: string, notes: string, photo?: string) {
    set((s) => {
      const r = s.repairs.find((x) => x.id === id);
      if (!r || !r.quote) return s;
      if (isDemoQuotePending(r)) return s;
      if (r.parts?.items?.some((it: any) => it.status === "PENDING")) return s;
      const now = Date.now();
      const t = s.technicians.find((x) => x.id === r.technicianId);
      const e = s.equipment.find((x) => x.id === r.equipmentId)!;
      const tot = quoteTotals(r.quote);
      const rec: ServiceRecord = {
        id: "S-" + uid(),
        equipmentId: r.equipmentId,
        repairId: r.id,
        date: now,
        hours: e.hours,
        type: r.assessment.system + " Repair",
        issue: r.assessment.possibleIssue,
        parts: r.quote.parts.map((p) => `${p.name}${p.qty > 1 ? ` ×${p.qty}` : ""}`),
        labour: tot.labour,
        total: tot.total,
        technician: t?.name ?? "—",
        workshop: t?.workshop ?? "—",
        notes,
        advice: r.assessment.maintenanceAdvice,
        downtimeH: Math.round(((now - r.createdAt) / HR) * 10) / 10,
        invoice: `INV-${r.id}`,
      };
      const nr: Repair = {
        ...r,
        status: "COMPLETED",
        testing: false,
        statusSince: now,
        completion: { notes, photo, at: now },
        timeline: [
          ...r.timeline,
          { status: "COMPLETED", at: now, by: "technician", note: "Repair completed & tested" },
        ],
      };
      const ns = {
        ...s,
        repairs: s.repairs.map((x) => (x.id === id ? nr : x)),
        service: [rec, ...s.service],
        equipment: s.equipment.map((x) =>
          x.id === e.id ? { ...x, status: "Operational" as const } : x,
        ),
      };
      return {
        ...ns,
        notifications: notify(ns, {
          role: "farmer",
          userId: r.farmerId,
          text: `${e.make} ${e.model} is repaired and saved to service history.`,
          link: `/farmer/repair/${id}`,
        }),
      };
    });
  },
  verify(id: string) {
    patchRepair(
      id,
      (r) => ({
        verifiedAt: Date.now(),
        timeline: tl(r, { status: "VERIFIED", by: "farmer", note: "Farmer confirmed handover" }),
      }),
      (s, r) => ({
        notifications: notify(s, {
          role: "technician",
          userId: r.technicianId!,
          text: `${id} handover confirmed by farmer`,
          link: `/technician/job/${id}`,
        }),
      }),
    );
  },
  cancel(id: string) {
    set((s) => {
      const r = s.repairs.find((x) => x.id === id);
      if (!r) return s;
      return {
        ...s,
        repairs: s.repairs.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "CANCELLED" as const,
                statusSince: Date.now(),
                timeline: tl(x, { status: "CANCELLED", by: "farmer" }),
              }
            : x,
        ),
        equipment: s.equipment.map((e) =>
          e.id === r.equipmentId ? { ...e, status: "Operational" as const } : e,
        ),
      };
    });
  },
  reassign(id: string, techId: string) {
    patchRepair(
      id,
      (r, s) => ({
        technicianId: techId,
        status: r.status === "REQUESTED" ? "REQUESTED" : r.status,
        timeline: tl(r, {
          status: "REASSIGNED",
          by: "admin",
          note: `Assigned to ${s.technicians.find((t) => t.id === techId)?.name}`,
        }),
      }),
      (s, r) => ({
        notifications: notify(s, {
          role: "technician",
          userId: techId,
          text: `Service centre assigned you ${id}: ${eqName(s, r)}`,
          link: `/technician/job/${id}`,
        }),
      }),
    );
  },
  setAvailability(techId: string, available: boolean) {
    set((s) => ({
      ...s,
      technicians: s.technicians.map((t) => (t.id === techId ? { ...t, available } : t)),
    }));
  },
};

// ---------- labels ----------
export const FARMER_LABEL: Record<RepairStatus, string> = {
  REQUESTED: "Finding Your Technician",
  ACCEPTED: "Technician Assigned",
  QUOTE_PENDING: "Quote Ready for Your Review",
  QUOTE_REVISED: "Revision Requested · Awaiting Technician",
  IN_PROGRESS: "Repair in Progress",
  WAITING_FOR_PARTS: "Paused: Waiting for Spare Parts",
  COMPLETED: "Repair Complete & Verified",
  CANCELLATION_REQUESTED: "Cancellation Pending Review",
  CANCELLED: "Cancelled",
};
export const STAFF_LABEL: Record<RepairStatus, string> = {
  REQUESTED: "Requested",
  ACCEPTED: "Accepted",
  QUOTE_PENDING: "Quote pending",
  QUOTE_REVISED: "Quote revision requested",
  IN_PROGRESS: "In progress",
  WAITING_FOR_PARTS: "Waiting for parts",
  COMPLETED: "Completed",
  CANCELLATION_REQUESTED: "Cancellation requested",
  CANCELLED: "Cancelled",
};
export const isActive = (r: Repair) =>
  r.status !== "CANCELLED" && !(r.status === "COMPLETED" && r.verifiedAt);
export const OVERDUE_MIN: Partial<Record<RepairStatus, number>> = {
  REQUESTED: 20,
  ACCEPTED: 180,
  QUOTE_PENDING: 240,
  QUOTE_REVISED: 120,
  WAITING_FOR_PARTS: 24 * 60,
};
export const isOverdue = (r: Repair) => {
  const lim = OVERDUE_MIN[r.status];
  return lim !== undefined && Date.now() - r.statusSince > lim * MIN;
};
export const ago = (t: number) => {
  if (typeof t !== "number" || isNaN(t)) return "just now";
  const m = Math.max(0, Math.round((Date.now() - t) / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)} days`;
};
export const inr = (n: number) => "₹" + (typeof n === "number" && !isNaN(n) ? n.toLocaleString("en-IN") : "0");
export const fmtDate = (t: number) => {
  if (typeof t !== "number" || isNaN(t)) return "—";
  try {
    return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
};
export const fmtTime = (t: number) => {
  if (typeof t !== "number" || isNaN(t)) return "—";
  try {
    return new Date(t).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

// ---------- demo parts desk helpers ----------
export function getDemoParts(): DemoPart[] {
  load();
  if (!state.serviceCentreParts || state.serviceCentreParts.length === 0) {
    state.serviceCentreParts = INITIAL_DEMO_PARTS.map((p) => ({ ...p }));
  }
  return state.serviceCentreParts;
}

export function getDemoPartById(id: string): DemoPart | null {
  load();
  return (
    state.serviceCentreParts?.find((p) => p.id === id || p.part_number === id) ??
    INITIAL_DEMO_PARTS.find((p) => p.id === id || p.part_number === id) ??
    null
  );
}

export function adjustDemoPartStock(
  partId: string,
  changeQuantity: number,
  reason: string,
  callerName: string = "Nagpur Service Centre",
): DemoPart {
  let updatedPart: DemoPart | null = null;
  set((s) => {
    const parts = s.serviceCentreParts ?? INITIAL_DEMO_PARTS.map((p) => ({ ...p }));
    const target = parts.find((p) => p.id === partId || p.part_number === partId);
    if (!target) {
      throw new Error("Part not found in Service Centre catalog.");
    }

    const previousStock = target.stock_quantity;
    const newStock = previousStock + changeQuantity;
    if (newStock < 0) {
      throw new Error(
        `Insufficient stock: Cannot adjust below 0 (current: ${previousStock}, change: ${changeQuantity}).`,
      );
    }

    const nowIso = new Date().toISOString();
    updatedPart = { ...target, stock_quantity: newStock, updated_at: nowIso };

    const auditEntry: DemoStockAudit = {
      id: "aud-" + uid(),
      part_id: target.id,
      change_quantity: changeQuantity,
      previous_stock: previousStock,
      new_stock: newStock,
      movement_type: "ADJUSTMENT",
      reason,
      changed_by: callerName,
      created_at: nowIso,
    };

    return {
      ...s,
      serviceCentreParts: parts.map((p) => (p.id === target.id ? updatedPart! : p)),
      serviceCentreStockAudit: [auditEntry, ...(s.serviceCentreStockAudit ?? [])],
    };
  });

  return updatedPart!;
}

export function requestDemoPart(input: {
  repairRequestId: string;
  partId: string;
  quantity: number;
  notes?: string | null;
  eta?: string | null | undefined;
  revisedCompletion?: string | null | undefined;
  farmerNote?: string | null | undefined;
  requesterId?: string | undefined;
  requesterName?: string | undefined;
}): DemoPartRequest {
  let newReq: DemoPartRequest | null = null;
  set((s) => {
    const parts = s.serviceCentreParts ?? INITIAL_DEMO_PARTS.map((p) => ({ ...p }));
    const target = parts.find((p) => p.id === input.partId || p.part_number === input.partId);
    if (!target) {
      throw new Error("Part not found in Service Centre catalog.");
    }

    const nowIso = new Date().toISOString();
    const cleanJob = (input.repairRequestId || "").trim().toLowerCase();
    const existingReqIndex = (s.serviceCentrePartRequests ?? []).findIndex(
      (r) =>
        (r.repair_request_id.toLowerCase() === cleanJob ||
          (cleanJob.startsWith("tb-") && r.repair_request_id.toLowerCase() === cleanJob)) &&
        r.part_id === target.id &&
        r.status === "PENDING",
    );

    let updatedRequests = s.serviceCentrePartRequests ?? [];
    const createdReq: DemoPartRequest =
      existingReqIndex >= 0 && updatedRequests[existingReqIndex]
        ? {
            ...updatedRequests[existingReqIndex]!,
            quantity: input.quantity,
            notes: input.notes?.trim() || updatedRequests[existingReqIndex]!.notes || null,
            estimated_arrival_at: input.eta?.trim() || updatedRequests[existingReqIndex]!.estimated_arrival_at || null,
            eta_updated_by: input.eta?.trim() ? (input.requesterId || "t1") : (updatedRequests[existingReqIndex]!.eta_updated_by ?? null),
            eta_updated_at: input.eta?.trim() ? nowIso : (updatedRequests[existingReqIndex]!.eta_updated_at ?? null),
            updated_at: nowIso,
          }
        : {
            id: "req-" + uid(),
            repair_request_id: input.repairRequestId,
            part_id: target.id,
            quantity: input.quantity,
            status: "PENDING",
            requested_by: input.requesterId || "t1",
            notes: input.notes?.trim() || null,
            estimated_arrival_at: input.eta?.trim() || null,
            eta_updated_by: input.eta?.trim() ? (input.requesterId || "t1") : null,
            eta_updated_at: input.eta?.trim() ? nowIso : null,
            created_at: nowIso,
            updated_at: nowIso,
          };

    newReq = createdReq;

    if (existingReqIndex >= 0) {
      updatedRequests = updatedRequests.map((r, i) => (i === existingReqIndex ? createdReq : r));
    } else {
      updatedRequests = [createdReq, ...updatedRequests];
    }

    const existingReq = existingReqIndex >= 0 ? (s.serviceCentrePartRequests ?? [])[existingReqIndex] : null;
    const isRetry = Boolean(existingReq);
    const isChanged =
      isRetry &&
      (existingReq!.quantity !== input.quantity ||
        (input.notes?.trim() || null) !== (existingReq!.notes || null) ||
        (input.eta?.trim() || null) !== (existingReq!.estimated_arrival_at || null));

    let notifText: string | null = null;
    if (!isRetry) {
      notifText = `New depot requisition: ${target.name} (${input.quantity}x) requested for ${input.repairRequestId}.`;
    } else if (isChanged) {
      notifText = `Depot requisition updated: ${target.name} (${input.quantity}x) for ${input.repairRequestId}.`;
    }

    const etaText = input.eta?.trim() ? input.eta.trim() : "ETA pending";
    const blockerItem: BlockerPartItem = {
      id: createdReq.id,
      part: target.name,
      partId: target.id,
      quantity: input.quantity,
      reason: input.notes?.trim() || "Waiting for parts delivery",
      eta: etaText,
      status: "PENDING",
      since: Date.now(),
      eta_updated_by: input.eta?.trim() ? (input.requesterId || "t1") : null,
      eta_updated_at: input.eta?.trim() ? nowIso : null,
    };

    let updatedRepairs = s.repairs;
    const repairIdx = s.repairs.findIndex(
      (r) =>
        r.id.toLowerCase() === cleanJob ||
        (r as any).jobNumber?.toLowerCase() === cleanJob ||
        (cleanJob.startsWith("tb-") && r.id.toLowerCase() === cleanJob),
    );

    if (repairIdx >= 0 && s.repairs[repairIdx]) {
      const targetRep = s.repairs[repairIdx]!;
      const currentParts = targetRep.parts;
      const existingItems: BlockerPartItem[] = Array.isArray(currentParts?.items)
        ? [...currentParts.items]
        : currentParts?.part
          ? [
              {
                id: currentParts.part,
                part: currentParts.part,
                reason: currentParts.reason,
                eta: currentParts.eta || "ETA pending",
                status: "PENDING",
                since: currentParts.since || Date.now(),
              },
            ]
          : [];

      const existingItemIndex = existingItems.findIndex(
        (it) =>
          (it.partId && it.partId === target.id) ||
          it.part.trim().toLowerCase() === target.name.trim().toLowerCase(),
      );

      if (existingItemIndex >= 0 && existingItems[existingItemIndex]) {
        existingItems[existingItemIndex] = {
          ...existingItems[existingItemIndex]!,
          id: createdReq.id,
          quantity: input.quantity,
          eta: etaText,
          status: "PENDING",
          reason: input.notes?.trim() || existingItems[existingItemIndex]!.reason,
        };
      } else {
        existingItems.push(blockerItem);
      }

      const pendingCount = existingItems.filter((i) => i.status === "PENDING").length;
      const summaryPart =
        pendingCount > 1
          ? `${pendingCount} parts (${existingItems
              .filter((i) => i.status === "PENDING")
              .map((i) => i.part)
              .join(", ")})`
          : target.name;

      const updatedPartsHold: PartsHold = {
        part: summaryPart,
        reason: input.notes?.trim() || "Waiting for parts delivery",
        eta: etaText,
        note: input.farmerNote?.trim() || input.notes?.trim() || "",
        revisedCompletion: input.revisedCompletion?.trim() || etaText,
        since: currentParts?.since || Date.now(),
        items: existingItems,
        allPartsArrived: false,
      };

      const existingQuote = targetRep.quote;
      let existingParts: QuotePart[] = existingQuote?.parts ? [...existingQuote.parts] : [];

      const newQuoteLine: QuotePart = {
        name: target.name,
        spec: target.spec || target.part_number,
        qty: input.quantity,
        price: target.unit_price,
        source: "Nagpur Service Centre Depot",
        catalogPartId: target.id,
      };

      const existingPartIndex = existingParts.findIndex(
        (p) =>
          (p.catalogPartId && p.catalogPartId === target.id) ||
          p.name.trim().toLowerCase() === target.name.trim().toLowerCase() ||
          p.spec.trim().toLowerCase() === target.part_number.trim().toLowerCase(),
      );

      if (existingPartIndex >= 0 && existingParts[existingPartIndex]) {
        const prevLine = existingParts[existingPartIndex]!;
        existingParts[existingPartIndex] = {
          ...prevLine,
          name: prevLine.name,
          qty: input.quantity,
          price: target.unit_price,
          spec: target.spec || target.part_number,
          catalogPartId: target.id,
          source: "Nagpur Service Centre Depot",
        };
      } else {
        if (
          existingParts.length === 1 &&
          existingParts[0] &&
          !existingParts[0].name.trim() &&
          existingParts[0].qty === 1
        ) {
          existingParts = [newQuoteLine];
        } else {
          existingParts.push(newQuoteLine);
        }
      }

      // Check if quote was already submitted (QUOTE_PENDING) or approved (IN_PROGRESS or WAITING_FOR_PARTS with quote)
      const hasPriorQuoteSubmitted =
        Boolean(existingQuote && existingQuote.sentAt > 0 && existingQuote.version > 0) &&
        (targetRep.status === "QUOTE_PENDING" ||
          targetRep.status === "IN_PROGRESS" ||
          targetRep.status === "WAITING_FOR_PARTS");

      let updatedQuote: Quote;
      let timelineEntry: TimelineEntry;

      if (hasPriorQuoteSubmitted && existingQuote) {
        // Was it already a pending revision or newly revised?
        const isAlreadyPendingRevision =
          targetRep.status === "WAITING_FOR_PARTS" &&
          targetRep.timeline.some((t) => t.note?.includes("Revised quote v"));

        const nextVersion = isAlreadyPendingRevision
          ? existingQuote.version
          : (existingQuote.version || 1) + 1;

        updatedQuote = {
          ...existingQuote,
          parts: existingParts,
          version: nextVersion,
          sentAt: Date.now(),
        };

        timelineEntry = {
          status: "WAITING_FOR_PARTS",
          at: Date.now(),
          by: "technician",
          note: `Parts requested: ${target.name} (Qty ${input.quantity}). Revised quote v${nextVersion} sent for farmer review.`,
        };
      } else {
        updatedQuote = existingQuote
          ? { ...existingQuote, parts: existingParts }
          : {
              parts: existingParts,
              labourDesc: "Inspection, repair and test run",
              labour: 800,
              taxPct: 0,
              eta: "",
              warranty: "90 days on parts & labour",
              version: 0,
              sentAt: 0,
            };

        timelineEntry = {
          status: "WAITING_FOR_PARTS",
          at: Date.now(),
          by: "technician",
          note: `Parts requested: ${target.name} (Qty ${input.quantity}). Waiting for delivery (ETA: ${etaText}).`,
        };
      }

      const updatedRepair: Repair = {
        ...targetRep,
        status: "WAITING_FOR_PARTS",
        statusSince: Date.now(),
        parts: updatedPartsHold,
        quote: updatedQuote,
        timeline: [...targetRep.timeline, timelineEntry],
      };

      updatedRepairs = s.repairs.map((r, i) => (i === repairIdx ? updatedRepair : r));
    }

    return {
      ...s,
      repairs: updatedRepairs,
      serviceCentrePartRequests: updatedRequests,
      notifications: notifText
        ? notify(s, {
            role: "admin",
            text: notifText,
            link: "/admin/parts-desk",
          })
        : s.notifications,
    };
  });

  return newReq!;
}

export function confirmDemoPartHandoff(
  requestId: string,
  adminName: string = "Nagpur Service Centre",
): { request: DemoPartRequest; part: DemoPart } {
  let result: { request: DemoPartRequest; part: DemoPart } | null = null;
  set((s) => {
    const reqs = s.serviceCentrePartRequests ?? [];
    const cleanId = (requestId || "").trim();
    const targetReq = reqs.find(
      (r) =>
        r.id === cleanId ||
        r.id.toLowerCase() === cleanId.toLowerCase() ||
        (cleanId.startsWith("req-") && r.id === cleanId.slice(4)) ||
        (!cleanId.startsWith("req-") && r.id === `req-${cleanId}`)
    );
    if (!targetReq) {
      throw new Error("Part requisition not found.");
    }
    if (targetReq.status !== "PENDING") {
      throw new Error(`Requisition is already ${targetReq.status}.`);
    }

    const parts = s.serviceCentreParts ?? INITIAL_DEMO_PARTS.map((p) => ({ ...p }));
    const part = parts.find((p) => p.id === targetReq.part_id);
    if (!part) {
      throw new Error("Requested part not found in catalog.");
    }

    if (part.stock_quantity < targetReq.quantity) {
      throw new Error(
        `Insufficient stock: ${targetReq.quantity} requested, but only ${part.stock_quantity} available.`,
      );
    }

    const nowIso = new Date().toISOString();
    const previousStock = part.stock_quantity;
    const newStock = previousStock - targetReq.quantity;

    const updatedPart: DemoPart = {
      ...part,
      stock_quantity: newStock,
      updated_at: nowIso,
    };

    const updatedReq: DemoPartRequest = {
      ...targetReq,
      status: "HANDED_OFF",
      handed_off_by: adminName,
      handed_off_at: nowIso,
      updated_at: nowIso,
    };

    const auditEntry: DemoStockAudit = {
      id: "aud-" + uid(),
      part_id: part.id,
      change_quantity: -targetReq.quantity,
      previous_stock: previousStock,
      new_stock: newStock,
      movement_type: "ISSUED_TO_REPAIR",
      reason: "technician_handoff",
      changed_by: adminName,
      repair_request_id: targetReq.repair_request_id,
      part_request_id: targetReq.id,
      created_at: nowIso,
    };

    // Check if the repair has an approved quote line for this catalog part
    const repair = s.repairs.find((rep) => rep.id === targetReq.repair_request_id);
    const isQuoteApproved =
      repair &&
      (repair.status === "IN_PROGRESS" ||
        repair.status === "COMPLETED" ||
        repair.timeline.some(
          (t) =>
            t.note?.toLowerCase().includes("quote approved") ||
            t.note?.toLowerCase().includes("approved while waiting for parts") ||
            (t.by === "farmer" && t.note?.toLowerCase().includes("approved")),
        ));

    let matchingQuotePart: QuotePart | undefined;
    if (isQuoteApproved && repair?.quote?.parts) {
      matchingQuotePart = repair.quote.parts.find(
        (qp) =>
          (qp.catalogPartId && qp.catalogPartId === part.id) ||
          qp.name.toLowerCase() === part.name.toLowerCase() ||
          qp.spec.toLowerCase().includes(part.part_number.toLowerCase()),
      );
    }

    let newSale: DemoPartSale | null = null;
    if (matchingQuotePart) {
      const alreadySoldQtyForPart = (s.serviceCentrePartSales ?? [])
        .filter(
          (sale) =>
            sale.repair_request_id === targetReq.repair_request_id &&
            (sale.quote_item_id === (matchingQuotePart!.catalogPartId || part.id) ||
              sale.part_id === part.id),
        )
        .reduce((sum, sale) => sum + sale.quantity, 0);

      const eligibleQty = Math.max(
        0,
        Math.min(targetReq.quantity, matchingQuotePart.qty - alreadySoldQtyForPart),
      );

      if (eligibleQty > 0) {
        newSale = {
          id: "sale-" + uid(),
          part_id: part.id,
          part_name: part.name,
          part_number: part.part_number,
          repair_request_id: targetReq.repair_request_id,
          quote_id: "q-" + targetReq.repair_request_id,
          quote_item_id: matchingQuotePart.catalogPartId || part.id,
          part_request_id: targetReq.id,
          movement_audit_id: auditEntry.id,
          quantity: eligibleQty,
          unit_price: matchingQuotePart.price,
          total_amount: eligibleQty * matchingQuotePart.price,
          total_price: eligibleQty * matchingQuotePart.price,
          sold_at: nowIso,
          recorded_by: adminName,
          notes: "Technician handoff against farmer-approved quote",
          created_at: nowIso,
        };
      }
    }

    result = { request: updatedReq, part: updatedPart };

    // Update blocker item in repair.parts if repair has parts hold items
    let updatedRepairs = s.repairs;
    if (repair && repair.parts) {
      const currentParts = repair.parts;
      const currentItems: BlockerPartItem[] = Array.isArray(currentParts.items)
        ? [...currentParts.items]
        : [
            {
              id: targetReq.id,
              part: currentParts.part,
              partId: targetReq.part_id,
              quantity: targetReq.quantity,
              reason: currentParts.reason,
              eta: currentParts.eta,
              revisedCompletion: currentParts.revisedCompletion,
              status: "PENDING",
              since: currentParts.since,
            },
          ];

      const matchedItem = currentItems.find(
        (it) =>
          it.id === targetReq.id ||
          (it.partId && it.partId === part.id) ||
          it.part.toLowerCase() === part.name.toLowerCase(),
      );

      if (matchedItem) {
        matchedItem.status = "HANDED_OFF";
      }

      const hasRemainingBlockers = currentItems.some((it) => it.status === "PENDING");

      // CRITICAL: Preserve repair status (WAITING_FOR_PARTS waits for explicit technician resume)
      const updatedRepair: Repair = {
        ...repair,
        status: repair.status,
        parts: {
          ...currentParts,
          items: currentItems,
          allPartsArrived: !hasRemainingBlockers,
        },
      };

      updatedRepairs = s.repairs.map((r) => (r.id === repair.id ? updatedRepair : r));
    }

    return {
      ...s,
      repairs: updatedRepairs,
      serviceCentreParts: parts.map((p) => (p.id === part.id ? updatedPart : p)),
      serviceCentrePartRequests: reqs.map((r) => (r.id === targetReq.id ? updatedReq : r)),
      serviceCentreStockAudit: [auditEntry, ...(s.serviceCentreStockAudit ?? [])],
      serviceCentrePartSales: newSale
        ? [newSale, ...(s.serviceCentrePartSales ?? [])]
        : (s.serviceCentrePartSales ?? []),
      notifications: notify(s, {
        role: "technician",
        userId: targetReq.requested_by,
        text: `Parts handed off: ${part.name} (${targetReq.quantity}x) for ${targetReq.repair_request_id}. Ready for installation.`,
        link: `/technician/job/${targetReq.repair_request_id}`,
      }),
    };
  });

  return result!;
}

export function cancelDemoPartRequest(
  requestId: string,
  cancellerRole: Role = "technician",
): DemoPartRequest {
  let updatedReq: DemoPartRequest | null = null;
  set((s) => {
    const reqs = s.serviceCentrePartRequests ?? [];
    const target = reqs.find((r) => r.id === requestId);
    if (!target) throw new Error("Requisition not found.");
    if (target.status !== "PENDING") throw new Error("Only pending requisitions can be cancelled.");

    const nowIso = new Date().toISOString();
    updatedReq = { ...target, status: "CANCELLED", updated_at: nowIso };

    const catalogParts = s.serviceCentreParts ?? INITIAL_DEMO_PARTS;
    const part = catalogParts.find((p) => p.id === target.part_id);
    const partName = part?.name || "Spare part";

    let nextNotifications = s.notifications;
    if (cancellerRole === "technician") {
      nextNotifications = notify(s, {
        role: "admin",
        text: `Depot requisition cancelled: ${partName} for ${target.repair_request_id}.`,
        link: "/admin/parts-desk",
      });
    } else {
      nextNotifications = notify(s, {
        role: "technician",
        userId: target.requested_by,
        text: `Part request cancelled: ${partName} for ${target.repair_request_id}.`,
        link: `/technician/job/${target.repair_request_id}`,
      });
    }

    return {
      ...s,
      serviceCentrePartRequests: reqs.map((r) => (r.id === requestId ? updatedReq! : r)),
      notifications: nextNotifications,
    };
  });

  return updatedReq!;
}

export function updateDemoPartRequestEta(input: {
  requestId: string;
  estimatedArrivalAt: string | null;
  notes?: string | null | undefined;
  updaterId?: string | undefined;
  updaterName?: string | undefined;
  updaterRole?: string | undefined;
}): DemoPartRequest {
  let updatedReq: DemoPartRequest | null = null;
  set((s) => {
    const reqs = s.serviceCentrePartRequests ?? [];
    const cleanId = (input.requestId || "").trim();
    let target = reqs.find(
      (r) =>
        r.id === cleanId ||
        r.id.toLowerCase() === cleanId.toLowerCase() ||
        (cleanId.startsWith("req-") && r.id === cleanId.slice(4)) ||
        (!cleanId.startsWith("req-") && r.id === "req-" + cleanId),
    );

    if (!target) {
      for (const rep of s.repairs) {
        const item = rep.parts?.items?.find(
          (it: any) =>
            it.id === cleanId ||
            (it.id && it.id.toLowerCase() === cleanId.toLowerCase()) ||
            it.partId === cleanId,
        );
        if (item) {
          const catalogParts = s.serviceCentreParts ?? INITIAL_DEMO_PARTS;
          const cp = catalogParts.find(
            (p) => p.id === item.partId || p.name.toLowerCase() === item.part.toLowerCase(),
          );
          const nowIso = new Date().toISOString();
          target = {
            id: cleanId,
            repair_request_id: rep.id,
            part_id: cp ? cp.id : (item.partId || "00000000-0000-0000-0040-000000000001"),
            quantity: item.quantity || 1,
            status: item.status === "HANDED_OFF" ? "HANDED_OFF" : "PENDING",
            requested_by: rep.technicianId || "t1",
            notes: item.reason || null,
            estimated_arrival_at: input.estimatedArrivalAt?.trim() || null,
            eta_updated_by: input.updaterId || "admin",
            eta_updated_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
          };
          break;
        }
      }
    }

    if (!target) throw new Error("Requisition not found.");
    if (target.status !== "PENDING") {
      throw new Error(`Cannot update ETA: Part request is already ${target.status}.`);
    }

    // Role check: farmer cannot update; technician must be assigned to this repair
    const cleanJob = target.repair_request_id.trim().toLowerCase();
    const repair = s.repairs.find(
      (r) =>
        r.id.toLowerCase() === cleanJob ||
        (r as any).jobNumber?.toLowerCase() === cleanJob ||
        (cleanJob.startsWith("tb-") && r.id.toLowerCase() === cleanJob),
    );

    if (input.updaterRole === "farmer") {
      throw new Error("Unauthorized: Farmers cannot update parts ETA.");
    }
    if (
      input.updaterRole === "technician" &&
      repair &&
      repair.technicianId &&
      input.updaterId &&
      repair.technicianId !== input.updaterId
    ) {
      throw new Error("Unauthorized: Only the assigned technician or Service Centre staff can update part ETA.");
    }

    const nowIso = new Date().toISOString();
    const etaText = input.estimatedArrivalAt?.trim() ? input.estimatedArrivalAt.trim() : "ETA pending";

    updatedReq = {
      ...target,
      estimated_arrival_at: input.estimatedArrivalAt?.trim() || null,
      eta_updated_by: input.updaterId || "admin",
      eta_updated_at: nowIso,
      notes: input.notes !== undefined ? (input.notes?.trim() || null) : target.notes,
      updated_at: nowIso,
    };

    // Find linked part name
    const catalogParts = s.serviceCentreParts ?? INITIAL_DEMO_PARTS;
    const catalogPart = catalogParts.find((p) => p.id === target.part_id);
    const partName = catalogPart?.name || "Spare part";

    let updatedRepairs = s.repairs;
    if (repair) {
      const currentParts = repair.parts;
      const existingItems: BlockerPartItem[] = Array.isArray(currentParts?.items)
        ? [...currentParts.items]
        : currentParts?.part
          ? [
              {
                id: target.id,
                part: currentParts.part,
                reason: currentParts.reason,
                eta: currentParts.eta || "ETA pending",
                status: "PENDING",
                since: currentParts.since || Date.now(),
              },
            ]
          : [];

      const matchIdx = existingItems.findIndex(
        (it) =>
          it.id === target.id ||
          (it.partId && it.partId === target.part_id) ||
          it.part.trim().toLowerCase() === partName.trim().toLowerCase(),
      );

      if (matchIdx >= 0 && existingItems[matchIdx]) {
        existingItems[matchIdx] = {
          ...existingItems[matchIdx]!,
          eta: etaText,
          eta_updated_by: input.updaterId || "admin",
          eta_updated_at: nowIso,
          reason: input.notes?.trim() || existingItems[matchIdx]!.reason,
        };
      } else {
        existingItems.push({
          id: target.id,
          part: partName,
          partId: target.part_id,
          quantity: target.quantity,
          reason: input.notes?.trim() || "Waiting for parts delivery",
          eta: etaText,
          status: "PENDING",
          since: Date.now(),
          eta_updated_by: input.updaterId || "admin",
          eta_updated_at: nowIso,
        });
      }

      // Recompute overall ETA across pending items
      const pendingItems = existingItems.filter((i) => i.status === "PENDING");
      let latestEta = etaText;
      for (const pi of pendingItems) {
        if (pi.eta && pi.eta !== "ETA pending") {
          latestEta = pi.eta;
        }
      }

      const updatedPartsHold: PartsHold = {
        part: currentParts?.part || partName,
        reason: input.notes?.trim() || currentParts?.reason || "Waiting for parts delivery",
        eta: latestEta,
        note: input.notes?.trim() || currentParts?.note || "",
        revisedCompletion: latestEta,
        since: currentParts?.since || Date.now(),
        items: existingItems,
        allPartsArrived: pendingItems.length === 0,
      };

      const updatedTimeline: TimelineEntry[] = [
        ...(repair.timeline || []),
        {
          status: "WAITING_FOR_PARTS",
          at: Date.now(),
          note: `Part ETA updated for ${partName}: ${etaText} by ${input.updaterName || "Staff"}.`,
          by: (input.updaterRole as any) || "admin",
        },
      ];

      updatedRepairs = s.repairs.map((r) =>
        r.id === repair.id
          ? {
              ...r,
              parts: updatedPartsHold,
              timeline: updatedTimeline,
            }
          : r,
      );
    }

    const previousEta = target.estimated_arrival_at || "";
    const newEta = input.estimatedArrivalAt?.trim() || "";
    const isEtaChanged = previousEta !== newEta;

    let nextNotifications = s.notifications;
    if (isEtaChanged) {
      if (input.updaterRole !== "technician") {
        const techId = repair?.technicianId || target.requested_by;
        if (techId) {
          nextNotifications = notify({ ...s, notifications: nextNotifications }, {
            role: "technician",
            userId: techId,
            text: `Parts ETA updated: ${partName} for ${repair?.id || target.repair_request_id} expected ${etaText}.`,
            link: `/technician/job/${repair?.id || target.repair_request_id}`,
          });
        }
      }
      if (repair?.farmerId) {
        nextNotifications = notify({ ...s, notifications: nextNotifications }, {
          role: "farmer",
          userId: repair.farmerId,
          text: `Repair ${repair.id}: Expected completion updated to ${etaText}.`,
          link: `/farmer/repair/${repair.id}`,
        });
      }
    }

    return {
      ...s,
      repairs: updatedRepairs,
      serviceCentrePartRequests: reqs.some((r) => r.id === target.id)
        ? reqs.map((r) => (r.id === target.id ? updatedReq! : r))
        : [updatedReq!, ...reqs],
      notifications: nextNotifications,
    };
  });

  return updatedReq!;
}

export function getDemoPartRequests(repairId?: string): DemoPartRequest[] {
  load();
  const reqs = state.serviceCentrePartRequests ?? [];
  if (!repairId) return reqs;
  return reqs.filter(
    (r) =>
      r.repair_request_id === repairId ||
      r.repair_request_id.toLowerCase() === repairId.toLowerCase(),
  );
}

export function getDemoStockAuditLog(): DemoStockAudit[] {
  load();
  return state.serviceCentreStockAudit ?? [];
}

export function receiveDemoStock(input: {
  partId: string;
  quantity: number;
  reason: string;
  callerName?: string;
}): { part: DemoPart; audit: DemoStockAudit } {
  if (input.quantity <= 0) {
    throw new Error("Received quantity must be greater than zero.");
  }
  let updatedPart: DemoPart | null = null;
  let auditEntry: DemoStockAudit | null = null;

  set((s) => {
    const parts = s.serviceCentreParts ?? INITIAL_DEMO_PARTS.map((p) => ({ ...p }));
    const target = parts.find((p) => p.id === input.partId || p.part_number === input.partId);
    if (!target) throw new Error("Part not found in Service Centre catalog.");

    const previousStock = target.stock_quantity;
    const newStock = previousStock + input.quantity;
    const nowIso = new Date().toISOString();
    updatedPart = { ...target, stock_quantity: newStock, updated_at: nowIso };

    auditEntry = {
      id: "aud-" + uid(),
      part_id: target.id,
      change_quantity: input.quantity,
      previous_stock: previousStock,
      new_stock: newStock,
      movement_type: "RECEIVED",
      reason: input.reason || "Supplier stock delivery",
      changed_by: input.callerName || "Nagpur Service Centre",
      created_at: nowIso,
    };

    const pendingReqs = (s.serviceCentrePartRequests ?? []).filter(
      (r) => r.part_id === target.id && r.status === "PENDING",
    );
    let nextNotifs = s.notifications;
    const notifiedTechs = new Set<string>();
    for (const pr of pendingReqs) {
      const key = `${pr.requested_by}-${pr.repair_request_id}`;
      if (!notifiedTechs.has(key)) {
        notifiedTechs.add(key);
        nextNotifs = notify({ ...s, notifications: nextNotifs }, {
          role: "technician",
          userId: pr.requested_by,
          text: `Part ready for pickup: ${target.name} received at depot for ${pr.repair_request_id}.`,
          link: `/technician/job/${pr.repair_request_id}`,
        });
      }
    }

    return {
      ...s,
      serviceCentreParts: parts.map((p) => (p.id === target.id ? updatedPart! : p)),
      serviceCentreStockAudit: [auditEntry!, ...(s.serviceCentreStockAudit ?? [])],
      notifications: nextNotifs,
    };
  });

  return { part: updatedPart!, audit: auditEntry! };
}

export function returnDemoPart(input: {
  repairRequestId: string;
  partId: string;
  quantity: number;
  reason: string;
  callerName?: string;
}): { part: DemoPart; audit: DemoStockAudit } {
  if (input.quantity <= 0) {
    throw new Error("Return quantity must be greater than zero.");
  }
  let updatedPart: DemoPart | null = null;
  let auditEntry: DemoStockAudit | null = null;

  set((s) => {
    const parts = s.serviceCentreParts ?? INITIAL_DEMO_PARTS.map((p) => ({ ...p }));
    const target = parts.find((p) => p.id === input.partId || p.part_number === input.partId);
    if (!target) throw new Error("Part not found in Service Centre catalog.");

    const previousStock = target.stock_quantity;
    const newStock = previousStock + input.quantity;
    const nowIso = new Date().toISOString();
    updatedPart = { ...target, stock_quantity: newStock, updated_at: nowIso };

    auditEntry = {
      id: "aud-" + uid(),
      part_id: target.id,
      change_quantity: input.quantity,
      previous_stock: previousStock,
      new_stock: newStock,
      movement_type: "RETURNED",
      reason: input.reason || `Unused part returned from ${input.repairRequestId}`,
      changed_by: input.callerName || "Nagpur Service Centre",
      repair_request_id: input.repairRequestId,
      created_at: nowIso,
    };

    return {
      ...s,
      serviceCentreParts: parts.map((p) => (p.id === target.id ? updatedPart! : p)),
      serviceCentreStockAudit: [auditEntry!, ...(s.serviceCentreStockAudit ?? [])],
    };
  });

  return { part: updatedPart!, audit: auditEntry! };
}

export function getDemoSales(filters?: {
  partId?: string;
  startDate?: string;
  endDate?: string;
}): DemoPartSale[] {
  load();
  let sales = state.serviceCentrePartSales ?? [];
  if (filters?.partId) {
    sales = sales.filter((s) => s.part_id === filters.partId || s.part_number === filters.partId);
  }
  if (filters?.startDate) {
    const startMs = new Date(filters.startDate).getTime();
    sales = sales.filter((s) => new Date(s.sold_at).getTime() >= startMs);
  }
  if (filters?.endDate) {
    const endMs = new Date(filters.endDate).getTime();
    sales = sales.filter((s) => new Date(s.sold_at).getTime() <= endMs);
  }
  return sales;
}

export function getDemoMovementSummary(filters?: {
  partId?: string;
  startDate?: string;
  endDate?: string;
}): {
  on_hand: number;
  issued_to_repairs: number;
  returned_from_repairs: number;
  quantity_sold: number;
  gross_sales_value: number;
  returned_sales_value: number;
  net_sale_value: number;
  total_sale_value: number;
} {
  load();
  const parts = state.serviceCentreParts ?? INITIAL_DEMO_PARTS;
  const targetParts = filters?.partId
    ? parts.filter((p) => p.id === filters.partId || p.part_number === filters.partId)
    : parts;
  const on_hand = targetParts.reduce((sum, p) => sum + p.stock_quantity, 0);

  let audits = state.serviceCentreStockAudit ?? [];
  if (filters?.partId) {
    const partIds = new Set(targetParts.map((p) => p.id));
    audits = audits.filter((a) => partIds.has(a.part_id));
  }
  if (filters?.startDate) {
    const startMs = new Date(filters.startDate).getTime();
    audits = audits.filter((a) => new Date(a.created_at).getTime() >= startMs);
  }
  if (filters?.endDate) {
    const endMs = new Date(filters.endDate).getTime();
    audits = audits.filter((a) => new Date(a.created_at).getTime() <= endMs);
  }

  const issued_to_repairs = audits
    .filter((a) => a.movement_type === "ISSUED_TO_REPAIR")
    .reduce((sum, a) => sum + Math.abs(a.change_quantity), 0);

  const returned_from_repairs = audits
    .filter((a) => a.movement_type === "RETURNED")
    .reduce((sum, a) => sum + Math.abs(a.change_quantity), 0);

  const sales = getDemoSales(filters);
  const quantity_sold = sales.reduce((sum, s) => sum + s.quantity, 0);
  const gross_sales_value = sales.reduce((sum, s) => sum + s.total_amount, 0);

  // Compute returns value from RETURNED movements
  const returnedAudits = audits.filter((a) => a.movement_type === "RETURNED");
  const returned_sales_value = returnedAudits.reduce((sum, a) => {
    const matchedPart = parts.find((p) => p.id === a.part_id);
    const unitPrice = a.unit_price || matchedPart?.unit_price || 0;
    return sum + Math.abs(a.change_quantity) * unitPrice;
  }, 0);

  const net_sale_value = Math.max(0, gross_sales_value - returned_sales_value);
  const total_sale_value = net_sale_value;

  return {
    on_hand,
    issued_to_repairs,
    returned_from_repairs,
    quantity_sold,
    gross_sales_value,
    returned_sales_value,
    net_sale_value,
    total_sale_value,
  };
}
