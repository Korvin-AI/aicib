"use client";

import { useCallback, useRef, useState } from "react";

interface SimpleBriefInputProps {
  disabled?: boolean;
}

export function SimpleBriefInput({ disabled }: SimpleBriefInputProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || sending || disabled) return;

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
        setError(
          payload?.error || "Failed to send message"
        );
        return;
      }

      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch {
      setError("Network error while sending message");
    } finally {
      setSending(false);
    }
  }, [message, sending, disabled]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  return (
    <div
      className="s-card"
      style={{
        padding: 16,
        animation: "s-fade-in 0.3s ease-out",
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
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Start your AI team first..." : "Message your CEO..."}
          disabled={disabled || sending}
          rows={2}
          style={{
            flex: 1,
            resize: "none",
            border: "1px solid var(--s-border-light)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--s-text-primary)",
            backgroundColor: disabled ? "#F9FAFB" : "#FFFFFF",
            outline: "none",
            fontFamily: "inherit",
            maxHeight: 160,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!message.trim() || sending || disabled}
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "none",
            backgroundColor:
              !message.trim() || sending || disabled ? "#D1D5DB" : "#3B82F6",
            color: "#FFFFFF",
            cursor:
              !message.trim() || sending || disabled
                ? "not-allowed"
                : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "background-color 0.15s ease",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
  );
}
