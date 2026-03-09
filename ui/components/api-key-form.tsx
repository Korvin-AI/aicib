"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ApiKeyFormProps {
  hasApiKey: boolean;
  maskedKey?: string;
  requireUserApiKeys: boolean;
}

export function ApiKeyForm({
  hasApiKey: initialHasKey,
  maskedKey: initialMaskedKey,
  requireUserApiKeys,
}: ApiKeyFormProps) {
  const [hasKey, setHasKey] = useState(initialHasKey);
  const [maskedKey, setMaskedKey] = useState(initialMaskedKey);
  const [editing, setEditing] = useState(false);
  const [keyValue, setKeyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showInput = !hasKey || editing;

  async function handleSave() {
    setError(null);
    const trimmed = keyValue.trim();
    if (!trimmed.startsWith("sk-ant-")) {
      setError("API key must start with sk-ant-");
      return;
    }
    if (trimmed.length < 20) {
      setError("API key is too short");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/anthropic-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to save key (${res.status})`);
        return;
      }
      const data = await res.json();
      setHasKey(true);
      setMaskedKey("sk-ant-\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
      setKeyValue("");
      setEditing(false);
    } catch {
      setError("Network error — could not save key");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!window.confirm("Remove your API key? Your AI team won't be able to run until you add a new one.")) {
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/anthropic-key", {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to remove key (${res.status})`);
        return;
      }
      setHasKey(false);
      setMaskedKey(undefined);
      setEditing(false);
      setKeyValue("");
    } catch {
      setError("Network error — could not remove key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Banner when no key and keys are required */}
      {!hasKey && requireUserApiKeys && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            backgroundColor: "#FEF3C7",
            border: "1px solid #F59E0B",
            fontSize: 13,
            color: "#92400E",
          }}
        >
          You need to add your Anthropic API key to run your AI team
        </div>
      )}

      {showInput ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-..."
              value={keyValue}
              onChange={(e) => {
                setKeyValue(e.target.value);
                setError(null);
              }}
              style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 13 }}
              disabled={saving}
            />
            <Button
              onClick={handleSave}
              disabled={saving || !keyValue}
              size="sm"
            >
              {saving ? "Saving..." : "Save Key"}
            </Button>
            {editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setKeyValue("");
                  setError(null);
                }}
                disabled={saving}
              >
                Cancel
              </Button>
            )}
          </div>
          {error && (
            <p style={{ fontSize: 12, color: "#DC2626", margin: 0 }}>{error}</p>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              color: "var(--s-text-primary, var(--foreground))",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              style={{ flexShrink: 0 }}
            >
              <circle cx="8" cy="8" r="8" fill="#10B981" />
              <path
                d="M5 8.5L7 10.5L11 6"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {maskedKey || "sk-ant-\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={saving}
          >
            Change Key
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={saving}
            style={{ color: "#DC2626" }}
          >
            {saving ? "Removing..." : "Remove Key"}
          </Button>
          {error && (
            <p style={{ fontSize: 12, color: "#DC2626", margin: 0 }}>{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
