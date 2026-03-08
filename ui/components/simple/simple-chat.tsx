"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSSE } from "@/components/sse-provider";
import { getDeptColor, getRoleInitials, formatRoleName } from "@/lib/simple-mode";
import { formatRelativeTime } from "@/lib/utils";

interface ThreadEntry {
  id: string;
  createdAt: string;
  authorType: "user" | "agent" | "system";
  authorRole: string | null;
  text: string;
  jobId: number | null;
  messageType: string;
  jobStatus: string | null;
  channelId: string;
}

export function SimpleChat() {
  const { lastEvent } = useSSE();
  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionActive, setSessionActive] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadThread = useCallback(async () => {
    try {
      const res = await fetch("/api/channels/general/thread?pageSize=300", {
        cache: "no-store",
      });
      const data = await res.json();
      setEntries((data.entries || []) as ThreadEntry[]);
    } catch {}
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const d = await res.json();
      setSessionActive(!!d.session?.active);
    } catch {}
  }, []);

  useEffect(() => {
    Promise.all([loadThread(), loadStatus()]).finally(() => setLoading(false));
  }, [loadThread, loadStatus]);

  // Auto-refresh on SSE events
  useEffect(() => {
    if (!lastEvent) return;
    if (
      lastEvent.type === "new_logs" ||
      lastEvent.type === "connected" ||
      lastEvent.type === "agent_status"
    ) {
      loadThread();
      loadStatus();
    }
  }, [lastEvent, loadThread, loadStatus]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed || sending || !sessionActive) return;

    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directive: trimmed }),
      });

      const payload = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!res.ok) {
        setError(payload?.error || "Failed to send message");
        return;
      }

      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      // Refresh thread after sending
      setTimeout(() => loadThread(), 500);
    } catch {
      setError("Network error while sending message");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        paddingTop: 24,
        paddingBottom: 24,
        animation: "s-fade-in 0.3s ease-out",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--s-text-primary)",
            margin: 0,
          }}
        >
          Chat with CEO
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--s-text-tertiary)",
            marginTop: 4,
          }}
        >
          Send directives to your CEO. They delegate to the rest of the team.
        </p>
      </div>

      {/* Messages */}
      <div
        className="s-card"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 20,
          }}
        >
          {loading ? (
            <p
              style={{
                fontSize: 13,
                color: "var(--s-text-tertiary)",
                textAlign: "center",
                paddingTop: 40,
              }}
            >
              Loading messages...
            </p>
          ) : entries.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                paddingTop: 60,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  backgroundColor: getDeptColor("ceo") + "20",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px",
                  fontSize: 14,
                  fontWeight: 700,
                  color: getDeptColor("ceo"),
                }}
              >
                CEO
              </div>
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--s-text-primary)",
                }}
              >
                No messages yet
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--s-text-tertiary)",
                  marginTop: 4,
                }}
              >
                Start a conversation with your AI CEO below
              </p>
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              {entries.map((entry) => {
                const isUser = entry.authorType === "user";
                const role = entry.authorRole || "system";
                const color = isUser ? "#3B82F6" : getDeptColor(role);
                const initials = isUser ? "You" : getRoleInitials(role);
                const name = isUser ? "You" : formatRoleName(role);
                const time = formatRelativeTime(entry.createdAt);

                return (
                  <div
                    key={entry.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      flexDirection: isUser ? "row-reverse" : "row",
                    }}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        backgroundColor: color + "20",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: isUser ? 10 : 11,
                        fontWeight: 700,
                        color: color,
                        flexShrink: 0,
                      }}
                    >
                      {initials}
                    </div>

                    {/* Bubble */}
                    <div
                      style={{
                        maxWidth: "75%",
                        padding: "10px 14px",
                        borderRadius: isUser
                          ? "14px 14px 4px 14px"
                          : "14px 14px 14px 4px",
                        backgroundColor: isUser ? "#3B82F6" : "#F3F4F6",
                        color: isUser ? "#FFFFFF" : "var(--s-text-primary)",
                      }}
                    >
                      {/* Name + time header */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: isUser
                              ? "rgba(255,255,255,0.85)"
                              : "var(--s-text-primary)",
                          }}
                        >
                          {name}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: isUser
                              ? "rgba(255,255,255,0.5)"
                              : "var(--s-text-tertiary)",
                          }}
                        >
                          {time}
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: 13,
                          lineHeight: 1.5,
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {entry.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Input area */}
        <div
          style={{
            borderTop: "1px solid var(--s-border-light)",
            padding: 16,
          }}
        >
          {error && (
            <div
              style={{
                fontSize: 12,
                color: "#EF4444",
                marginBottom: 8,
                padding: "6px 10px",
                backgroundColor: "#FEE2E2",
                borderRadius: 6,
              }}
            >
              {error}
            </div>
          )}
          {!sessionActive && (
            <div
              style={{
                fontSize: 12,
                color: "#F59E0B",
                marginBottom: 8,
                padding: "6px 10px",
                backgroundColor: "#FEF3C7",
                borderRadius: 6,
              }}
            >
              Start your AI team first to send messages
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={
                sessionActive
                  ? "Message your CEO..."
                  : "Start your AI team first..."
              }
              disabled={!sessionActive || sending}
              rows={1}
              style={{
                flex: 1,
                resize: "none",
                border: "1px solid var(--s-border-light)",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--s-text-primary)",
                backgroundColor: !sessionActive ? "#F9FAFB" : "#FFFFFF",
                outline: "none",
                fontFamily: "inherit",
                maxHeight: 120,
              }}
            />
            <button
              onClick={handleSend}
              disabled={!message.trim() || sending || !sessionActive}
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                border: "none",
                backgroundColor:
                  !message.trim() || sending || !sessionActive
                    ? "#D1D5DB"
                    : "#3B82F6",
                color: "#FFFFFF",
                cursor:
                  !message.trim() || sending || !sessionActive
                    ? "not-allowed"
                    : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background-color 0.15s ease",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12H19M19 12L12 5M19 12L12 19"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
