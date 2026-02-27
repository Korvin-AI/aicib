"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BusinessImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function BusinessImportDialog({
  open,
  onOpenChange,
  onImported,
}: BusinessImportDialogProps) {
  const [projectDir, setProjectDir] = useState("");
  const [startNow, setStartNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    const cleaned = projectDir.trim();
    if (!cleaned) {
      setError("Project folder path is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/businesses/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectDir: cleaned,
          startNow,
        }),
      });

      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(payload?.error || "Failed to import business");
        return;
      }

      onOpenChange(false);
      onImported?.();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to import business";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Existing Business</DialogTitle>
          <DialogDescription>
            Enter the full folder path that already contains an
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">aicib.config.yaml</code>
            file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="import-project-dir">Project Folder</Label>
            <Input
              id="import-project-dir"
              placeholder="/Users/you/My Business"
              value={projectDir}
              onChange={(event) => setProjectDir(event.target.value)}
              disabled={submitting}
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={startNow}
              onChange={(event) => setStartNow(event.target.checked)}
              disabled={submitting}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Start this business immediately after import
          </label>

          {error ? (
            <p className="text-[12px] text-destructive">{error}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              "Import Business"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
