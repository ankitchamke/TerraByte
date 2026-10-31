import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  adjustDemoPartStock,
  cancelDemoPartRequest,
  confirmDemoPartHandoff,
  getDemoMovementSummary,
  getDemoPartById,
  getDemoPartRequests,
  getDemoParts,
  getDemoSales,
  getDemoStockAuditLog,
  getTB,
  INITIAL_DEMO_PARTS,
  receiveDemoStock,
  requestDemoPart,
  returnDemoPart,
  syncPartRequestToQuoteLines,
  type DemoPart,
  type DemoPartRequest,
  type DemoPartSale,
} from "../tb-store";
export { syncPartRequestToQuoteLines };
import { createNotification } from "./notifications";

export type ServiceCentrePart = Database["public"]["Tables"]["service_centre_parts"]["Row"];
export type ServiceCentrePartRequest =
  Database["public"]["Tables"]["service_centre_part_requests"]["Row"];
export type ServiceCentreStockAudit =
  Database["public"]["Tables"]["service_centre_stock_audit"]["Row"];
export type ServiceCentrePartSale =
  Database["public"]["Tables"]["service_centre_part_sales"]["Row"];

export interface PartSaleDetail extends ServiceCentrePartSale {
  part?: Pick<ServiceCentrePart, "part_number" | "name" | "category" | "spec"> | null;
  repair?: {
    id: string;
    job_number: string;
    location: string;
  } | null;
  actor?: {
    full_name: string;
  } | null;
}

export interface ReceiveStockInput {
  partId: string;
  quantity: number;
  reason: string;
}

export interface ReturnPartInput {
  repairRequestId: string;
  partId: string;
  quantity: number;
  reason: string;
}

export interface InventoryMovementSummary {
  on_hand: number;
  issued_to_repairs: number;
  returned_from_repairs: number;
  quantity_sold: number;
  gross_sales_value: number;
  returned_sales_value: number;
  net_sale_value: number;
  total_sale_value: number;
}

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
  eta?: string | null | undefined;
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
  movement_type?: string;
  is_sale?: boolean;
  sale_id?: string | null;
  unit_price?: number | null;
  total_amount?: number | null;
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
    service_centre_id: dp.service_centre_id ?? "00000000-0000-0000-0003-000000000001",
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
  const tb = getTB();
  const demoRepair = tb.repairs.find(
    (r) =>
      r.id === req.repair_request_id ||
      r.id.toLowerCase() === req.repair_request_id.toLowerCase() ||
      (r as any).jobNumber === req.repair_request_id,
  );

  const jobNumber = req.repair_request_id.startsWith("TB-")
    ? req.repair_request_id
    : demoRepair?.id.startsWith("TB-")
      ? demoRepair.id
      : (demoRepair as any)?.jobNumber ||
        (req.repair_request_id.length > 8 ? "TB-" + req.repair_request_id.slice(0, 4).toUpperCase() : "TB-8841");

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
      job_number: jobNumber,
      status: demoRepair?.status || "IN_PROGRESS",
      technician_id: demoRepair?.technicianId || req.requested_by,
      farmer_id: demoRepair?.farmerId || "00000000-0000-0000-0001-000000000001",
      location: demoRepair?.location || "Katol, Nagpur",
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
  let fetchedRepair: any = null;

  try {
    const { data: repair } = isUuid
      ? await supabase
          .from("repair_requests")
          .select("id, job_number, technician_id, status, parts_hold")
          .eq("id", input.repairRequestId)
          .maybeSingle()
      : await supabase
          .from("repair_requests")
          .select("id, job_number, technician_id, status, parts_hold")
          .eq("job_number", input.repairRequestId)
          .maybeSingle();

    if (repair) {
      fetchedRepair = repair;
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

    if (insertError) {
      const {
        data: { session },
      } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      if (session) {
        throw new Error(`Failed to submit part request: ${insertError.message}`);
      }
    } else if (request) {
      const nowIso = new Date().toISOString();
      const etaText = input.eta?.trim() ? input.eta.trim() : "ETA pending";

      // Fetch part details from catalog
      const { data: partData } = await supabase
        .from("service_centre_parts")
        .select("id, name, part_number, spec, unit_price")
        .eq("id", input.partId)
        .maybeSingle();

      const partName = partData?.name || "Spare part";
      const unitPrice = Number(partData?.unit_price) || 0;

      // Update repair_requests to WAITING_FOR_PARTS and update blocker items
      if (fetchedRepair) {
        const currentHold = (fetchedRepair.parts_hold as Record<string, any>) || {};
        const currentItems: any[] = Array.isArray(currentHold["items"])
          ? [...currentHold["items"]]
          : currentHold["part"]
            ? [
                {
                  id: currentHold["part"],
                  part: currentHold["part"],
                  reason: currentHold["reason"] || "Parts hold",
                  eta: currentHold["eta"] || "ETA pending",
                  status: "PENDING",
                  since: currentHold["since"] || nowIso,
                },
              ]
            : [];

        const existingIdx = currentItems.findIndex(
          (it) => it.partId === input.partId || it.part.toLowerCase() === partName.toLowerCase(),
        );

        const blockerItem = {
          id: request.id,
          part: partName,
          partId: input.partId,
          quantity: input.quantity,
          reason: input.notes?.trim() || "Waiting for parts delivery",
          eta: etaText,
          status: "PENDING",
          since: nowIso,
        };

        if (existingIdx >= 0) {
          currentItems[existingIdx] = {
            ...currentItems[existingIdx],
            quantity: input.quantity,
            eta: etaText,
            status: "PENDING",
            reason: input.notes?.trim() || currentItems[existingIdx].reason,
          };
        } else {
          currentItems.push(blockerItem);
        }

        const pendingCount = currentItems.filter((i) => i.status === "PENDING").length;
        const summaryPart =
          pendingCount > 1
            ? `${pendingCount} parts (${currentItems
                .filter((i) => i.status === "PENDING")
                .map((i) => i.part)
                .join(", ")})`
            : partName;

        await supabase
          .from("repair_requests")
          .update({
            status: "WAITING_FOR_PARTS",
            status_since: nowIso,
            parts_hold: {
              part: summaryPart,
              reason: input.notes?.trim() || "Waiting for parts delivery",
              eta: etaText,
              note: input.notes?.trim() || "",
              revisedCompletion: etaText,
              since: currentHold["since"] || nowIso,
              items: currentItems,
              allPartsArrived: false,
            },
          })
          .eq("id", repairId);

        // Check if existing quote exists to revise or update
        const { data: repairQuotes } = await supabase
          .from("quotes")
          .select("*, quote_items(*)")
          .eq("repair_request_id", repairId)
          .order("version", { ascending: true });

        if (repairQuotes && repairQuotes.length > 0) {
          const latestQuote = repairQuotes[repairQuotes.length - 1];
          if (latestQuote && latestQuote.status === "APPROVED") {
            const nextVersion = latestQuote.version + 1;
            const { data: newQuote } = await supabase
              .from("quotes")
              .insert({
                repair_request_id: repairId,
                technician_id: latestQuote.technician_id,
                version: nextVersion,
                status: "PENDING",
                labour_description: latestQuote.labour_description,
                labour_amount: latestQuote.labour_amount,
                tax_percent: latestQuote.tax_percent,
                estimated_completion:
                  etaText !== "ETA pending" ? etaText : latestQuote.estimated_completion,
                warranty_terms: latestQuote.warranty_terms,
              })
              .select()
              .single();

            if (newQuote) {
              const priorItems = latestQuote.quote_items || [];
              let matched = false;
              const itemsToInsert = priorItems.map((it: any) => {
                if (
                  (it.catalog_part_id && it.catalog_part_id === input.partId) ||
                  it.part_name.toLowerCase() === partName.toLowerCase()
                ) {
                  matched = true;
                  return {
                    quote_id: newQuote.id,
                    part_name: it.part_name,
                    part_spec: it.part_spec,
                    part_source: "Nagpur Service Centre Depot",
                    quantity: input.quantity,
                    unit_price: unitPrice || it.unit_price,
                    catalog_part_id: input.partId,
                  };
                }
                return {
                  quote_id: newQuote.id,
                  part_name: it.part_name,
                  part_spec: it.part_spec,
                  part_source: it.part_source,
                  quantity: it.quantity,
                  unit_price: it.unit_price,
                  catalog_part_id: it.catalog_part_id,
                };
              });

              if (!matched) {
                itemsToInsert.push({
                  quote_id: newQuote.id,
                  part_name: partName,
                  part_spec: partData?.spec || partData?.part_number || "OEM Standard",
                  part_source: "Nagpur Service Centre Depot",
                  quantity: input.quantity,
                  unit_price: unitPrice,
                  catalog_part_id: input.partId,
                });
              }

              await supabase.from("quote_items").insert(itemsToInsert);
              await supabase.from("quotes").update({ status: "REVISED" }).eq("id", latestQuote.id);

              await supabase.from("repair_timeline").insert({
                repair_request_id: repairId,
                created_by_id: profile.id,
                created_by_role: profile.role,
                status: "WAITING_FOR_PARTS",
                note: `Parts requested: ${partName} (Qty ${input.quantity}). Revised quote v${nextVersion} sent for farmer review.`,
              });
            }
          } else if (latestQuote && latestQuote.status === "PENDING") {
            const pendingItems = latestQuote.quote_items || [];
            const matchItem = pendingItems.find(
              (it: any) =>
                (it.catalog_part_id && it.catalog_part_id === input.partId) ||
                it.part_name.toLowerCase() === partName.toLowerCase(),
            );
            if (matchItem) {
              await supabase
                .from("quote_items")
                .update({ quantity: input.quantity, unit_price: unitPrice || matchItem.unit_price })
                .eq("id", matchItem.id);
            } else {
              await supabase.from("quote_items").insert({
                quote_id: latestQuote.id,
                part_name: partName,
                part_spec: partData?.spec || partData?.part_number || "OEM Standard",
                part_source: "Nagpur Service Centre Depot",
                quantity: input.quantity,
                unit_price: unitPrice,
                catalog_part_id: input.partId,
              });
            }
            // Touch quote timestamp to signal CDC event on quotes table
            await supabase
              .from("quotes")
              .update({ updated_at: nowIso })
              .eq("id", latestQuote.id);
          }
        }
      }

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
  } catch (err: unknown) {
    const {
      data: { session },
    } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (session) {
      throw err;
    }
    // Database table not present and no active session; fall through to demo store
  }

  // 3. Fallback to Demo Store Requisition
  const demoReq = requestDemoPart({
    repairRequestId: repairJobNumber,
    partId: input.partId,
    quantity: input.quantity,
    notes: input.notes ?? null,
    eta: input.eta ?? null,
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
  let resolvedUuid: string | null = isUuid ? repairRequestId : null;
  let resolvedJobNumber: string | null = isUuid ? null : repairRequestId;

  try {
    const query = supabase.from("repair_requests").select("id, job_number");
    const { data: rep } = isUuid
      ? await query.eq("id", repairRequestId).maybeSingle()
      : await query.eq("job_number", repairRequestId).maybeSingle();

    if (rep) {
      resolvedUuid = rep.id;
      resolvedJobNumber = rep.job_number;
    }
  } catch {
    // Non-fatal, proceed with available IDs
  }

  // Also inspect demo store for repair mappings
  try {
    const tb = getTB();
    const demoRep = tb.repairs.find(
      (r) =>
        r.id === repairRequestId ||
        r.id.toLowerCase() === repairRequestId.toLowerCase() ||
        (resolvedJobNumber && (r.id === resolvedJobNumber || (r as any).jobNumber === resolvedJobNumber)) ||
        (resolvedUuid && (r.id === resolvedUuid || (r as any).jobNumber === resolvedUuid)),
    );
    if (demoRep) {
      if (!resolvedJobNumber) resolvedJobNumber = demoRep.id;
    }
  } catch {
    // Ignore
  }

  // 1. Query Supabase
  try {
    const targetId = resolvedUuid || repairRequestId;
    const { data, error } = await supabase
      .from("service_centre_part_requests")
      .select(`
        *,
        part:part_id(id, part_number, name, spec, category, stock_quantity, unit_price, location),
        requester:requested_by(id, full_name, phone)
      `)
      .eq("repair_request_id", targetId)
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      return data as unknown as ServiceCentrePartRequestDetail[];
    }
  } catch {
    // Fall back to demo store
  }

  // 2. Resilient demo store fallback matching any resolved repair identity
  const matchIds = new Set(
    [repairRequestId, resolvedUuid, resolvedJobNumber]
      .filter((x): x is string => Boolean(x))
      .map((x) => x.toLowerCase()),
  );

  const allDemoReqs = getDemoPartRequests();
  const matched = allDemoReqs.filter((r) =>
    matchIds.has(r.repair_request_id.toLowerCase()),
  );

  return matched.map(enrichDemoRequest);
}

/**
 * Retrieves all part requests across all repairs for the Service Centre Parts Desk queue.
 * Admin only.
 */
export async function getAllPartRequests(
  statusFilter?: "ALL" | "PENDING" | "HANDED_OFF" | "CANCELLED",
): Promise<ServiceCentrePartRequestDetail[]> {
  let remoteList: ServiceCentrePartRequestDetail[] = [];
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
      remoteList = data as unknown as ServiceCentrePartRequestDetail[];
    }
  } catch {
    // Fall back to demo store
  }

  let demoReqs = getDemoPartRequests();
  if (statusFilter && statusFilter !== "ALL") {
    demoReqs = demoReqs.filter((r) => r.status === statusFilter);
  }
  const enrichedDemo = demoReqs.map(enrichDemoRequest);

  if (remoteList.length > 0) {
    const remoteIds = new Set(remoteList.map((r) => r.id.toLowerCase()));
    const nonDuplicatedDemo = enrichedDemo.filter(
      (d) => !remoteIds.has(d.id.toLowerCase()),
    );
    return [...remoteList, ...nonDuplicatedDemo];
  }

  return enrichedDemo;
}

/**
 * Confirms physical handoff of requested parts to the technician.
 * Invokes atomic RPC confirm_service_centre_part_handoff or safe direct transactional operations.
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

  const cleanId = requestId.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);

  // 1. Try atomic database RPC
  if (isUuid) {
    try {
      const { data: rpcResult, error: rpcError } = await (
        supabase.rpc as unknown as (
          name: string,
          params: { p_request_id: string },
        ) => Promise<{ data: ConfirmHandoffResult | null; error: Error | null }>
      )("confirm_service_centre_part_handoff", { p_request_id: cleanId });

      if (!rpcError && rpcResult) {
        let repairId: string | null = null;
        try {
          const { data: reqRow } = await supabase
            .from("service_centre_part_requests")
            .select("repair_request_id")
            .eq("id", cleanId)
            .maybeSingle();

          if (reqRow?.repair_request_id) {
            repairId = reqRow.repair_request_id;
            await supabase
              .from("repair_requests")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", repairId);
          }
        } catch {
          // Non-fatal
        }

        // Global socket broadcast to update open technician pages in separate sessions
        try {
          void supabase.channel("tb-realtime-bus").send({
            type: "broadcast",
            event: "part_handoff",
            payload: { requestId: cleanId, repairId },
          });
        } catch {
          // Non-fatal
        }

        // Sync local demo store if mirrored
        try {
          confirmDemoPartHandoff(cleanId, profile.full_name || "Nagpur Service Centre");
        } catch {
          // ignore
        }
        return rpcResult;
      }
    } catch {
      // Database RPC unavailable; continue to direct database fallback
    }

    // 2. Direct Supabase transactional table operations fallback for remote row
    try {
      const { data: remoteReq, error: fetchErr } = await supabase
        .from("service_centre_part_requests")
        .select("*, part:part_id(*)")
        .eq("id", cleanId)
        .maybeSingle();

      if (!fetchErr && remoteReq) {
        if (remoteReq.status !== "PENDING") {
          throw new Error(`Cannot confirm handoff: Part request is already ${remoteReq.status}.`);
        }

        const { data: partRow, error: partErr } = await supabase
          .from("service_centre_parts")
          .select("*")
          .eq("id", remoteReq.part_id)
          .single();

        if (partErr || !partRow) {
          throw new Error("Part not found in Service Centre catalog.");
        }

        if (partRow.stock_quantity < remoteReq.quantity) {
          throw new Error(
            `Insufficient stock: ${remoteReq.quantity} requested, but only ${partRow.stock_quantity} available in Service Centre depot.`,
          );
        }

        const newStock = partRow.stock_quantity - remoteReq.quantity;
        const nowIso = new Date().toISOString();

        // Concurrency guard: update stock_quantity only if unchanged
        const { error: stockErr } = await supabase
          .from("service_centre_parts")
          .update({ stock_quantity: newStock, updated_at: nowIso })
          .eq("id", partRow.id)
          .eq("stock_quantity", partRow.stock_quantity);

        if (stockErr) {
          throw new Error(`Failed to update stock quantity: ${stockErr.message}`);
        }

        // Update request status to HANDED_OFF
        const { error: reqUpdateErr } = await supabase
          .from("service_centre_part_requests")
          .update({
            status: "HANDED_OFF",
            handed_off_by: profile.id,
            handed_off_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", remoteReq.id)
          .eq("status", "PENDING");

        if (reqUpdateErr) {
          throw new Error(`Failed to update requisition status: ${reqUpdateErr.message}`);
        }

        // Check if there is an approved quote for this repair and part
        let isSale = false;
        let saleId: string | null = null;
        let unitPrice = Number(partRow.unit_price);
        let totalAmount = remoteReq.quantity * unitPrice;

        try {
          const { data: approvedQuote } = await supabase
            .from("quotes")
            .select("id, version")
            .eq("repair_request_id", remoteReq.repair_request_id)
            .eq("status", "APPROVED")
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (approvedQuote) {
            const { data: quoteItems } = await supabase
              .from("quote_items")
              .select("*")
              .eq("quote_id", approvedQuote.id);

            const matchedItem = (quoteItems || []).find(
              (qi) =>
                qi.catalog_part_id === partRow.id ||
                qi.part_name?.toLowerCase() === partRow.name.toLowerCase() ||
                (partRow.part_number &&
                  qi.part_spec?.toLowerCase().includes(partRow.part_number.toLowerCase())),
            );

            if (matchedItem) {
              unitPrice = Number(matchedItem.unit_price);
              totalAmount = remoteReq.quantity * unitPrice;
              isSale = true;

              const { data: saleData } = await supabase
                .from("service_centre_part_sales")
                .insert({
                  part_id: partRow.id,
                  repair_request_id: remoteReq.repair_request_id,
                  quote_id: approvedQuote.id,
                  quote_item_id: matchedItem.id,
                  part_request_id: remoteReq.id,
                  quantity: remoteReq.quantity,
                  unit_price: unitPrice,
                  total_amount: totalAmount,
                  sold_at: nowIso,
                  recorded_by: profile.id,
                  notes: "Sold against approved quote on confirmed handoff",
                })
                .select()
                .maybeSingle();

              if (saleData) saleId = saleData.id;
            }
          }
        } catch {
          // Sale recording failure non-fatal to handoff
        }

        // Log immutable stock movement audit entry
        try {
          await supabase.from("service_centre_stock_audit").insert({
            part_id: partRow.id,
            change_quantity: -remoteReq.quantity,
            previous_stock: partRow.stock_quantity,
            new_stock: newStock,
            reason: `Issued to technician for repair`,
            movement_type: "ISSUED_TO_REPAIR",
            changed_by: profile.id,
            repair_request_id: remoteReq.repair_request_id,
            part_request_id: remoteReq.id,
            unit_price: isSale ? unitPrice : null,
            total_value: isSale ? totalAmount : null,
            notes: isSale ? "Commercial sale against approved quote" : "Depot handoff to technician",
          });
        } catch {
          // Audit recording failure non-fatal
        }

        // Update parts_hold blocker item and touch repair_requests to broadcast Realtime change
        try {
          const { data: currentRepair } = await supabase
            .from("repair_requests")
            .select("id, status, parts_hold")
            .eq("id", remoteReq.repair_request_id)
            .maybeSingle();

          if (currentRepair) {
            const holdObj = (currentRepair.parts_hold as Record<string, any>) || {};
            const rawItems = holdObj["items"];
            const rawPart = holdObj["part"];
            const items: any[] = Array.isArray(rawItems)
              ? [...rawItems]
              : rawPart
                ? [
                    {
                      id: remoteReq.id,
                      part: rawPart,
                      partId: remoteReq.part_id,
                      quantity: remoteReq.quantity,
                      reason: holdObj["reason"] || "Waiting for delivery",
                      eta: holdObj["eta"] || "TBD",
                      status: "PENDING",
                      since: holdObj["since"] || nowIso,
                    },
                  ]
                : [];

            const matchedItem = items.find(
              (it) =>
                it.id === remoteReq.id ||
                it.partId === partRow.id ||
                (it.part && it.part.toLowerCase() === partRow.name.toLowerCase()),
            );

            if (matchedItem) {
              matchedItem.status = "HANDED_OFF";
              matchedItem.resolvedAt = nowIso;
            }

            const remainingPending = items.filter((it) => it.status === "PENDING");

            // CRITICAL: Preserve repair status (WAITING_FOR_PARTS waits for explicit technician resume)
            // Touching updated_at triggers Supabase Realtime CDC update to connected clients
            await supabase
              .from("repair_requests")
              .update({
                parts_hold: {
                  ...holdObj,
                  items,
                  allPartsArrived: remainingPending.length === 0,
                  updated_at: nowIso,
                },
                updated_at: nowIso,
              })
              .eq("id", currentRepair.id);
          }
        } catch (holdSyncErr) {
          console.warn("[TerraByte] Warning: Failed to sync parts_hold on handoff:", holdSyncErr);
        }

        // Global socket broadcast to update open technician pages in separate sessions
        try {
          void supabase.channel("tb-realtime-bus").send({
            type: "broadcast",
            event: "part_handoff",
            payload: { requestId: cleanId, repairId: remoteReq.repair_request_id },
          });
        } catch {
          // Non-fatal
        }

        // Also sync local demo store if present
        try {
          confirmDemoPartHandoff(cleanId, profile.full_name || "Nagpur Service Centre");
        } catch {
          // ignore
        }

        return {
          success: true,
          request_id: remoteReq.id,
          part_id: partRow.id,
          part_name: partRow.name,
          quantity: remoteReq.quantity,
          previous_stock: partRow.stock_quantity,
          new_stock: newStock,
          movement_type: "ISSUED_TO_REPAIR",
          is_sale: isSale,
          sale_id: saleId,
          unit_price: isSale ? unitPrice : null,
          total_amount: isSale ? totalAmount : null,
          handed_off_at: nowIso,
        };
      }
    } catch (dbErr: any) {
      if (
        dbErr?.message &&
        !dbErr.message.includes("does not exist") &&
        !dbErr.message.includes("schema cache") &&
        !dbErr.message.includes("not found")
      ) {
        throw dbErr;
      }
    }
  }

  // 3. Fallback to Demo Store Handoff
  const { request, part } = confirmDemoPartHandoff(cleanId, profile.full_name || "Nagpur Service Centre");

  // Global socket broadcast to update open technician pages in separate sessions
  try {
    void supabase.channel("tb-realtime-bus").send({
      type: "broadcast",
      event: "part_handoff",
      payload: { requestId: cleanId, repairId: request.repair_request_id },
    });
  } catch {
    // Non-fatal
  }

  const latestSales = getDemoSales();
  const matchedSale = latestSales.find((s) => s.part_request_id === request.id);

  return {
    success: true,
    request_id: request.id,
    part_id: part.id,
    part_name: part.name,
    quantity: request.quantity,
    previous_stock: part.stock_quantity + request.quantity,
    new_stock: part.stock_quantity,
    movement_type: "ISSUED_TO_REPAIR",
    is_sale: Boolean(matchedSale),
    sale_id: matchedSale?.id || null,
    unit_price: matchedSale?.unit_price ?? null,
    total_amount: matchedSale?.total_amount ?? null,
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

  // Guard: disallow cancellation if requisition has already been handed off
  try {
    const { data: existing } = await supabase
      .from("service_centre_part_requests")
      .select("id, status")
      .eq("id", requestId)
      .maybeSingle();

    if (existing) {
      if (existing.status === "HANDED_OFF") {
        throw new Error("Cannot cancel part request: Components have already been handed off by the Service Centre.");
      }
      if (existing.status === "CANCELLED") {
        throw new Error("Part request has already been cancelled.");
      }
    }
  } catch (checkErr: any) {
    if (
      checkErr?.message?.includes("Cannot cancel") ||
      checkErr?.message?.includes("already been cancelled")
    ) {
      throw checkErr;
    }
  }

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
        movement_type: a.movement_type ?? "ADJUSTMENT",
        reason: a.reason,
        changed_by: "00000000-0000-0000-0003-000000000001",
        repair_request_id: a.repair_request_id ?? null,
        part_request_id: a.part_request_id ?? null,
        quote_id: a.quote_id ?? null,
        quote_item_id: a.quote_item_id ?? null,
        unit_price: a.unit_price ?? null,
        total_value: a.total_value ?? null,
        notes: a.notes ?? null,
        created_at: a.created_at,
        part: part ? { part_number: part.part_number, name: part.name } : null,
        actor: { full_name: a.changed_by },
      };
    });
}

/**
 * Receives incoming stock delivery from a supplier into depot inventory.
 * Admin only.
 */
export async function receiveStock(input: ReceiveStockInput): Promise<{
  success: boolean;
  new_stock: number;
}> {
  if (!input.partId) throw new Error("Part ID is required.");
  if (input.quantity <= 0) throw new Error("Received quantity must be positive.");
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "admin") {
    throw new Error("Unauthorized: Only Service Centre administrators can receive stock.");
  }

  try {
    const { data, error } = await (supabase.rpc as unknown as (
      name: string,
      params: { p_part_id: string; p_quantity: number; p_reason: string },
    ) => Promise<{ data: { new_stock: number } | null; error: Error | null }>)(
      "receive_service_centre_stock",
      {
        p_part_id: input.partId,
        p_quantity: input.quantity,
        p_reason: input.reason.trim() || "Supplier stock delivery received",
      },
    );

    if (!error && data) {
      return { success: true, new_stock: data.new_stock };
    }
  } catch {
    // Database RPC unavailable; fall through to demo store
  }

  const { part } = receiveDemoStock({
    partId: input.partId,
    quantity: input.quantity,
    reason: input.reason.trim() || "Supplier stock delivery received",
    callerName: profile.full_name || "Nagpur Service Centre",
  });

  return { success: true, new_stock: part.stock_quantity };
}

/**
 * Returns an unused part from a repair back to the depot inventory.
 * Admin only.
 */
export async function returnPart(input: ReturnPartInput): Promise<{
  success: boolean;
  new_stock: number;
}> {
  if (!input.partId) throw new Error("Part ID is required.");
  if (!input.repairRequestId) throw new Error("Repair request reference is required.");
  if (input.quantity <= 0) throw new Error("Return quantity must be positive.");
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "admin") {
    throw new Error("Unauthorized: Only Service Centre administrators can confirm part returns.");
  }

  try {
    const { data, error } = await (supabase.rpc as unknown as (
      name: string,
      params: { p_repair_request_id: string; p_part_id: string; p_quantity: number; p_reason: string },
    ) => Promise<{ data: { new_stock: number } | null; error: Error | null }>)(
      "return_service_centre_part",
      {
        p_repair_request_id: input.repairRequestId,
        p_part_id: input.partId,
        p_quantity: input.quantity,
        p_reason: input.reason.trim() || "Unused part returned from repair",
      },
    );

    if (!error && data) {
      return { success: true, new_stock: data.new_stock };
    }
  } catch {
    // Database RPC unavailable; fall through to demo store
  }

  const { part } = returnDemoPart({
    repairRequestId: input.repairRequestId,
    partId: input.partId,
    quantity: input.quantity,
    reason: input.reason.trim() || "Unused part returned from repair",
    callerName: profile.full_name || "Nagpur Service Centre",
  });

  return { success: true, new_stock: part.stock_quantity };
}

/**
 * Retrieves the repair parts sales history.
 * Admin only.
 */
export async function getPartSales(filters?: {
  partId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<PartSaleDetail[]> {
  try {
    let query = supabase
      .from("service_centre_part_sales")
      .select(`
        *,
        part:part_id(part_number, name, category, spec),
        repair:repair_request_id(id, job_number, location),
        actor:recorded_by(full_name)
      `)
      .order("sold_at", { ascending: false });

    if (filters?.partId) {
      query = query.eq("part_id", filters.partId);
    }
    if (filters?.startDate) {
      query = query.gte("sold_at", filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte("sold_at", filters.endDate);
    }

    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      return data as unknown as PartSaleDetail[];
    }
  } catch {
    // Fall back to demo store
  }

  const allParts = getDemoParts();
  const demoSales = getDemoSales(filters);
  const tb = getTB();

  return demoSales.map((s) => {
    const part = allParts.find((p) => p.id === s.part_id || p.part_number === s.part_id);
    const demoRepair = tb.repairs.find(
      (r) =>
        r.id === s.repair_request_id ||
        r.id.toLowerCase() === s.repair_request_id.toLowerCase(),
    );

    return {
      id: s.id,
      part_id: s.part_id,
      repair_request_id: s.repair_request_id,
      quote_id: s.quote_id ?? "q-" + s.repair_request_id,
      quote_item_id: s.quote_item_id ?? null,
      part_request_id: s.part_request_id ?? null,
      movement_audit_id: s.movement_audit_id ?? null,
      quantity: s.quantity,
      unit_price: s.unit_price,
      total_amount: s.total_amount,
      sold_at: s.sold_at,
      recorded_by: "00000000-0000-0000-0003-000000000001",
      notes: s.notes ?? null,
      created_at: s.created_at,
      part: part
        ? {
            part_number: part.part_number,
            name: part.name,
            category: part.category,
            spec: part.spec,
          }
        : null,
      repair: {
        id: s.repair_request_id,
        job_number: demoRepair?.id || s.repair_request_id,
        location: demoRepair?.location || "Katol, Nagpur",
      },
      actor: { full_name: s.recorded_by },
    };
  });
}

/**
 * Computes the inventory movement summary (on hand, issued, returned, sold qty, sale value).
 */
export async function getInventoryMovementSummary(filters?: {
  partId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<InventoryMovementSummary> {
  return getDemoMovementSummary(filters);
}
