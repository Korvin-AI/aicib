"use client";

import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BusinessStopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessName: string;
  onStopped?: () => void;
}

export function BusinessStopDialog({
  open,
  onOpenChange,
  businessName,
  onStopped,
}: BusinessStopDialogProps) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStop() {
    setStopping(true);
    setError(null);

    try {
      const res = await fetch("/api/businesses/stop", {
        method: "POST",
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;

      if (!res.ok) {
        setError(payload?.error || "Failed to stop business");
        return;
      }

      onOpenChange(false);
      onStopped?.();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to stop business";
      setError(message);
    } finally {
      setStopping(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-amber-500" />
            Stop Company
          </DialogTitle>
          <DialogDescription>
            This will stop the currently running session for
            <span className="mx-1 font-medium text-foreground">{businessName}</span>
            and mark agents as stopped.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-[12px] text-destructive">{error}</p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={stopping}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleStop}
            disabled={stopping}
          >
            {stopping ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Stopping...
              </>
            ) : (
              "Stop Company"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
