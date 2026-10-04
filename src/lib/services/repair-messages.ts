import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createNotification } from "./notifications";

export type RepairMessageRow = Database["public"]["Tables"]["repair_messages"]["Row"];
export type RepairMessageInsert = Database["public"]["Tables"]["repair_messages"]["Insert"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export interface RepairMessageWithParticipants extends RepairMessageRow {
  sender?: Pick<ProfileRow, "id" | "full_name" | "role" | "phone"> | null;
  recipient?: Pick<ProfileRow, "id" | "full_name" | "role" | "phone"> | null;
}

export interface SendMessageInput {
  repair_request_id: string;
  recipient_id: string;
  message_text: string;
}

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Resolves the authenticated user's profile ID and role.
 * Ensures caller identity is verified against Supabase Auth.
 */
async function getAuthenticatedProfile(): Promise<{ id: string; role: string }> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentication required: Please sign in to access repair messages.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error("User profile not found. Please ensure your profile is initialized.");
  }

  return profile;
}

/**
 * Resolves a repair request ID whether given as a UUID or a job_number (e.g. TB-4489).
 */
async function resolveRepairRequestId(idOrJobNumber: string): Promise<string> {
  const trimmed = idOrJobNumber.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
  if (isUuid) return trimmed;

  const { data: repair, error } = await supabase
    .from("repair_requests")
    .select("id")
    .ilike("job_number", trimmed)
    .maybeSingle();

  if (error || !repair) {
    throw new Error(`Repair ticket "${trimmed}" not found or inaccessible.`);
  }

  return repair.id;
}

/**
 * Fetches all ticket-scoped messages for a repair request in chronological order.
 * Protected by PostgreSQL RLS: Only authorized participants (farmer, assigned technician, admin)
 * can access messages for the ticket.
 */
export async function getRepairMessages(
  repairRequestId: string
): Promise<RepairMessageWithParticipants[]> {
  if (!repairRequestId?.trim()) {
    throw new Error("Repair request ID is required.");
  }

  await getAuthenticatedProfile();
  const resolvedId = await resolveRepairRequestId(repairRequestId);

  const { data, error } = await supabase
    .from("repair_messages")
    .select(
      "*, sender:sender_id(id, full_name, role, phone), recipient:recipient_id(id, full_name, role, phone)"
    )
    .eq("repair_request_id", resolvedId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load repair messages: ${error.message}`);
  }

  return (data as unknown as RepairMessageWithParticipants[]) ?? [];
}

/**
 * Sends a validated ticket-scoped message between authorized repair counterparts.
 * Validates:
 * - Sender is the authenticated profile (anti-spoofing)
 * - Sender cannot message themselves
 * - Sender is an authorized ticket participant (farmer, assigned technician, or admin)
 * - Recipient is an authorized counterpart on this ticket
 * - Message text is non-empty and bounded (1-2000 chars)
 * Dispatches counterpart notification upon successful insertion.
 */
export async function sendRepairMessage(
  input: SendMessageInput
): Promise<RepairMessageWithParticipants> {
  const profile = await getAuthenticatedProfile();

  if (!input.repair_request_id?.trim()) {
    throw new Error("Repair request ID is required.");
  }

  if (!input.recipient_id?.trim()) {
    throw new Error("Recipient ID is required.");
  }

  const trimmedText = input.message_text?.trim();
  if (!trimmedText) {
    throw new Error("Message text cannot be empty.");
  }

  if (trimmedText.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message text cannot exceed ${MAX_MESSAGE_LENGTH} characters.`);
  }

  const resolvedRepairId = await resolveRepairRequestId(input.repair_request_id);

  if (profile.id === input.recipient_id) {
    throw new Error("Invalid recipient: You cannot send a message to yourself.");
  }

  // Fetch ticket details to validate participant authorization
  const { data: repair, error: repairError } = await supabase
    .from("repair_requests")
    .select("id, job_number, farmer_id, technician_id")
    .eq("id", resolvedRepairId)
    .maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair ticket not found or inaccessible.");
  }

  const isFarmer = repair.farmer_id === profile.id;
  const isTechnician = repair.technician_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isFarmer && !isTechnician && !isAdmin) {
    throw new Error("Unauthorized: You are not an authorized participant on this repair ticket.");
  }

  // Validate counterpart relationship
  const targetRecipientId = input.recipient_id.trim();
  if (isFarmer) {
    // Farmer can message assigned technician or admin
    const isTargetTech = repair.technician_id === targetRecipientId;
    if (!isTargetTech) {
      const { data: recipientProfile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", targetRecipientId)
        .maybeSingle();

      if (recipientProfile?.role !== "admin") {
        throw new Error("Invalid recipient: Farmers may only message their assigned technician or the Service Centre.");
      }
    }
  } else if (isTechnician) {
    // Technician can message ticket farmer or admin
    const isTargetFarmer = repair.farmer_id === targetRecipientId;
    if (!isTargetFarmer) {
      const { data: recipientProfile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", targetRecipientId)
        .maybeSingle();

      if (recipientProfile?.role !== "admin") {
        throw new Error("Invalid recipient: Technicians may only message the ticket farmer or the Service Centre.");
      }
    }
  }

  // Perform database insert (enforces database-level RLS policies)
  const { data: insertedMessage, error: insertError } = await supabase
    .from("repair_messages")
    .insert({
      repair_request_id: resolvedRepairId,
      sender_id: profile.id,
      recipient_id: targetRecipientId,
      message_text: trimmedText,
      is_read: false,
    })
    .select(
      "*, sender:sender_id(id, full_name, role, phone), recipient:recipient_id(id, full_name, role, phone)"
    )
    .single();

  if (insertError || !insertedMessage) {
    throw new Error(`Failed to send repair message: ${insertError?.message}`);
  }

  // Dispatch counterpart notification (safely handled, does not fail message creation)
  try {
    const textPreview = trimmedText.length > 50 ? `${trimmedText.slice(0, 47)}…` : trimmedText;

    if (isFarmer) {
      // Notify technician
      await createNotification({
        recipient_role: "technician",
        recipient_user_id: targetRecipientId,
        notification_text: `New message on ${repair.job_number}: "${textPreview}"`,
        link_target: `/technician/job/${repair.id}`,
      });
    } else if (isTechnician) {
      // Notify farmer
      await createNotification({
        recipient_role: "farmer",
        recipient_user_id: targetRecipientId,
        notification_text: `New message on ${repair.job_number}: "${textPreview}"`,
        link_target: `/farmer/repair/${repair.id}`,
      });
    } else if (isAdmin) {
      // Admin messaging participant
      const { data: recProf } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", targetRecipientId)
        .maybeSingle();

      const targetRole = recProf?.role === "technician" ? "technician" : "farmer";
      await createNotification({
        recipient_role: targetRole,
        recipient_user_id: targetRecipientId,
        notification_text: `Service Centre message on ${repair.job_number}: "${textPreview}"`,
        link_target: targetRole === "technician" ? `/technician/job/${repair.id}` : `/farmer/repair/${repair.id}`,
      });
    }
  } catch (notifErr) {
    console.warn("[TerraByte Messages] Warning: Failed to dispatch notification for repair message:", notifErr);
  }

  return insertedMessage as unknown as RepairMessageWithParticipants;
}

/**
 * Marks messages addressed to the authenticated caller on a repair request as read.
 * Hardened by database RLS and column-level privileges: Caller can ONLY update `is_read`
 * on rows where `recipient_id = caller.id`.
 */
export async function markMessagesAsRead(
  repairRequestId: string,
  messageIds?: string[]
): Promise<number> {
  const profile = await getAuthenticatedProfile();
  const resolvedRepairId = await resolveRepairRequestId(repairRequestId);

  let query = supabase
    .from("repair_messages")
    .update({ is_read: true })
    .eq("repair_request_id", resolvedRepairId)
    .eq("recipient_id", profile.id)
    .eq("is_read", false);

  if (messageIds && messageIds.length > 0) {
    query = query.in("id", messageIds);
  }

  const { data, error } = await query.select("id");

  if (error) {
    throw new Error(`Failed to mark messages as read: ${error.message}`);
  }

  return data?.length ?? 0;
}

/**
 * Counts unread messages for the authenticated user, optionally scoped to a single repair request.
 * Utilizes the partial index `idx_repair_messages_unread` for fast evaluation.
 */
export async function getUnreadMessageCount(repairRequestId?: string): Promise<number> {
  const profile = await getAuthenticatedProfile();

  let query = supabase
    .from("repair_messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", profile.id)
    .eq("is_read", false);

  if (repairRequestId) {
    const resolvedRepairId = await resolveRepairRequestId(repairRequestId);
    query = query.eq("repair_request_id", resolvedRepairId);
  }

  const { count, error } = await query;

  if (error) {
    console.warn("[TerraByte Messages] Warning: Failed to count unread messages:", error.message);
    return 0;
  }

  return count ?? 0;
}
