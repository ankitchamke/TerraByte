import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
export type UserRole = Database["public"]["Enums"]["user_role"];

export interface CreateNotificationInput {
  recipient_role: UserRole;
  recipient_user_id?: string | null;
  notification_text: string;
  link_target?: string | null;
}

export interface GetNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
}
let cachedProfile: { auth_user_id: string; id: string; role: string; expiresAt: number } | null = null;

/**
 * Resolves the authenticated user's profile ID and role.
 * Uses cached profile / active session when available to prevent waterfall latency.
 */
async function getAuthenticatedProfile(): Promise<{ id: string; role: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sessionUser = session?.user;

  if (sessionUser && cachedProfile && cachedProfile.auth_user_id === sessionUser.id && Date.now() < cachedProfile.expiresAt) {
    return { id: cachedProfile.id, role: cachedProfile.role };
  }

  const user = sessionUser || (await supabase.auth.getUser()).data.user;

  if (!user) {
    throw new Error("Authentication required: Please sign in to access notifications.");
  }

  if (cachedProfile && cachedProfile.auth_user_id === user.id && Date.now() < cachedProfile.expiresAt) {
    return { id: cachedProfile.id, role: cachedProfile.role };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error("User profile not found. Please ensure your profile is initialized.");
  }

  cachedProfile = {
    auth_user_id: user.id,
    id: profile.id,
    role: profile.role,
    expiresAt: Date.now() + 60_000,
  };

  return profile;
}

/**
 * Creates and dispatches a persistent notification to a recipient user or role.
 * Caller must be authenticated.
 * Safe for cross-user notification delivery without violating RLS SELECT policies.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const trimmedText = input.notification_text?.trim();
  if (!trimmedText) {
    throw new Error("Notification text is required.");
  }

  if (!input.recipient_role) {
    throw new Error("Recipient role is required.");
  }

  const { error } = await supabase.from("notifications").insert({
    recipient_role: input.recipient_role,
    recipient_user_id: input.recipient_user_id || null,
    notification_text: trimmedText,
    link_target: input.link_target || null,
    is_read: false,
  });

  if (error) {
    console.warn(`[TerraByte Notifications] Failed to dispatch notification: ${error.message}`);
    throw new Error(`Failed to create notification: ${error.message}`);
  }
}

/**
 * Determines whether a notification qualifies as an actionable operational event
 * for Service Centre (admin) attention.
 * Strictly excludes normal Farmer <-> Technician workflow chatter/activity.
 */
export function isActionableServiceCentreNotification(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();

  // Chatter patterns that must NEVER appear in Service Centre notifications
  const chatterPatterns = [
    "accepted repair",
    "technician accepted",
    "quote ready",
    "revised quote",
    "requested changes to quote",
    "requested quote revision",
    "approved quote",
    "quote approved",
    "started repair",
    "repair started",
    "work note",
    "parts received",
    "has resumed",
    "is delayed while waiting for spare parts",
    "spare part eta updated",
    "now being tested",
    "testing found an issue",
    "remedial work complete",
    "ready for handover",
    "handover confirmation",
    "confirmed handover",
    "saved to service history",
    "signed off",
  ];
  for (const pattern of chatterPatterns) {
    if (t.includes(pattern)) return false;
  }

  // Actionable operational patterns for Service Centre
  const operationalPatterns = [
    "breakdown reported",
    "new breakdown",
    "declined by technician",
    "needs reassignment",
    "clarification requested",
    "requested service centre",
    "intervention",
    "cancellation",
    "cancelled",
    "unassigned",
    "exception",
    "quote rejected by farmer",
    "rejected by farmer",
    "new technician registration",
    "technician registration",
    "pending verification",
  ];
  return operationalPatterns.some((pattern) => t.includes(pattern));
}

export type NotificationCategory =
  | "Breakdown"
  | "Quote"
  | "Parts"
  | "Testing"
  | "Repair"
  | "Account"
  | "Assignment"
  | "Alert"
  | "Notice";

/**
 * Derives a human-readable operational category for a notification based on its content.
 * Used for visual pill badging and semantic icons in the notification bell popover.
 */
export function getNotificationCategory(text: string): NotificationCategory {
  if (!text) return "Notice";
  const t = text.toLowerCase();
  if (t.includes("breakdown")) return "Breakdown";
  if (t.includes("quote")) return "Quote";
  if (t.includes("spare part") || t.includes("parts") || t.includes("eta")) return "Parts";
  if (t.includes("testing") || t.includes("tested")) return "Testing";
  if (
    t.includes("approved by the service centre") ||
    t.includes("technician registration") ||
    t.includes("technician account") ||
    t.includes("verification")
  ) {
    return "Account";
  }
  if (t.includes("assigned")) return "Assignment";
  if (t.includes("cancelled") || t.includes("cancellation") || t.includes("declined") || t.includes("rejected")) return "Alert";
  if (
    t.includes("repair") ||
    t.includes("resumed") ||
    t.includes("started repair") ||
    t.includes("completed") ||
    t.includes("service history")
  ) {
    return "Repair";
  }
  return "Notice";
}

/**
 * Fetches notifications for the currently authenticated caller.
 * RLS enforces that users only see notifications targeted to their profile or broadcast to their role.
 * Ordered newest first.
 * For Service Centre (admin), filters down to actionable operational events only.
 */
export async function getNotificationsForCurrentUser(
  options?: GetNotificationsOptions
): Promise<NotificationRow[]> {
  const profile = await getAuthenticatedProfile();

  let query = supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });

  // Strictly filter notifications intended for the current user/role
  query = query.or(
    `recipient_user_id.eq.${profile.id},and(recipient_user_id.is.null,recipient_role.eq.${profile.role})`
  );

  if (options?.unreadOnly) {
    query = query.eq("is_read", false);
  }

  // For non-admin, apply limit directly in SQL query
  if (options?.limit && options.limit > 0 && profile.role !== "admin") {
    query = query.limit(options.limit);
  } else if (options?.limit && options.limit > 0 && profile.role === "admin") {
    // For admin, bound query safely to allow chatter filtering without unbounded scans
    query = query.limit(Math.max(options.limit * 4, 100));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch notifications: ${error.message}`);
  }

  let result = data || [];

  // For Service Centre / admin, strictly filter to actionable operational events
  if (profile.role === "admin") {
    result = result.filter((n) => isActionableServiceCentreNotification(n.notification_text));
    if (options?.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }
  }

  return result;
}

/**
 * Marks a specific notification as read.
 * Caller must be the recipient or an admin.
 */
export async function markNotificationAsRead(notificationId: string): Promise<NotificationRow> {
  if (!notificationId) throw new Error("Notification ID is required.");
  await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to mark notification as read: ${error?.message}`);
  }

  return data;
}

/**
 * Marks all notifications for the current user as read.
 * For Service Centre (admin), only marks filtered actionable operational notifications.
 */
export async function markAllNotificationsAsRead(): Promise<void> {
  const profile = await getAuthenticatedProfile();

  if (profile.role === "admin") {
    const unread = await getNotificationsForCurrentUser({ unreadOnly: true });
    const ids = unread.map((n) => n.id);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("id", ids);

    if (error) {
      throw new Error(`Failed to mark notifications as read: ${error.message}`);
    }
    return;
  }

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("is_read", false)
    .or(
      `recipient_user_id.eq.${profile.id},and(recipient_user_id.is.null,recipient_role.eq.${profile.role})`
    );

  if (error) {
    throw new Error(`Failed to mark notifications as read: ${error.message}`);
  }
}

/**
 * Gets the total count of unread notifications for the currently authenticated user.
 * For Service Centre (admin), only counts unread actionable operational notifications.
 */
export async function getUnreadNotificationCount(): Promise<number> {
  const profile = await getAuthenticatedProfile();

  if (profile.role === "admin") {
    const notifications = await getNotificationsForCurrentUser({ unreadOnly: true });
    return notifications.length;
  }

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("is_read", false)
    .or(
      `recipient_user_id.eq.${profile.id},and(recipient_user_id.is.null,recipient_role.eq.${profile.role})`
    );

  if (error) {
    throw new Error(`Failed to get unread notification count: ${error.message}`);
  }

  return count || 0;
}
