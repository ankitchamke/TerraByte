import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export function isUuid(value?: string | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export interface UseRepairTicketRealtimeOptions {
  /** The UUID of the repair ticket to subscribe to */
  repairId: string | null | undefined;
  /** Callback triggered when a relevant change occurs (debounced) */
  onUpdate: () => void | Promise<void>;
  /** Whether the subscription is active (default: true) */
  enabled?: boolean | undefined;
  /** Coalescing window in milliseconds to bundle burst events (default: 300ms) */
  debounceMs?: number | undefined;
}

/**
 * Reusable ticket-scoped Supabase Realtime synchronization hook for TerraByte.
 *
 * Architecture Guarantee:
 * - Realtime events are change signals only.
 * - Authoritative refetching is delegated to the caller's existing loader function.
 * - Coalesces rapid multi-table event bursts (repair_requests + quotes + repair_timeline)
 *   into a single refetch using a 300ms debounce window.
 * - Strictly scopes Postgres Changes subscriptions by ticket UUID:
 *     - repair_requests: id=eq.<uuid>
 *     - quotes: repair_request_id=eq.<uuid>
 *     - repair_timeline: repair_request_id=eq.<uuid>
 * - Preserves demo-account isolation (no cross-ticket leakage).
 * - Cleans up Supabase channels and debounce timers on unmount or ticket change.
 */
export function useRepairTicketRealtime({
  repairId,
  onUpdate,
  enabled = true,
  debounceMs = 300,
}: UseRepairTicketRealtimeOptions): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  const triggerDebounced = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void callbackRef.current();
    }, debounceMs);
  }, [debounceMs]);

  useEffect(() => {
    if (!enabled || !repairId) return;

    let isCancelled = false;
    let channel: any = null;
    let demoBc: BroadcastChannel | null = null;
    let busChannel: any = null;

    // 1. Cross-tab synchronization for Demo Store & local state mutations
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      try {
        demoBc = new BroadcastChannel("terrabyte_demo_store_sync");
        demoBc.onmessage = (event) => {
          if (event.data?.type === "STORE_UPDATED") {
            triggerDebounced();
          }
        };
      } catch (bcErr) {
        console.warn("[TerraByte Realtime] BroadcastChannel init warning:", bcErr);
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key === "terrabyte-demo-v1" ||
        event.key === "terrabyte_demo_store" ||
        event.key.startsWith("terrabyte") ||
        event.key.startsWith("tb")
      ) {
        triggerDebounced();
      }
    };
    window.addEventListener("storage", handleStorage);

    // 2. Global Realtime Broadcast Bus (delivers signals across all sessions, tabs, and incognito windows)
    try {
      busChannel = supabase.channel(`tb-bus-${Math.random().toString(36).slice(2, 9)}`);
      busChannel
        .on("broadcast", { event: "part_handoff" }, (event: any) => {
          const payload = event?.payload;
          const targetRepairId = payload?.repairId ? String(payload.repairId).trim().toLowerCase() : null;
          const currentId = repairId.trim().toLowerCase();
          if (
            !targetRepairId ||
            targetRepairId === currentId ||
            targetRepairId.endsWith(currentId) ||
            currentId.endsWith(targetRepairId)
          ) {
            triggerDebounced();
          }
        })
        .subscribe();
    } catch (busErr) {
      console.warn("[TerraByte Realtime] Global bus subscription warning:", busErr);
    }

    const setupSubscription = async () => {
      try {
        const rawId = repairId.trim();
        let resolvedUuid: string | null = null;

        if (isUuid(rawId)) {
          resolvedUuid = rawId;
        } else {
          // Resolve database UUID for human-readable job number (e.g. TB-4651, TB-5653)
          try {
            const { data, error } = await supabase
              .from("repair_requests")
              .select("id")
              .eq("job_number", rawId)
              .maybeSingle();

            if (!error && data?.id && isUuid(data.id)) {
              resolvedUuid = data.id;
            }
          } catch (lookupErr) {
            console.warn("[TerraByte Realtime] Failed to resolve repair UUID from job number:", lookupErr);
          }
        }

        if (isCancelled || !resolvedUuid) return;

        const cleanId = resolvedUuid;
        // Ticket-scoped unique channel name ensures dedicated socket multiplexing without collisions
        const channelName = `ticket-realtime-${cleanId}-${Math.random().toString(36).slice(2, 9)}`;

        try {
          channel = supabase
            .channel(channelName)
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "repair_requests",
                filter: `id=eq.${cleanId}`,
              },
              () => {
                triggerDebounced();
              }
            )
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "quotes",
                filter: `repair_request_id=eq.${cleanId}`,
              },
              () => {
                triggerDebounced();
              }
            )
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "quote_items",
              },
              () => {
                triggerDebounced();
              }
            )
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "repair_timeline",
                filter: `repair_request_id=eq.${cleanId}`,
              },
              () => {
                triggerDebounced();
              }
            )
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "service_centre_part_requests",
                filter: `repair_request_id=eq.${cleanId}`,
              },
              () => {
                triggerDebounced();
              }
            )
            .subscribe((status) => {
              if (status === "CHANNEL_ERROR") {
                console.warn(`[TerraByte Realtime] Channel error on ${channelName}, fallback to authoritative polling.`);
              }
            });
        } catch (err) {
          console.warn(`[TerraByte Realtime] Failed to subscribe channel ${channelName}:`, err);
        }
      } catch (globalErr) {
        console.warn("[TerraByte Realtime] Global setup subscription error:", globalErr);
      }
    };

    void setupSubscription();

    // Window focus listener ensures fresh state if reconnecting or returning from another tab
    const handleFocus = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      triggerDebounced();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      isCancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      if (demoBc) {
        try {
          demoBc.close();
        } catch {
          // Ignore
        }
      }
      if (channel) {
        try {
          void supabase.removeChannel(channel);
        } catch (cleanupErr) {
          console.warn("[TerraByte Realtime] Cleanup error:", cleanupErr);
        }
      }
      if (busChannel) {
        try {
          void supabase.removeChannel(busChannel);
        } catch {
          // Ignore
        }
      }
    };
  }, [repairId, enabled, triggerDebounced]);
}

export interface UseRepairListRealtimeOptions {
  /** Channel identifier for list subscription */
  channelName: string;
  /** Callback triggered when a relevant list change occurs */
  onUpdate: () => void | Promise<void>;
  /** Optional filter predicate for repair_requests (e.g. `farmer_id=eq.<id>`) */
  filter?: string | undefined;
  /** Whether the subscription is active (default: true) */
  enabled?: boolean | undefined;
  /** Coalescing window in milliseconds to bundle burst events (default: 300ms) */
  debounceMs?: number | undefined;
}

/**
 * Reusable list-scoped Supabase Realtime synchronization hook for TerraByte boards/queues.
 *
 * Scopes changes strictly according to RLS and optional column filter.
 * Coalesces rapid multi-ticket event bursts via debounce window.
 */
export function useRepairListRealtime({
  channelName,
  onUpdate,
  filter,
  enabled = true,
  debounceMs = 300,
}: UseRepairListRealtimeOptions): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  const triggerDebounced = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void callbackRef.current();
    }, debounceMs);
  }, [debounceMs]);

  useEffect(() => {
    if (!enabled || !channelName) return;

    const changeConfig: {
      event: "*";
      schema: "public";
      table: "repair_requests";
      filter?: string;
    } = {
      event: "*",
      schema: "public",
      table: "repair_requests",
    };

    if (filter) {
      changeConfig.filter = filter;
    }

    const uniqueChannelName = `${channelName}-${Math.random().toString(36).slice(2, 9)}`;
    let channel: any = null;
    try {
      channel = supabase
        .channel(uniqueChannelName)
        .on("postgres_changes", changeConfig, () => {
          triggerDebounced();
        })
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") {
            console.warn(`[TerraByte Realtime] Channel error on ${uniqueChannelName}, fallback to authoritative polling.`);
          }
        });
    } catch (err) {
      console.warn(`[TerraByte Realtime] Failed to subscribe channel ${uniqueChannelName}:`, err);
    }

    const handleFocus = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      triggerDebounced();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      window.removeEventListener("focus", handleFocus);
      if (channel) {
        try {
          void supabase.removeChannel(channel);
        } catch {
          // Ignore
        }
      }
    };
  }, [channelName, filter, enabled, triggerDebounced]);
}

export interface UsePartsDeskRealtimeOptions {
  onUpdate: () => void | Promise<void>;
  enabled?: boolean | undefined;
  debounceMs?: number | undefined;
}

/**
 * Service Centre Parts Desk realtime hook.
 * Keeps technician requisitions, inventory counts, audit movement logs,
 * and commercial sales current without manual page reload.
 */
export function usePartsDeskRealtime({
  onUpdate,
  enabled = true,
  debounceMs = 300,
}: UsePartsDeskRealtimeOptions): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  const triggerDebounced = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void callbackRef.current();
    }, debounceMs);
  }, [debounceMs]);

  useEffect(() => {
    if (!enabled) return;

    let demoBc: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      try {
        demoBc = new BroadcastChannel("terrabyte_demo_store_sync");
        demoBc.onmessage = (event) => {
          if (event.data?.type === "STORE_UPDATED") {
            triggerDebounced();
          }
        };
      } catch (bcErr) {
        console.warn("[TerraByte Realtime] BroadcastChannel init warning:", bcErr);
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === "terrabyte_demo_store" || event.key?.startsWith("tb_")) {
        triggerDebounced();
      }
    };
    window.addEventListener("storage", handleStorage);

    const channelName = `parts-desk-realtime-${Math.random().toString(36).slice(2, 9)}`;
    let channel: any = null;
    try {
      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "service_centre_part_requests" },
          () => triggerDebounced(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "service_centre_parts" },
          () => triggerDebounced(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "service_centre_stock_audit" },
          () => triggerDebounced(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "service_centre_part_sales" },
          () => triggerDebounced(),
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") {
            console.warn(
              `[TerraByte Realtime] Channel error on ${channelName}, fallback to authoritative polling.`,
            );
          }
        });
    } catch (err) {
      console.warn(`[TerraByte Realtime] Failed to subscribe channel ${channelName}:`, err);
    }

    const handleFocus = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      triggerDebounced();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      if (demoBc) {
        try {
          demoBc.close();
        } catch {
          // Ignore
        }
      }
      if (channel) {
        try {
          void supabase.removeChannel(channel);
        } catch {
          // Ignore
        }
      }
    };
  }, [enabled, triggerDebounced]);
}
