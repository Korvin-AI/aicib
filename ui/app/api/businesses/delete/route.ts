import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { getBusinessById, removeBusiness } from "@/lib/business-registry";
import { getBusinessHealth } from "@/lib/business-context";
import { stopBusinessSync } from "@/lib/business-commands";
import { isCloudMode } from "@/lib/cloud-mode";
import { cloudFetchOrg } from "@/lib/cloud-proxy";

export const dynamic = "force-dynamic";

interface DeleteRequestBody {
  businessId?: string;
  deleteFiles?: boolean;
}

function isSafeToDelete(projectDir: string): boolean {
  const resolved = path.resolve(projectDir);
  const homeDir = os.homedir();

  // Must be at least 2 segments deep (e.g. /tmp/project, not / or /tmp)
  if (resolved.split(path.sep).filter(Boolean).length < 2) return false;

  // Must not be the home directory itself
  if (resolved === homeDir) return false;

  // Must contain an aicib project marker
  if (!fs.existsSync(path.join(resolved, "aicib.config.yaml"))) return false;

  return true;
}

export async function POST(request: Request) {
  if (isCloudMode()) return cloudFetchOrg(request, "businesses/delete", { method: "POST" });

  try {
    const body = (await request.json().catch(() => ({}))) as DeleteRequestBody;
    const businessId = body.businessId?.trim();

    if (!businessId) {
      return NextResponse.json(
        { error: "businessId is required" },
        { status: 400 }
      );
    }

    const business = getBusinessById(businessId);
    if (!business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
    }

    // Stop any running session before removing
    const health = getBusinessHealth(business.projectDir);
    if (health.sessionActive) {
      const stop = stopBusinessSync(business.projectDir);
      if (!stop.success) {
        return NextResponse.json(
          {
            error: `Cannot delete: failed to stop running session. ${stop.message}`,
          },
          { status: 500 }
        );
      }
    }

    // Delete files FIRST (before registry removal) so a failure leaves registry intact
    let filesDeleted = false;
    const filesError: string | null = null;

    if (body.deleteFiles) {
      if (!isSafeToDelete(business.projectDir)) {
        return NextResponse.json(
          { error: "Refusing to delete: path failed safety check (missing aicib.config.yaml or path too short)" },
          { status: 400 }
        );
      }

      try {
        fs.rmSync(business.projectDir, { recursive: true, force: true });
        filesDeleted = true;
      } catch (err) {
        return NextResponse.json(
          {
            error: `Failed to delete project folder: ${err instanceof Error ? err.message : "unknown error"}`,
          },
          { status: 500 }
        );
      }
    }

    // Remove from registry only after files are successfully handled
    const { removed, newActiveId } = removeBusiness(businessId);
    if (!removed) {
      return NextResponse.json(
        { error: "Business was already removed" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      registryRemoved: true,
      filesDeleted,
      filesError,
      newActiveId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
