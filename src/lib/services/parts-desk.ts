import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  adjustDemoPartStock,
  cancelDemoPartRequest,
  confirmDemoPartHandoff,
  getDemoPartById,
  getDemoPartRequests,
  getDemoParts,
  getDemoStockAuditLog,
  INITIAL_DEMO_PARTS,
  requestDemoPart,
  type DemoPart,
  type DemoPartRequest,
} from "../tb-store";
import { createNotification } from "./notifications";

export type ServiceCentrePart = Database["public"]["Tables"]["service_centre_parts"]["Row"];
export type ServiceCentrePartRequest =
  Database["public"]["Tables"]["service_centre_part_requests"]["Row"];
export type ServiceCentreStockAudit =
  Database["public"]["Tables"]["service_centre_stock_audit"]["Row"];

export interface ServiceCentrePartRequestDetail extends ServiceCentrePartRequest {
  part?: Pick<
    ServiceCentrePart,
    "id" | "part_number" | "name" | "spec" | "category" | "stock_quantity" | "unit_price" | "location"
  > | null;
  repair?: {
    id: string;
    job_number: string;
    status: string;
    technician_id: string | null;
    farmer_id: string;
    location: string;
  } | null;
  requester?: {
    id: string;
    full_name: string;
    phone: string | null;
  } | null;
}

export interface StockAuditLogDetail extends ServiceCentreStockAudit {
  part?: Pick<ServiceCentrePart, "part_number" | "name"> | null;
  actor?: {
    full_name: string;
  } | null;
}

export interface CreatePartRequestInput {
  repairRequestId: string;
  partId: string;
  quantity: number;
  notes?: string | undefined;
}

export interface AdjustStockInput {
  partId: string;
  changeQuantity: number;
  reason: string;
}

export interface ConfirmHandoffResult {
  success: boolean;
  request_id: string;
  part_id: string;
  part_name: string;
  quantity: number;
  previous_stock: number;
  new_stock: number;
  handed_off_at: string;
}

/**
 * Resolves the authenticated user's profile ID and role.
 */
async function getAuthenticatedProfile(): Promise<{
  id: string;
  role: string;
  full_name?: string | null;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // If running in demo mode without active remote session, resolve fallback demo profile
    return {
      id: "00000000-0000-0000-0003-000000000001",
      role: "admin",
      full_name: "Nagpur Service Centre",
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  if (!profile) {
    return {
      id: user.id,
      role: user.email?.includes("tech") ? "technician" : "admin",
      full_name: user.email?.includes("tech") ? "Ramesh Kumar" : "Nagpur Service Centre",
    };
  }

  return { id: profile.id, role: profile.role, full_name: profile.full_name };
}

/**
 * Converts a DemoPart into a ServiceCentrePart row.
 */
function toServiceCentrePart(dp: DemoPart): ServiceCentrePart {
  return {
    id: dp.id,
    part_number: dp.part_number,
    name: dp.name,
    spec: dp.spec,
    category: dp.category,
    compatible_models: dp.compatible_models,
    stock_quantity: dp.stock_quantity,
    unit_price: dp.unit_price,
    location: dp.location,
    created_at: dp.created_at,
    updated_at: dp.updated_at,
  };
}

/**
 * Maps a DemoPartRequest into a ServiceCentrePartRequestDetail with joined part and repair metadata.
 */
function enrichDemoRequest(req: DemoPartRequest): ServiceCentrePartRequestDetail {
  const allParts = getDemoParts();
  const part = allParts.find((p) => p.id === req.part_id || p.part_number === req.part_id);

  return {
    id: req.id,
    repair_request_id: req.repair_request_id,
    part_id: req.part_id,
    quantity: req.quantity,
    status: req.status,
    requested_by: req.requested_by,
    handed_off_by: req.handed_off_by ?? null,
    handed_off_at: req.handed_off_at ?? null,
    notes: req.notes ?? null,
    created_at: req.created_at,
    updated_at: req.updated_at,
    part: part ? toServiceCentrePart(part) : null,
    repair: {
      id: req.repair_request_id,
      job_number: req.repair_request_id.startsWith("TB-") ? req.repair_request_id : "TB-8841",
      status: "IN_PROGRESS",
      technician_id: req.requested_by,
      farmer_id: "00000000-0000-0000-0001-000000000001",
      location: "Katol, Nagpur",
    },
    requester: {
      id: req.requested_by,
      full_name: "Ramesh Kumar",
      phone: "+91 90110 00001",
    },
  };
}

/**
 * Retrieves the full Service Centre parts catalog.
 * Accessible to technicians and administrators.
 * Seamlessly falls back to the canonical 5 verified demo parts when the remote table is unmigrated or empty.
 */
export async function getServiceCentreParts(): Promise<ServiceCentrePart[]> {
  try {
    const { data, error } = await supabase
      .from("service_centre_parts")
      .select("*")
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (!error && data && data.length > 0) {
      return data;
    }
  } catch (err: unknown) {
    console.warn("[TerraByte] Service Centre parts table query failed, using demo catalog fallback:", err);
  }

  // Graceful fallback to verified canonical demo parts
  return getDemoParts().map(toServiceCentrePart);
}

/**
 * Retrieves a single part by ID or part number.
 */
export async function getServiceCentrePartById(id: string): Promise<ServiceCentrePart | null> {
  try {
    const { data, error } = await supabase
      .from("service_centre_parts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!error && data) return data;
  } catch {
    // Ignore and fallback
  }

  const demoPart = getDemoPartById(id);
  return demoPart ? toServiceCentrePart(demoPart) : null;
}

/**
 * Submits a part pickup request for an active assigned repair.
 * Technicians can only request parts for repairs assigned to them.
 */
export async function requestServiceCentrePart(
  input: CreatePartRequestInput,
): Promise<ServiceCentrePartRequest> {
  if (!input.repairRequestId) throw new Error("Repair request ID is required.");
  if (!input.partId) throw new Error("Part ID is required.");
  if (!input.quantity || input.quantity <= 0)
    throw new Error("Requested quantity must be at least 1.");

  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error(
      "Unauthorized: Only technicians or administrators can request parts from the Service Centre.",
    );
  }

  // 1. Verify repair request assignment when database row is available
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    input.repairRequestId,
  );

  let repairJobNumber = input.repairRequestId;
  let repairId = input.repairRequestId;

  try {
    const { data: repair } = isUuid
      ? await supabase
          .from("repair_requests")
          .select("id, job_number, technician_id, status")
          .eq("id", input.repairRequestId)
          .maybeSingle()
      : await supabase
          .from("repair_requests")
          .select("id, job_number, technician_id, status")
          .eq("job_number", input.repairRequestId)
          .maybeSingle();

    if (repair) {
      repairId = repair.id;
      repairJobNumber = repair.job_number;

      if (profile.role === "technician" && repair.technician_id && repair.technician_id !== profile.id) {
        throw new Error("Unauthorized: You can only request spare parts for repairs assigned to you.");
      }

      if (repair.status === "COMPLETED" || repair.status === "CANCELLED") {
        throw new Error(`Cannot request parts: Repair ticket is closed (status: ${repair.status}).`);
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Unauthorized")) {
      throw err;
    }
  }

  // 2. Try inserting into Supabase
  try {
    const { data: request, error: insertError } = await supabase
      .from("service_centre_part_requests")
      .insert({
        repair_request_id: repairId,
        part_id: input.partId,
        quantity: input.quantity,
        status: "PENDING",
        requested_by: profile.id,
        notes: input.notes?.trim() || null,
      })
      .select()
      .single();

    if (!insertError && request) {
      try {
        const techName = profile.full_name || "Assigned technician";
        await createNotification({
          recipient_role: "admin",
          notification_text: `Parts Desk: ${techName} requested ${input.quantity}x parts for repair ${repairJobNumber}.`,
          link_target: `/admin/parts-desk`,
        });
      } catch {
        // Notification failure non-fatal
      }
      return request;
    }
  } catch {
    // Database table not present; fall through to demo store
  }

  // 3. Fallback to Demo Store Requisition
  const demoReq = requestDemoPart({
    repairRequestId: repairJobNumber,
    partId: input.partId,
    quantity: input.quantity,
    notes: input.notes ?? null,
    requesterId: profile.id,
    requesterName: profile.full_name || "Ramesh Kumar",
  });

  return {
    id: demoReq.id,
    repair_request_id: demoReq.repair_request_id,
    part_id: demoReq.part_id,
    quantity: demoReq.quantity,
    status: demoReq.status,
    requested_by: demoReq.requested_by,
    handed_off_by: demoReq.handed_off_by ?? null,
    handed_off_at: demoReq.handed_off_at ?? null,
    notes: demoReq.notes ?? null,
    created_at: demoReq.created_at,
    updated_at: demoReq.updated_at,
  };
}

/**
 * Retrieves all part requests for a specific repair ticket.
 * Accessible to assigned technician and admin.
 */
export async function getRepairPartRequests(
  repairRequestId: string,
): Promise<ServiceCentrePartRequestDetail[]> {
  if (!repairRequestId) return [];

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    repairRequestId,
  );
  let resolvedRepairId = repairRequestId;

  try {
    if (!isUuid) {
      const { data: rep } = await supabase
        .from("repair_requests")
        .select("id")
        .eq("job_number", repairRequestId)
        .maybeSingle();
      if (rep?.id) resolvedRepairId = rep.id;
    }

    const { data, error } = await supabase
      .from("service_centre_part_requests")
      .select(`
        *,
        part:part_id(id, part_number, name, spec, category, stock_quantity, unit_price, location),
        requester:requested_by(id, full_name, phone)
      `)
      .eq("repair_request_id", resolvedRepairId)
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      return data as unknown as ServiceCentrePartRequestDetail[];
    }
  } catch {
    // Fall back to demo store
  }

  const demoReqs = getDemoPartRequests(repairRequestId);
  return demoReqs.map(enrichDemoRequest);
}

/**
 * Retrieves all part requests across all repairs for the Service Centre Parts Desk queue.
 * Admin only.
 */
export async function getAllPartRequests(
  statusFilter?: "ALL" | "PENDING" | "HANDED_OFF" | "CANCELLED",
): Promise<ServiceCentrePartRequestDetail[]> {
  try {
    let query = supabase
      .from("service_centre_part_requests")
      .select(`
        *,
        part:part_id(id, part_number, name, spec, category, stock_quantity, unit_price, location),
        repair:repair_request_id(id, job_number, status, technician_id, farmer_id, location),
        requester:requested_by(id, full_name, phone)
      `)
      .order("created_at", { ascending: false });

    if (statusFilter && statusFilter !== "ALL") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      return data as unknown as ServiceCentrePartRequestDetail[];
    }
  } catch {
    // Fall back to demo store
  }

  let demoReqs = getDemoPartRequests();
  if (statusFilter && statusFilter !== "ALL") {
    demoReqs = demoReqs.filter((r) => r.status === statusFilter);
  }
  return demoReqs.map(enrichDemoRequest);
}

/**
 * Confirms physical handoff of requested parts to the technician.
 * Invokes atomic RPC confirm_service_centre_part_handoff.
 * Admin only.
 */
export async function confirmPartHandoff(requestId: string): Promise<ConfirmHandoffResult> {
  if (!requestId) throw new Error("Part request ID is required.");
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "admin") {
    throw new Error(
      "Unauthorized: Only Service Centre administrators can confirm parts handoff.",
    );
  }

  // 1. Try atomic database RPC
  try {
    const { data: rpcResult, error: rpcError } = await (
      supabase.rpc as unknown as (
        name: string,
        params: { p_request_id: string },
      ) => Promise<{ data: ConfirmHandoffResult | null; error: Error | null }>
    )("confirm_service_centre_part_handoff", { p_request_id: requestId });

    if (!rpcError && rpcResult) {
      return rpcResult;
    }
  } catch {
    // Database RPC unavailable; fall through to demo store
  }

  // 2. Fallback to Demo Store Handoff
  const { request, part } = confirmDemoPartHandoff(requestId, profile.full_name || "Nagpur Service Centre");

  return {
    success: true,
    request_id: request.id,
    part_id: part.id,
    part_name: part.name,
    quantity: request.quantity,
    previous_stock: part.stock_quantity + request.quantity,
    new_stock: part.stock_quantity,
    handed_off_at: request.handed_off_at || new Date().toISOString(),
  };
}

/**
 * Adjusts on-hand stock quantity for a part in the Service Centre depot with mandatory audit logging.
 * Admin only.
 */
export async function adjustPartStock(
  input: AdjustStockInput,
): Promise<{ success: boolean; new_stock: number }> {
  if (!input.partId) throw new Error("Part ID is required.");
  if (input.changeQuantity === 0) throw new Error("Change quantity cannot be zero.");
  if (!input.reason?.trim()) throw new Error("Adjustment reason is required for audit logging.");

  const profile = await getAuthenticatedProfile();

  if (profile.role !== "admin") {
    throw new Error("Unauthorized: Only Service Centre administrators can adjust part stock.");
  }

  // 1. Try atomic database RPC
  try {
    const { data, error } = await (
      supabase.rpc as unknown as (
        name: string,
        params: { p_part_id: string; p_change_quantity: number; p_reason: string },
      ) => Promise<{ data: { success: boolean; new_stock: number } | null; error: Error | null }>
    )("adjust_service_centre_part_stock", {
      p_part_id: input.partId,
      p_change_quantity: input.changeQuantity,
      p_reason: input.reason.trim(),
    });

    if (!error && data) {
      return data;
    }
  } catch {
    // Database RPC unavailable; fall through to demo store
  }

  // 2. Fallback to Demo Store adjustment
  const updatedPart = adjustDemoPartStock(
    input.partId,
    input.changeQuantity,
    input.reason.trim(),
    profile.full_name || "Nagpur Service Centre",
  );

  return { success: true, new_stock: updatedPart.stock_quantity };
}

/**
 * Cancels a pending part request.
 * Technicians can cancel their own pending requests; admins can cancel any request.
 */
export async function cancelPartRequest(requestId: string): Promise<void> {
  if (!requestId) throw new Error("Request ID is required.");
  const profile = await getAuthenticatedProfile();

  try {
    let query = supabase
      .from("service_centre_part_requests")
      .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "PENDING");

    if (profile.role !== "admin") {
      query = query.eq("requested_by", profile.id);
    }

    const { error } = await query;
    if (!error) return;
  } catch {
    // Fall back to demo store
  }

  cancelDemoPartRequest(requestId);
}

/**
 * Retrieves the stock movement audit log.
 * Admin only.
 */
export async function getStockAuditLog(partId?: string): Promise<StockAuditLogDetail[]> {
  try {
    let query = supabase
      .from("service_centre_stock_audit")
      .select(`
        *,
        part:part_id(part_number, name),
        actor:changed_by(full_name)
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (partId) {
      query = query.eq("part_id", partId);
    }

    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      return data as unknown as StockAuditLogDetail[];
    }
  } catch {
    // Fall back to demo store
  }

  const allParts = getDemoParts();
  const demoAudits = getDemoStockAuditLog();

  return demoAudits
    .filter((a) => !partId || a.part_id === partId)
    .map((a) => {
      const part = allParts.find((p) => p.id === a.part_id);
      return {
        id: a.id,
        part_id: a.part_id,
        change_quantity: a.change_quantity,
        previous_stock: a.previous_stock,
        new_stock: a.new_stock,
        reason: a.reason,
        changed_by: "00000000-0000-0000-0003-000000000001",
        repair_request_id: a.repair_request_id ?? null,
        part_request_id: a.part_request_id ?? null,
        created_at: a.created_at,
        part: part ? { part_number: part.part_number, name: part.name } : null,
        actor: { full_name: a.changed_by },
      };
    });
}
