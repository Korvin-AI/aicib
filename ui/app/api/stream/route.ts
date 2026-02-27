import { openReadOnlyDb } from "@/lib/db";
import type Database from "better-sqlite3";

export const dynamic = "force-dynamic";

interface Watermarks {
  agentStatusHash: string;
  costTotal: number;
  lastLogId: number;
  taskMaxUpdated: string;
}

function getAgentStatusHash(db: Database.Database): string {
  try {
    const rows = db
      .prepare("SELECT * FROM agent_status ORDER BY agent_role")
      .all();
    return JSON.stringify(rows);
  } catch {
    return "";
  }
}

function getCostTotalToday(db: Database.Database): number {
  try {
    const result = db
      .prepare(
        `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
         FROM cost_entries WHERE date(timestamp) = date('now')`
      )
      .get() as { total: number };
    return result.total;
  } catch {
    return 0;
  }
}

function getLastLogId(db: Database.Database): number {
  try {
    const result = db
      .prepare("SELECT COALESCE(MAX(id), 0) as max_id FROM background_logs")
      .get() as { max_id: number };
    return result.max_id;
  } catch {
    return 0;
  }
}

function getTaskMaxUpdated(db: Database.Database): string {
  try {
    const result = db
      .prepare(
        "SELECT COALESCE(MAX(updated_at), '') as max_updated FROM tasks"
      )
      .get() as { max_updated: string };
    return result.max_updated;
  } catch {
    return "";
  }
}

function getNewLogs(
  db: Database.Database,
  afterId: number
): Array<{
  id: number;
  job_id: number;
  timestamp: string;
  message_type: string;
  agent_role: string;
  content: string;
}> {
  try {
    return db
      .prepare(
        "SELECT * FROM background_logs WHERE id > ? ORDER BY id ASC LIMIT 50"
      )
      .all(afterId) as Array<{
      id: number;
      job_id: number;
      timestamp: string;
      message_type: string;
      agent_role: string;
      content: string;
    }>;
  } catch {
    return [];
  }
}

export async function GET() {
  let db: Database.Database | null = null;

  try {
    db = openReadOnlyDb();
  } catch {
    return new Response("Database not available", { status: 503 });
  }

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    start(controller) {
      const watermarks: Watermarks = {
        agentStatusHash: getAgentStatusHash(db!),
        costTotal: getCostTotalToday(db!),
        lastLogId: getLastLogId(db!),
        taskMaxUpdated: getTaskMaxUpdated(db!),
      };

      function sendEvent(type: string, data: unknown) {
        const payload = JSON.stringify({ type, data });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }

      sendEvent("connected", { timestamp: new Date().toISOString() });

      const interval = setInterval(() => {
        if (cancelled) {
          clearInterval(interval);
          return;
        }

        try {
          const newHash = getAgentStatusHash(db!);
          if (newHash !== watermarks.agentStatusHash) {
            watermarks.agentStatusHash = newHash;
            const statuses = db!
              .prepare("SELECT * FROM agent_status ORDER BY agent_role")
              .all();
            sendEvent("agent_status", statuses);
          }

          const newCost = getCostTotalToday(db!);
          if (newCost !== watermarks.costTotal) {
            watermarks.costTotal = newCost;
            sendEvent("cost_update", { today: newCost });
          }

          const newLogs = getNewLogs(db!, watermarks.lastLogId);
          if (newLogs.length > 0) {
            watermarks.lastLogId = newLogs[newLogs.length - 1].id;
            sendEvent("new_logs", newLogs);
          }

          const newTaskMax = getTaskMaxUpdated(db!);
          if (newTaskMax !== watermarks.taskMaxUpdated) {
            watermarks.taskMaxUpdated = newTaskMax;
            sendEvent("task_update", { maxUpdated: newTaskMax });
          }
        } catch {
          // DB might be temporarily locked; skip this poll cycle
        }
      }, 2000);

      // Store interval ref for cleanup
      (controller as unknown as Record<string, unknown>).__interval =
        interval;
    },
    cancel() {
      cancelled = true;
      if (db) {
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
        db = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
