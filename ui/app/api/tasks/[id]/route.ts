import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, safeAll, safeGet, tableExists } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const hasTaskBlockers = tableExists(db, "task_blockers");
    const hasTaskComments = tableExists(db, "task_comments");
    const { id } = await params;
    const taskId = Number.parseInt(id, 10);

    if (!Number.isFinite(taskId)) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    if (!tableExists(db, "tasks")) {
      return NextResponse.json({ error: "Task table not found" }, { status: 404 });
    }

    const blockerCountExpr = hasTaskBlockers
      ? "(SELECT COUNT(*) FROM task_blockers WHERE task_id = t.id)"
      : "0";
    const commentCountExpr = hasTaskComments
      ? "(SELECT COUNT(*) FROM task_comments WHERE task_id = t.id)"
      : "0";

    const task = safeGet<Record<string, unknown>>(
      db,
      "tasks",
      `SELECT t.*,
        ${blockerCountExpr} as blocker_count,
        ${commentCountExpr} as comment_count
      FROM tasks t
      WHERE t.id = ?`,
      [taskId]
    );

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const blockers = safeAll<Record<string, unknown>>(
      db,
      "task_blockers",
      `SELECT b.blocker_id, t.title, t.status, t.priority
       FROM task_blockers b
       JOIN tasks t ON t.id = b.blocker_id
       WHERE b.task_id = ?
       ORDER BY b.created_at ASC`,
      [taskId]
    );

    const comments = safeAll<Record<string, unknown>>(
      db,
      "task_comments",
      `SELECT id, author, content, comment_type, created_at
       FROM task_comments
       WHERE task_id = ?
       ORDER BY created_at ASC, id ASC`,
      [taskId]
    );

    const subtasks = safeAll<Record<string, unknown>>(
      db,
      "tasks",
      `SELECT id, title, status, priority, assignee, updated_at
       FROM tasks
       WHERE parent_id = ?
       ORDER BY updated_at DESC`,
      [taskId]
    );

    return NextResponse.json({
      task,
      blockers,
      comments,
      subtasks,
    });
  } catch (error) {
    return jsonError(error);
  }
}
