"use client";

import { useEffect, useState } from "react";
import { Loader2, Square, Play } from "lucide-react";
import { useSSE } from "@/components/sse-provider";
import { BusinessStopDialog } from "@/components/business-stop-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Topbar() {
  const { connected, lastEvent } = useSSE();
  const [companyName, setCompanyName] = useState("AICIB");
  const [sessionActive, setSessionActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"start" | "stop" | null>(
    null
  );
  const [stopOpen, setStopOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const d = (await res.json()) as {
        company?: { name?: string };
        session?: { active?: boolean };
      };
      if (d.company?.name) setCompanyName(d.company.name);
      setSessionActive(!!d.session?.active);
    } catch {
      // Ignore transient fetch errors.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    if (
      lastEvent.type === "agent_status" ||
      lastEvent.type === "new_logs" ||
      lastEvent.type === "connected"
    ) {
      loadStatus();
    }
  }, [lastEvent]);

  async function handleStart() {
    setActionLoading("start");
    setActionError(null);
    try {
      const res = await fetch("/api/businesses/start", { method: "POST" });
      const payload = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        setActionError(payload?.error || "Failed to start company");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await loadStatus();
    } catch {
      setActionError("Network error while starting company");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 bg-surface-raised/95 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="text-[13px] font-semibold text-foreground">
          {companyName}
        </span>
        {actionError ? (
          <span className="text-[11px] text-destructive">{actionError}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
            connected
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-600"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connected ? "bg-emerald-500" : "bg-red-500"
            )}
          />
          {connected ? "Connected" : "Disconnected"}
        </div>

        <div
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
            sessionActive
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-zinc-200 bg-zinc-50 text-zinc-600"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              sessionActive ? "bg-emerald-500" : "bg-zinc-400"
            )}
          />
          {loading ? "Checking..." : sessionActive ? "Running" : "Stopped"}
        </div>

        {sessionActive ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-[12px]"
            onClick={() => setStopOpen(true)}
            disabled={actionLoading !== null}
          >
            {actionLoading === "stop" ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Stopping...
              </>
            ) : (
              <>
                <Square className="mr-1 h-3.5 w-3.5" />
                Stop Company
              </>
            )}
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-7 px-2 text-[12px]"
            onClick={handleStart}
            disabled={actionLoading !== null}
          >
            {actionLoading === "start" ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="mr-1 h-3.5 w-3.5" />
                Start Company
              </>
            )}
          </Button>
        )}
      </div>

      <BusinessStopDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        businessName={companyName}
        onStopped={async () => {
          setActionLoading("stop");
          setActionError(null);
          await loadStatus();
          setActionLoading(null);
        }}
      />
    </header>
  );
}
