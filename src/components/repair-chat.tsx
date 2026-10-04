import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCheck,
  CornerDownLeft,
  Loader2,
  MessageSquare,
  SendHorizontal,
  Shield,
  User,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ago, fmtTime } from "@/lib/tb-store";
import { cn } from "@/lib/utils";
import {
  getRepairMessages,
  markMessagesAsRead,
  sendRepairMessage,
  type RepairMessageWithParticipants,
} from "@/lib/services/repair-messages";

export interface RepairChatProps {
  repairId: string;
  ticketNumber?: string;
  farmerId?: string;
  farmerName?: string;
  technicianId?: string | null;
  technicianName?: string;
  className?: string;
}

export function RepairChat({
  repairId,
  ticketNumber,
  farmerId,
  farmerName,
  technicianId,
  technicianName,
  className,
}: RepairChatProps) {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<RepairMessageWithParticipants[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState("");
  const [adminRecipientId, setAdminRecipientId] = useState<string | null>(null);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentUserId = profile?.id;
  const isFarmer = profile?.role === "farmer";
  const isTechnician = profile?.role === "technician";
  const isAdmin = profile?.role === "service_centre";

  // Resolve Service Centre Admin ID if needed
  useEffect(() => {
    let isMounted = true;
    async function fetchAdminProfile() {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();

      if (isMounted && data) {
        setAdminRecipientId(data.id);
      }
    }
    void fetchAdminProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  // Determine available recipients based on caller role
  interface RecipientOption {
    id: string;
    label: string;
    role: "farmer" | "technician" | "admin";
  }

  const recipientOptions: RecipientOption[] = [];
  if (isFarmer) {
    if (technicianId) {
      recipientOptions.push({
        id: technicianId,
        label: technicianName ? `Technician (${technicianName})` : "Assigned Technician",
        role: "technician",
      });
    }
    if (adminRecipientId) {
      recipientOptions.push({
        id: adminRecipientId,
        label: "Service Centre",
        role: "admin",
      });
    }
  } else if (isTechnician) {
    if (farmerId) {
      recipientOptions.push({
        id: farmerId,
        label: farmerName ? `Farmer (${farmerName})` : "Equipment Owner (Farmer)",
        role: "farmer",
      });
    }
    if (adminRecipientId) {
      recipientOptions.push({
        id: adminRecipientId,
        label: "Service Centre",
        role: "admin",
      });
    }
  } else if (isAdmin) {
    if (farmerId) {
      recipientOptions.push({
        id: farmerId,
        label: farmerName ? `Farmer (${farmerName})` : "Farmer",
        role: "farmer",
      });
    }
    if (technicianId) {
      recipientOptions.push({
        id: technicianId,
        label: technicianName ? `Technician (${technicianName})` : "Technician",
        role: "technician",
      });
    }
  }

  // Set default recipient
  useEffect(() => {
    if (recipientOptions.length > 0) {
      const currentValid = recipientOptions.some((r) => r.id === selectedRecipientId);
      if (!currentValid) {
        setSelectedRecipientId(recipientOptions[0].id);
      }
    }
  }, [recipientOptions, selectedRecipientId]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const loadMessages = useCallback(async () => {
    try {
      const data = await getRepairMessages(repairId);
      setMessages(data);

      // Mark unread messages addressed to current user as read
      if (currentUserId) {
        const unreadToMe = data.filter(
          (m) => m.recipient_id === currentUserId && !m.is_read
        );
        if (unreadToMe.length > 0) {
          void markMessagesAsRead(repairId).catch((err) =>
            console.warn("[RepairChat] Failed to mark messages as read:", err)
          );
        }
      }
    } catch (err: any) {
      console.error("[RepairChat] Failed to load messages:", err);
    } finally {
      setLoading(false);
    }
  }, [repairId, currentUserId]);

  useEffect(() => {
    void loadMessages();

    // Subscribe to realtime changes on repair_messages for this repair
    const channel = supabase
      .channel(`repair-chat-${repairId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_messages",
        },
        (payload) => {
          // If the message belongs to this repair request, refresh
          const newRow = payload.new as any;
          if (newRow && (newRow.repair_request_id === repairId || !newRow.repair_request_id)) {
            void loadMessages();
          } else {
            void loadMessages();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [repairId, loadMessages]);

  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollToBottom("auto");
    }
  }, [loading, messages.length]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || sending || !selectedRecipientId) return;

    if (text.length > 2000) {
      toast.error("Message exceeds maximum length of 2,000 characters.");
      return;
    }

    setSending(true);
    try {
      await sendRepairMessage({
        repair_request_id: repairId,
        recipient_id: selectedRecipientId,
        message_text: text,
      });
      setInputText("");
      await loadMessages();
      scrollToBottom();
    } catch (err: any) {
      console.error("[RepairChat] Failed to send message:", err);
      toast.error(err?.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  return (
    <div className={cn("flex flex-col rounded-2xl border border-border bg-card shadow-xs overflow-hidden", className)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h3 className="font-bold text-sm sm:text-base">Ticket Discussion</h3>
          {ticketNumber && (
            <span className="font-mono text-xs text-muted-foreground">· {ticketNumber}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </span>
        </div>
      </div>

      {/* Recipient Selection (if multiple options available) */}
      {recipientOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-4 py-2 text-xs">
          <span className="font-medium text-muted-foreground">Recipient:</span>
          <div className="flex flex-wrap gap-1.5">
            {recipientOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedRecipientId(opt.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 font-medium transition-colors cursor-pointer",
                  selectedRecipientId === opt.id
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message List */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4 min-h-[220px] max-h-[420px]">
        {loading ? (
          <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2 text-primary" /> Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary mb-2">
              <MessageSquare className="h-6 w-6" />
            </div>
            <p className="font-semibold text-sm">No messages yet</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Direct ticket communication between farmer, technician, and service centre. Messages
              are saved directly to this repair record.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === currentUserId;
            const senderRole = msg.sender?.role || "farmer";
            const senderName = msg.sender?.full_name || (isMe ? "You" : "Participant");
            const timeStr = fmtTime(new Date(msg.created_at).getTime());

            return (
              <div
                key={msg.id}
                className={cn("flex flex-col", isMe ? "items-end" : "items-start")}
              >
                {/* Sender Tag */}
                <div className="flex items-center gap-1.5 mb-1 text-[11px] text-muted-foreground px-1">
                  <span className="font-semibold text-foreground">
                    {isMe ? "You" : senderName}
                  </span>
                  <SenderBadge role={senderRole} />
                  <span>· {timeStr}</span>
                </div>

                {/* Message Bubble */}
                <div
                  className={cn(
                    "max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-xs break-words",
                    isMe
                      ? "bg-primary text-primary-foreground rounded-tr-xs font-normal"
                      : "bg-muted/80 text-foreground rounded-tl-xs border border-border/60"
                  )}
                >
                  <p className="whitespace-pre-wrap">{msg.message_text}</p>
                </div>

                {/* Status Indicator for Outgoing */}
                {isMe && (
                  <div className="flex items-center gap-1 mt-0.5 px-1 text-[10px] text-muted-foreground">
                    {msg.is_read ? (
                      <>
                        <CheckCheck className="h-3 w-3 text-primary" />
                        <span>Read</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-3 w-3" />
                        <span>Sent</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer */}
      <form onSubmit={handleSendMessage} className="border-t border-border bg-card p-3">
        <div className="relative">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending || recipientOptions.length === 0}
            rows={2}
            maxLength={2000}
            placeholder={
              recipientOptions.length === 0
                ? "No counterpart available to message on this ticket yet."
                : "Type a message regarding this repair… (Press Enter to send)"
            }
            className="w-full resize-none rounded-xl border border-input bg-background p-2.5 pr-20 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="absolute right-2 bottom-3 flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground font-mono">
              {inputText.length > 0 && `${inputText.length}/2000`}
            </span>
            <button
              type="submit"
              disabled={
                !inputText.trim() ||
                sending ||
                recipientOptions.length === 0 ||
                inputText.length > 2000
              }
              aria-label="Send message"
              className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizontal className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground flex items-center gap-1">
          <CornerDownLeft className="h-3 w-3 opacity-60" /> Shift+Enter for new line · Messages are
          notified immediately to your counterpart
        </p>
      </form>
    </div>
  );
}

function SenderBadge({ role }: { role: string }) {
  if (role === "farmer") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider">
        <User className="h-2.5 w-2.5" /> Farmer
      </span>
    );
  }
  if (role === "technician") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider">
        <Wrench className="h-2.5 w-2.5" /> Tech
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-300 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider">
      <Shield className="h-2.5 w-2.5" /> Service Centre
    </span>
  );
}
