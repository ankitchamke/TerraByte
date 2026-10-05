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

    const cleanId = repairId.trim();
    if (!isUuid(cleanId)) {
      // Postgres Changes column filters require the exact UUID primary/foreign key
      return;
    }

    // Ticket-scoped channel name ensures dedicated socket multiplexing without collisions
    const channelName = `ticket-realtime-${cleanId}`;

    const channel = supabase
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
          table: "repair_timeline",
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

    // Window focus listener ensures fresh state if reconnecting or returning from another tab
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
      void supabase.removeChannel(channel);
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

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", changeConfig, () => {
        triggerDebounced();
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn(`[TerraByte Realtime] Channel error on ${channelName}, fallback to authoritative polling.`);
        }
      });

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
      void supabase.removeChannel(channel);
    };
  }, [channelName, filter, enabled, triggerDebounced]);
}
