import { supabase } from "@/integrations/supabase/client";

export interface TechnicianReview {
  id: string;
  repair_id: string;
  service_history_id: string;
  farmer_profile_id: string;
  technician_profile_id: string;
  facility_id: string | null;
  rating: number; // 1 to 5
  comment: string | null;
  timeliness_rating: number | null; // 1 to 5
  quality_rating: number | null; // 1 to 5
  is_published: boolean;
  created_at: string;
  updated_at: string;
  farmer?: {
    id: string;
    full_name: string | null;
    village: string | null;
  } | null;
}

export interface CreateReviewInput {
  repairId: string;
  serviceHistoryId: string;
  technicianProfileId: string;
  facilityId?: string | null;
  rating: number; // 1 to 5
  comment?: string | null;
  timelinessRating?: number | null; // 1 to 5
  qualityRating?: number | null; // 1 to 5
}

export interface ReviewEligibilityResult {
  isEligible: boolean;
  reason?: string;
  repair?: {
    id: string;
    job_number: string;
    status: string;
    farmer_id: string;
    technician_id: string | null;
  } | null;
  serviceHistory?: {
    id: string;
    service_date?: string;
    operating_hours?: number;
  } | null;
  existingReview?: TechnicianReview | null;
}

export interface TechnicianReviewSummary {
  rating: number | null;
  reviewCount: number;
  averageTimeliness: number | null;
  averageQuality: number | null;
}

/**
 * Detects whether an error indicates the technician_reviews table is missing in the schema cache (Phase 12 Staging).
 */
export function isPhase13ReviewsMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const errObj = error as { code?: string; message?: string };
  const code = errObj.code || "";
  const msg = (errObj.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("technician_reviews") ||
    msg.includes("relation does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
  );
}

/**
 * Validates whether review comments contain leaked phone or identification numbers (6+ continuous digits).
 */
export function detectSensitiveDataInComment(comment: string): boolean {
  return /[0-9]{6,}/.test(comment || "");
}

/**
 * Formats a technician's aggregate rating into a readable string or fallback.
 * Guarantees that null/undefined ratings render "New / Unrated", never 0 or 5.0.
 */
export function formatTechnicianRating(
  rating: number | null | undefined,
  unratedLabel: string = "New / Unrated",
): string {
  if (rating === null || rating === undefined || isNaN(rating)) {
    return unratedLabel;
  }
  return Number(rating).toFixed(1);
}

/**
 * Resolves current authenticated profile id and role.
 */
async function getCurrentUserProfile(): Promise<{ id: string; role: string } | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sessionUser = session?.user;
  if (!sessionUser) return null;

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_session_profile");
    if (!rpcError && rpcData && typeof rpcData === "object" && "id" in rpcData) {
      return {
        id: (rpcData as { id: string }).id,
        role: (rpcData as { role: string }).role || "farmer",
      };
    }
  } catch {
    // Ignore RPC missing error
  }

  // Fallback direct profile query
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("auth_user_id", sessionUser.id)
    .maybeSingle();

  if (profile) {
    return { id: profile.id, role: profile.role || "farmer" };
  }
  return null;
}

/**
 * Authoritative check for whether a farmer is eligible to review a repair ticket.
 *
 * Invariants:
 * 1. Caller must be the farmer who owns the ticket (farmer_id = current_profile_id).
 * 2. Repair request status must be strictly 'COMPLETED'.
 * 3. Repair request must have an assigned technician (technician_id IS NOT NULL).
 * 4. Linked permanent service_history record must exist.
 * 5. Exactly one review per repair: must not have already been reviewed.
 */
export async function checkReviewEligibility(repairId: string): Promise<ReviewEligibilityResult> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairId);

  // 1. Resolve Repair
  const { data: repair, error: repairError } = isUuid
    ? await supabase
        .from("repair_requests")
        .select("id, job_number, status, farmer_id, technician_id")
        .eq("id", repairId)
        .maybeSingle()
    : await supabase
        .from("repair_requests")
        .select("id, job_number, status, farmer_id, technician_id")
        .eq("job_number", repairId)
        .maybeSingle();

  if (repairError || !repair) {
    return {
      isEligible: false,
      reason: "REPAIR_NOT_FOUND",
      repair: null,
    };
  }

  // 2. Caller Authentication & Ownership
  const caller = await getCurrentUserProfile();
  if (!caller) {
    return {
      isEligible: false,
      reason: "NOT_AUTHENTICATED",
      repair,
    };
  }

  if (caller.role !== "admin" && repair.farmer_id !== caller.id) {
    return {
      isEligible: false,
      reason: "NOT_TICKET_OWNER",
      repair,
    };
  }

  // 3. Repair Status Invariant
  if (repair.status !== "COMPLETED") {
    return {
      isEligible: false,
      reason: "REPAIR_NOT_COMPLETED",
      repair,
    };
  }

  // 4. Assigned Technician Invariant
  if (!repair.technician_id) {
    return {
      isEligible: false,
      reason: "NO_TECHNICIAN_ASSIGNED",
      repair,
    };
  }

  // 5. Linked Service History Invariant
  const { data: history, error: historyError } = await supabase
    .from("service_history")
    .select("id, service_date, operating_hours")
    .eq("repair_request_id", repair.id)
    .maybeSingle();

  if (historyError || !history) {
    return {
      isEligible: false,
      reason: "NO_SERVICE_HISTORY",
      repair,
      serviceHistory: null,
    };
  }

  // 6. Existing Review Check (One review per repair)
  const existingReview = await getRepairReview(repair.id).catch(() => null);
  if (existingReview) {
    return {
      isEligible: false,
      reason: "ALREADY_REVIEWED",
      repair,
      serviceHistory: history,
      existingReview,
    };
  }

  return {
    isEligible: true,
    repair,
    serviceHistory: history,
    existingReview: null,
  };
}

/**
 * Fetches the review submitted for a specific repair request, if any.
 */
export async function getRepairReview(repairId: string): Promise<TechnicianReview | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairId);
  let targetRepairId = repairId;

  if (!isUuid) {
    const { data: repair } = await supabase
      .from("repair_requests")
      .select("id")
      .eq("job_number", repairId)
      .maybeSingle();
    if (!repair) return null;
    targetRepairId = repair.id;
  }

  const { data, error } = await supabase
    .from("technician_reviews")
    .select(
      `
      id,
      repair_id,
      service_history_id,
      farmer_profile_id,
      technician_profile_id,
      facility_id,
      rating,
      comment,
      timeliness_rating,
      quality_rating,
      is_published,
      created_at,
      updated_at,
      farmer:farmer_profile_id (
        id,
        full_name,
        village
      )
    `,
    )
    .eq("repair_id", targetRepairId)
    .maybeSingle();

  if (error) {
    if (isPhase13ReviewsMissingError(error)) {
      return null;
    }
    throw new Error(`Failed to load review: ${error.message}`);
  }

  if (!data) return null;

  const raw = data as Record<string, unknown>;
  const farmerData = raw.farmer as {
    id?: string;
    full_name?: string | null;
    village?: string | null;
  } | null;

  return {
    id: raw.id as string,
    repair_id: raw.repair_id as string,
    service_history_id: raw.service_history_id as string,
    farmer_profile_id: raw.farmer_profile_id as string,
    technician_profile_id: raw.technician_profile_id as string,
    facility_id: (raw.facility_id as string) || null,
    rating: Number(raw.rating),
    comment: (raw.comment as string) || null,
    timeliness_rating: raw.timeliness_rating != null ? Number(raw.timeliness_rating) : null,
    quality_rating: raw.quality_rating != null ? Number(raw.quality_rating) : null,
    is_published: Boolean(raw.is_published),
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
    farmer: farmerData
      ? {
          id: farmerData.id || (raw.farmer_profile_id as string),
          full_name: farmerData.full_name || "Verified Farmer",
          village: farmerData.village || null,
        }
      : null,
  };
}

/**
 * Submits a verified review for a completed repair.
 * Enforces client and server validation: rating bounds 1..5, anti-PII remarks, ownership, and service history.
 */
export async function submitTechnicianReview(input: CreateReviewInput): Promise<TechnicianReview> {
  // 1. Rating Range Invariant (1 to 5 integer)
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new Error("INVALID_RATING: Overall rating must be an integer between 1 and 5 stars.");
  }

  // 2. Sub-metric Invariants
  if (
    input.timelinessRating != null &&
    (!Number.isInteger(input.timelinessRating) ||
      input.timelinessRating < 1 ||
      input.timelinessRating > 5)
  ) {
    throw new Error("INVALID_TIMELINESS_RATING: Timeliness rating must be between 1 and 5.");
  }

  if (
    input.qualityRating != null &&
    (!Number.isInteger(input.qualityRating) || input.qualityRating < 1 || input.qualityRating > 5)
  ) {
    throw new Error("INVALID_QUALITY_RATING: Quality rating must be between 1 and 5.");
  }

  // 3. Anti-PII Guard on Comment (No 6+ consecutive digits)
  const trimmedComment = (input.comment || "").trim();
  if (detectSensitiveDataInComment(trimmedComment)) {
    throw new Error(
      "SENSITIVE_DATA_DETECTED: Review comment must not contain private phone numbers or government identity digits.",
    );
  }

  // 4. Verify Eligibility
  const eligibility = await checkReviewEligibility(input.repairId);
  if (!eligibility.isEligible) {
    switch (eligibility.reason) {
      case "ALREADY_REVIEWED":
        throw new Error("ALREADY_REVIEWED: A review has already been submitted for this repair.");
      case "REPAIR_NOT_COMPLETED":
        throw new Error("INELIGIBLE_REPAIR: Reviews can only be submitted for completed repairs.");
      case "NO_SERVICE_HISTORY":
        throw new Error(
          "SERVICE_HISTORY_REQUIRED: A permanent service history record is required before submitting a review.",
        );
      case "NOT_TICKET_OWNER":
        throw new Error(
          "UNAUTHORIZED: Only the farmer who owns this repair ticket can submit a review.",
        );
      default:
        throw new Error(
          `INELIGIBLE_REVIEW: ${eligibility.reason || "Review requirements not met."}`,
        );
    }
  }

  const caller = await getCurrentUserProfile();
  if (!caller) {
    throw new Error("UNAUTHORIZED: You must be logged in to submit a review.");
  }

  const targetRepairId = eligibility.repair!.id;
  const targetHistoryId = eligibility.serviceHistory!.id;
  const targetTechnicianId = eligibility.repair!.technician_id!;

  // 5. Insert directly into public.technician_reviews
  // Protected by RLS WITH CHECK, DB CHECK constraints, and unique constraint on repair_id.
  // Triggers trg_recalculate_technician_rating automatically.
  const { data, error } = await supabase
    .from("technician_reviews")
    .insert({
      repair_id: targetRepairId,
      service_history_id: targetHistoryId,
      farmer_profile_id: caller.id,
      technician_profile_id: targetTechnicianId,
      facility_id: input.facilityId || null,
      rating: input.rating,
      comment: trimmedComment || null,
      timeliness_rating: input.timelinessRating || null,
      quality_rating: input.qualityRating || null,
      is_published: true,
    })
    .select(
      `
      id,
      repair_id,
      service_history_id,
      farmer_profile_id,
      technician_profile_id,
      facility_id,
      rating,
      comment,
      timeliness_rating,
      quality_rating,
      is_published,
      created_at,
      updated_at
    `,
    )
    .single();

  if (error) {
    if (isPhase13ReviewsMissingError(error)) {
      throw new Error(
        "Verified reviews require the Phase 13 database migration, which is pending approval for this environment.",
      );
    }
    if (error.code === "23505") {
      throw new Error("ALREADY_REVIEWED: A review has already been submitted for this repair.");
    }
    if (error.code === "23514") {
      throw new Error("INVALID_RATING: Rating values must be between 1 and 5.");
    }
    if (error.code === "42501") {
      throw new Error(
        "UNAUTHORIZED: Only the farmer who owns this completed repair can submit a review.",
      );
    }
    throw new Error(`Failed to submit review: ${error.message}`);
  }

  return {
    ...data,
    farmer: {
      id: caller.id,
      full_name: null,
      village: null,
    },
  };
}

/**
 * Fetches published reviews for a technician profile across Vidarbha.
 */
export async function getTechnicianReviews(
  technicianProfileId: string,
): Promise<TechnicianReview[]> {
  const { data, error } = await supabase
    .from("technician_reviews")
    .select(
      `
      id,
      repair_id,
      service_history_id,
      farmer_profile_id,
      technician_profile_id,
      facility_id,
      rating,
      comment,
      timeliness_rating,
      quality_rating,
      is_published,
      created_at,
      updated_at,
      farmer:farmer_profile_id (
        id,
        full_name,
        village
      )
    `,
    )
    .eq("technician_profile_id", technicianProfileId)
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (error) {
    if (isPhase13ReviewsMissingError(error)) {
      return [];
    }
    throw new Error(`Failed to load technician reviews: ${error.message}`);
  }

  return ((data as unknown as Array<Record<string, unknown>>) || []).map((raw) => {
    const farmerData = raw.farmer as {
      id?: string;
      full_name?: string | null;
      village?: string | null;
    } | null;
    return {
      id: raw.id as string,
      repair_id: raw.repair_id as string,
      service_history_id: raw.service_history_id as string,
      farmer_profile_id: raw.farmer_profile_id as string,
      technician_profile_id: raw.technician_profile_id as string,
      facility_id: (raw.facility_id as string) || null,
      rating: Number(raw.rating),
      comment: (raw.comment as string) || null,
      timeliness_rating: raw.timeliness_rating != null ? Number(raw.timeliness_rating) : null,
      quality_rating: raw.quality_rating != null ? Number(raw.quality_rating) : null,
      is_published: Boolean(raw.is_published),
      created_at: raw.created_at as string,
      updated_at: raw.updated_at as string,
      farmer: farmerData
        ? {
            id: farmerData.id || (raw.farmer_profile_id as string),
            full_name: farmerData.full_name || "Verified Farmer",
            village: farmerData.village || null,
          }
        : null,
    };
  });
}
