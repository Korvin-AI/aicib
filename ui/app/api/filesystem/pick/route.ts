import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import { isCloudMode } from "@/lib/cloud-mode";

export async function POST() {
  if (isCloudMode()) {
    return NextResponse.json({ error: "Not available in cloud mode" }, { status: 404 });
  }
  try {
    const result = spawnSync(
      "osascript",
      ["-e", 'POSIX path of (choose folder with prompt "Select a folder")'],
      { encoding: "utf-8", timeout: 120_000 },
    );

    // User clicked Cancel — osascript exits with code 1
    if (result.status === 1) {
      return NextResponse.json({ cancelled: true });
    }

    if (result.status !== 0) {
      return NextResponse.json(
        { error: result.stderr?.trim() || "osascript failed" },
        { status: 500 },
      );
    }

    const path = result.stdout.trim().replace(/\/$/, ""); // strip trailing slash
    return NextResponse.json({ path });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
