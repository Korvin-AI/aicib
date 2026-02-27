import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { tryGetProjectDir } from "@/lib/config";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const directive = body?.directive;

    if (!directive || typeof directive !== "string" || !directive.trim()) {
      return NextResponse.json(
        { error: "Directive is required" },
        { status: 400 }
      );
    }

    const projectDir = tryGetProjectDir();
    if (!projectDir) {
      return NextResponse.json(
        {
          error:
            "No active business selected. Create or import a business first.",
        },
        { status: 400 }
      );
    }

    const db = getDb();

    // Check for active session
    const activeSession = db
      .prepare(
        "SELECT id FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
      )
      .get() as { id: string } | undefined;

    if (!activeSession) {
      return NextResponse.json(
        {
          error:
            "No active session. Run 'aicib start' first to start the AI company.",
        },
        { status: 400 }
      );
    }

    // Check for already-running background job
    const runningJob = db
      .prepare(
        "SELECT id, pid FROM background_jobs WHERE session_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1"
      )
      .get(activeSession.id) as { id: number; pid: number | null } | undefined;

    if (runningJob?.pid) {
      // Check if process is still alive
      try {
        process.kill(runningJob.pid, 0);
        return NextResponse.json(
          {
            error: `A brief is already running (job #${runningJob.id}). Wait for it to complete.`,
          },
          { status: 409 }
        );
      } catch {
        // Process not running, continue
      }
    }

    // Spawn `aicib brief -b <directive>` as a subprocess
    // This avoids importing core modules and uses the existing CLI infrastructure
    const child = spawn(
      "npx",
      ["aicib", "brief", "-b", "-d", projectDir, directive.trim()],
      {
        detached: true,
        stdio: "ignore",
        cwd: projectDir,
      }
    );

    const pid = child.pid;
    child.unref();

    return NextResponse.json({
      success: true,
      pid: pid || null,
      message: "Brief submitted in background",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
