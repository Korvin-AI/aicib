import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, safeAll, safeGet, tableExists } from "@/lib/api-helpers";
import { isCloudMode } from "@/lib/cloud-mode";
import { cloudFetch } from "@/lib/cloud-proxy";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (isCloudMode()) {
    const { id } = await params;
    return cloudFetch(_request, `projects/${id}`);
  }
  try {
    const db = getDb();
    const { id } = await params;
    const projectId = Number.parseInt(id, 10);

    if (!Number.isFinite(projectId)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    if (!tableExists(db, "projects")) {
      return NextResponse.json({ error: "Project table not found" }, { status: 404 });
    }

    const project = safeGet<Record<string, unknown>>(
      db,
      "projects",
      "SELECT * FROM projects WHERE id = ?",
      [projectId]
    );

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const phases = tableExists(db, "project_phases")
      ? safeAll<Record<string, unknown>>(
          db,
          "project_phases",
          `SELECT * FROM project_phases
           WHERE project_id = ?
           ORDER BY phase_number ASC`,
          [projectId]
        )
      : [];

    return NextResponse.json({ project, phases });
  } catch (error) {
    return jsonError(error);
  }
}
