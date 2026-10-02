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
    throw new Error("Authentication required: Please sign in to access notifications.");
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
 * Fetches notifications for the currently authenticated caller.
 * RLS enforces that users only see notifications targeted to their profile or broadcast to their role.
 * Ordered newest first.
 */
export async function getNotificationsForCurrentUser(
  options?: GetNotificationsOptions
): Promise<NotificationRow[]> {
  await getAuthenticatedProfile();

  let query = supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });

  if (options?.unreadOnly) {
    query = query.eq("is_read", false);
  }

  if (options?.limit && options.limit > 0) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch notifications: ${error.message}`);
  }

  return data || [];
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
 */
export async function markAllNotificationsAsRead(): Promise<void> {
  const profile = await getAuthenticatedProfile();

  let query = supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("is_read", false);

  if (profile.role !== "admin") {
    query = query.or(
      `recipient_user_id.eq.${profile.id},and(recipient_user_id.is.null,recipient_role.eq.${profile.role})`
    );
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to mark notifications as read: ${error.message}`);
  }
}

/**
 * Gets the total count of unread notifications for the currently authenticated user.
 */
export async function getUnreadNotificationCount(): Promise<number> {
  await getAuthenticatedProfile();

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("is_read", false);

  if (error) {
    throw new Error(`Failed to get unread notification count: ${error.message}`);
  }

  return count || 0;
}
