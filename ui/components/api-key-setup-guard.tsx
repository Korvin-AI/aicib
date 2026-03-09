"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Key, Check, ExternalLink } from "lucide-react";

const STEPS = [
  {
    title: "Go to Anthropic Console",
    description:
      "Open console.anthropic.com in your browser and sign in (or create an account).",
  },
  {
    title: "Navigate to API Keys",
    description:
      'In the left sidebar, click on "API Keys" to open the key management page.',
  },
  {
    title: "Create a new key",
    description:
      'Click "Create Key", give it a name (e.g. "AICIB"), then copy the key that starts with sk-ant-.',
  },
  {
    title: "Paste it here",
    description: "Paste your API key below and hit Save. You're all set!",
  },
];

function dismissKey(businessId: string) {
  return `aicib-api-key-popup-dismissed-${businessId}`;
}

/* ── Visual mockups (styled HTML, no images) ── */

function BrowserFrame({ children, url }: { children: React.ReactNode; url: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          background: "var(--muted)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#EF4444",
          }}
        />
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#F59E0B",
          }}
        />
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#22C55E",
          }}
        />
        <div
          style={{
            flex: 1,
            marginLeft: 8,
            padding: "3px 10px",
            borderRadius: 6,
            background: "var(--background)",
            color: "var(--muted-foreground)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {url}
        </div>
      </div>
      {/* Content */}
      <div style={{ padding: 16, background: "var(--background)" }}>{children}</div>
    </div>
  );
}

function Step1Mockup() {
  return (
    <BrowserFrame url="https://console.anthropic.com">
      <div style={{ textAlign: "center", padding: "12px 0" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 18,
            fontWeight: 600,
            color: "var(--foreground)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M16.5 3L21 12l-4.5 9H7.5L3 12l4.5-9h9z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          Anthropic Console
        </div>
        <p
          style={{
            marginTop: 8,
            color: "var(--muted-foreground)",
            fontSize: 13,
          }}
        >
          Sign in or create an account to get your API key
        </p>
        <a
          href="https://console.anthropic.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginTop: 12,
            padding: "8px 16px",
            borderRadius: 8,
            background: "var(--foreground)",
            color: "var(--background)",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Open Console
          <ExternalLink size={14} />
        </a>
      </div>
    </BrowserFrame>
  );
}

function Step2Mockup() {
  const items = [
    { label: "Dashboard", active: false },
    { label: "API Keys", active: true },
    { label: "Usage", active: false },
    { label: "Settings", active: false },
  ];
  return (
    <BrowserFrame url="https://console.anthropic.com/settings/keys">
      <div style={{ display: "flex", gap: 16 }}>
        {/* Sidebar */}
        <div
          style={{
            width: 140,
            borderRight: "1px solid var(--border)",
            paddingRight: 12,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {items.map((item) => (
            <div
              key={item.label}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: item.active ? 600 : 400,
                background: item.active ? "var(--accent)" : "transparent",
                color: item.active ? "var(--accent-foreground)" : "var(--muted-foreground)",
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
        {/* Main */}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>API Keys</div>
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px dashed var(--border)",
              color: "var(--muted-foreground)",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            Your API keys will appear here
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

function Step3Mockup() {
  return (
    <BrowserFrame url="https://console.anthropic.com/settings/keys">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15 }}>API Keys</span>
          <div
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              background: "var(--foreground)",
              color: "var(--background)",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            + Create Key
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--muted)",
          }}
        >
          <Key size={14} style={{ color: "var(--muted-foreground)" }} />
          <span
            style={{
              flex: 1,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--foreground)",
            }}
          >
            sk-ant-api03-••••••••
          </span>
          <div
            style={{
              padding: "3px 10px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--muted-foreground)",
              cursor: "default",
            }}
          >
            Copy
          </div>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--muted-foreground)",
          }}
        >
          Copy the full key — you won't be able to see it again.
        </p>
      </div>
    </BrowserFrame>
  );
}

/* ── Step indicator ── */

function StepIndicator({
  current,
  total,
  onStepClick,
}: {
  current: number;
  total: number;
  onStepClick: (step: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => onStepClick(i)}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              transition: "all 150ms",
              background:
                i === current
                  ? "var(--foreground)"
                  : i < current
                    ? "var(--accent)"
                    : "var(--muted)",
              color:
                i === current
                  ? "var(--background)"
                  : i < current
                    ? "var(--accent-foreground)"
                    : "var(--muted-foreground)",
            }}
          >
            {i < current ? <Check size={14} /> : i + 1}
          </button>
          {i < total - 1 && (
            <div
              style={{
                width: 32,
                height: 2,
                background: i < current ? "var(--accent-foreground)" : "var(--border)",
                transition: "background 150ms",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main guard component ── */

export function ApiKeySetupGuard({ children }: { children: React.ReactNode }) {
  const { isCloudMode, activeBusinessId } = useAuth();
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Check whether to show the popup
  useEffect(() => {
    if (!isCloudMode) return;
    if (!activeBusinessId) return;
    if (localStorage.getItem(dismissKey(activeBusinessId))) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.requireUserApiKeys === "undefined") {
          console.warn("[ApiKeySetupGuard] requireUserApiKeys missing from /api/settings response");
        }
        if (data.requireUserApiKeys && !data.engine?.hasApiKey) {
          setOpen(true);
        }
      } catch {
        // Fail silently — don't nag if we can't reach settings
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCloudMode, activeBusinessId]);

  const handleDismiss = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        // User closed the dialog — set dismiss flag
        if (activeBusinessId) {
          localStorage.setItem(dismissKey(activeBusinessId), "1");
        }
        setOpen(false);
      }
    },
    [activeBusinessId]
  );

  async function handleSave() {
    setError(null);
    const trimmed = apiKey.trim();
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
      setSaved(true);
      // Auto-close after showing success
      closeTimerRef.current = setTimeout(() => {
        if (activeBusinessId) {
          localStorage.setItem(dismissKey(activeBusinessId), "1");
        }
        setOpen(false);
      }, 1500);
    } catch {
      setError("Network error — could not save key");
    } finally {
      setSaving(false);
    }
  }

  const step = STEPS[currentStep];

  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={handleDismiss}>
        <DialogContent style={{ maxWidth: 520 }}>
          <DialogHeader>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Key size={18} style={{ color: "var(--accent-foreground)" }} />
              </div>
              <div>
                <DialogTitle>Connect your API key</DialogTitle>
                <DialogDescription>
                  Your AI team needs an Anthropic API key to run
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Step indicator */}
          <div style={{ padding: "4px 0" }}>
            <StepIndicator
              current={currentStep}
              total={STEPS.length}
              onStepClick={setCurrentStep}
            />
          </div>

          {/* Step content */}
          <div style={{ minHeight: 180 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{step.title}</div>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 13,
                  color: "var(--muted-foreground)",
                }}
              >
                {step.description}
              </p>
            </div>

            {currentStep === 0 && <Step1Mockup />}
            {currentStep === 1 && <Step2Mockup />}
            {currentStep === 2 && <Step3Mockup />}
            {currentStep === 3 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {saved ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "24px 0",
                      color: "#10B981",
                      fontSize: 15,
                      fontWeight: 600,
                    }}
                  >
                    <Check size={20} />
                    API key saved — you're all set!
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Input
                        type="password"
                        autoComplete="off"
                        placeholder="sk-ant-api03-..."
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setError(null);
                        }}
                        disabled={saving}
                        style={{
                          flex: 1,
                          fontFamily: "var(--font-mono)",
                          fontSize: 13,
                        }}
                      />
                      <Button
                        onClick={handleSave}
                        disabled={saving || !apiKey.trim()}
                        size="sm"
                      >
                        {saving ? "Saving..." : "Save Key"}
                      </Button>
                    </div>
                    {error && (
                      <p style={{ fontSize: 12, color: "#DC2626", margin: 0 }}>
                        {error}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 4,
            }}
          >
            <div>
              {currentStep > 0 && !saved && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentStep((s) => s - 1)}
                >
                  Back
                </Button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {currentStep < 3 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentStep(3)}
                    style={{ fontSize: 12, color: "var(--muted-foreground)" }}
                  >
                    I already have a key
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setCurrentStep((s) => s + 1)}
                  >
                    Next
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
