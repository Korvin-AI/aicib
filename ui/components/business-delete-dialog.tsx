"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BusinessDeleteTarget {
  id: string;
  name: string;
  projectDir: string;
}

interface BusinessDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  business: BusinessDeleteTarget | null;
  onDeleted?: (result: { filesDeleted: boolean; filesError?: string }) => void;
}

export function BusinessDeleteDialog({
  open,
  onOpenChange,
  business,
  onDeleted,
}: BusinessDeleteDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDeleteFiles(false);
      setError(null);
    }
  }, [business?.id, open]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setDeleteFiles(false);
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleDelete() {
    if (!business) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/businesses/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: business.id,
          deleteFiles,
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        error?: string;
        filesDeleted?: boolean;
        filesError?: string;
      } | null;

      if (!res.ok) {
        setError(payload?.error || "Failed to delete business");
        return;
      }

      handleOpenChange(false);
      onDeleted?.({
        filesDeleted: payload?.filesDeleted ?? false,
        filesError: payload?.filesError ?? undefined,
      });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to delete business";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!business) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove Business</DialogTitle>
          <DialogDescription>
            Remove <strong>{business.name}</strong> from your business list.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Project folder:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              {business.projectDir}
            </code>
          </p>

          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              disabled={submitting}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Also delete the project folder and all data
          </label>

          {deleteFiles && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-[12px] text-destructive">
                This will permanently delete the project folder and all its
                contents. This cannot be undone.
              </p>
            </div>
          )}

          {error && (
            <p className="text-[12px] text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : deleteFiles ? (
              "Delete Everything"
            ) : (
              "Remove from List"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
