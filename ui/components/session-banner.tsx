"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionBannerProps {
  onSessionStarted: () => void;
}

export function SessionBanner({ onSessionStarted }: SessionBannerProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/start", { method: "POST" });
      if (res.ok) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        onSessionStarted();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Start failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/65 px-4 py-2">
      <span className="text-[13px] text-foreground/80">No active session</span>
      <div className="flex items-center gap-2">
        {error && (
          <span className="text-[11px] text-destructive">{error}</span>
        )}
        <Button
          onClick={handleStart}
          disabled={starting}
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-[13px] text-foreground/80 hover:bg-background hover:text-foreground"
        >
          {starting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play className="h-3 w-3" />
              Start Company
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
