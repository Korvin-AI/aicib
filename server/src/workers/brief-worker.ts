import { Queue, Worker } from 'bullmq';
import { eq, sql, and, lt } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  agentStatus,
  costEntries,
  backgroundLogs,
  backgroundJobs,
} from '../db/schema/index';
import { tenantValues } from '../repositories/tenant-helpers';
import { publish } from '../realtime/publisher';
import { env } from '../env';

// ---------------------------------------------------------------------------
// 5a. Job data interface
// ---------------------------------------------------------------------------

export interface BriefJobData {
  jobId: number;
  businessId: string;
  orgId: string;
  sessionId: string;
  sdkSessionId: string;
  directive: string;
  companyName: string;
  costLimitDaily: number;
  agentDefinitions: Array<{
    role: string;
    model?: string;
    department?: string;
    enabled?: boolean;
    displayName?: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// 5b. CloudCostTracker — PostgreSQL + Redis publisher adapter
// ---------------------------------------------------------------------------

class CloudCostTracker {
  constructor(
    private orgId: string,
    private businessId: string,
    private jobId: number,
  ) {}

  async setAgentStatus(
    role: string,
    status: string,
    task?: string,
  ): Promise<void> {
    try {
      await db
        .insert(agentStatus)
        .values({
          agentRole: role,
          ...tenantValues(this.orgId, this.businessId),
          status,
          lastActivity: new Date(),
          currentTask: task ?? null,
        })
        .onConflictDoUpdate({
          target: [agentStatus.businessId, agentStatus.agentRole],
          set: {
            status,
            lastActivity: new Date(),
            currentTask: task ?? null,
          },
        });

      await publish(this.businessId, this.jobId, {
        type: 'agent_status',
        data: { role, status, task: task ?? null },
      });
    } catch (err) {
      console.error('setAgentStatus error:', (err as Error).message);
    }
  }

  async recordCost(
    role: string,
    sessionId: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
  ): Promise<void> {
    try {
      await db.insert(costEntries).values({
        ...tenantValues(this.orgId, this.businessId),
        agentRole: role,
        sessionId,
        inputTokens,
        outputTokens,
        estimatedCostUsd: costUsd,
      });

      // Sum today's cost for the update event
      const [todayCost] = await db
        .select({
          total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
        })
        .from(costEntries)
        .where(
          sql`${costEntries.businessId} = ${this.businessId} AND DATE(${costEntries.timestamp} AT TIME ZONE 'UTC') = CURRENT_DATE`,
        );

      await publish(this.businessId, this.jobId, {
        type: 'cost_update',
        data: { today: Number((todayCost?.total ?? 0).toFixed(4)) },
      });
    } catch (err) {
      console.error('recordCost error:', (err as Error).message);
    }
  }

  async logBackgroundMessage(
    jobId: number,
    type: string,
    role: string,
    content: string,
  ): Promise<void> {
    try {
      const [row] = await db
        .insert(backgroundLogs)
        .values({
          ...tenantValues(this.orgId, this.businessId),
          jobId,
          messageType: type,
          agentRole: role,
          content,
        })
        .returning();

      await publish(this.businessId, jobId, {
        type: 'new_logs',
        data: row,
      });
    } catch (err) {
      console.error('logBackgroundMessage error:', (err as Error).message);
    }
  }

  async updateBackgroundJob(
    jobId: number,
    fields: Record<string, unknown>,
  ): Promise<void> {
    try {
      await db
        .update(backgroundJobs)
        .set(fields)
        .where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.businessId, this.businessId)));

      await publish(this.businessId, jobId, {
        type: 'job_status',
        data: { jobId, ...fields },
      });
    } catch (err) {
      console.error('updateBackgroundJob error:', (err as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// 5c. cloudSendBrief() — simplified cloud version of sendBrief()
// ---------------------------------------------------------------------------

interface SessionResult {
  sessionId: string;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
  durationMs: number;
}

async function cloudSendBrief(
  data: BriefJobData,
  onMessage?: (msg: any) => void,
): Promise<SessionResult> {
  // Dynamic import — module may not be installed in all environments
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  // Build subagents from JSONB definitions (no disk reads)
  const agents: Record<string, { description: string; prompt: string; tools: string[]; model: 'sonnet' | 'opus' | 'haiku' | 'inherit'; maxTurns: number }> = {};
  for (const a of data.agentDefinitions) {
    if (a.enabled === false || a.role === 'ceo') continue;
    const model = (a.model === 'opus' || a.model === 'haiku' || a.model === 'sonnet') ? a.model : 'sonnet';
    agents[a.role] = {
      description: `${a.displayName || a.role} department head`,
      prompt: `You are the ${a.displayName || a.role} department head at ${data.companyName}. Department: ${a.department || a.role}. Execute tasks delegated to you by the CEO. Be thorough and report results clearly.`,
      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Task'],
      model,
      maxTurns: 200,
    };
  }

  const briefPrompt = `DIRECTIVE FROM HUMAN FOUNDER:\n\n${data.directive}\n\n---\nProcess this directive according to your CEO role. Decompose into department-level objectives and delegate to your team using the Task tool. Report back with your plan before executing.`;

  // Resolve per-org API key, fall back to server-wide key
  let anthropicKey = env.ANTHROPIC_API_KEY ?? '';
  try {
    const { getOrgSecret } = await import('../repositories/secrets-repo');
    const orgKey = await getOrgSecret(data.orgId, 'anthropic_api_key');
    if (orgKey) {
      anthropicKey = orgKey;
    }
  } catch {
    // ENCRYPTION_KEY not set or decrypt failed — use server key
  }

  // Whitelist only needed env vars — avoid leaking DATABASE_URL, REDIS_URL, etc.
  const engineEnv: Record<string, string> = {
    HOME: process.env.HOME ?? '',
    PATH: process.env.PATH ?? '',
    NODE_ENV: process.env.NODE_ENV ?? 'production',
    ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
  };

  const ceoModel =
    data.agentDefinitions.find((a) => a.role === 'ceo')?.model || 'sonnet';

  let result: SessionResult = {
    sessionId: data.sdkSessionId,
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    numTurns: 0,
    durationMs: 0,
  };

  const queryStream = query({
    prompt: briefPrompt,
    options: {
      resume: data.sdkSessionId,
      model: ceoModel,
      tools: { type: 'preset', preset: 'claude_code' },
      agents,
      permissionMode: 'bypassPermissions',
      maxTurns: 500,
      env: engineEnv,
    },
  });

  for await (const message of queryStream) {
    if (onMessage) {
      onMessage(message);
    }

    if (message.type === 'result') {
      result = {
        sessionId: message.session_id || data.sdkSessionId,
        totalCostUsd: message.total_cost_usd ?? 0,
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
        numTurns: message.num_turns ?? 0,
        durationMs: message.duration_ms ?? 0,
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 5d. Message formatting (inlined from local code, zero dependencies)
// ---------------------------------------------------------------------------

function formatMessagePlain(message: any): string | null {
  if (message.type === 'assistant') {
    const content = message.message?.content;
    if (!content) return null;

    const texts: string[] = [];
    for (const block of content) {
      if ('text' in block && block.text) {
        texts.push(block.text);
      } else if ('name' in block) {
        texts.push(`[Tool: ${block.name}]`);
      }
    }
    if (texts.length > 0) {
      const prefix = message.parent_tool_use_id ? '[SUBAGENT]' : '[CEO]';
      return `${prefix} ${texts.join('\n')}`;
    }
  }

  if (message.type === 'system' && 'subtype' in message) {
    if (message.subtype === 'init') {
      return `[SYSTEM] Session: ${message.session_id} | Model: ${message.model}`;
    }
    if (message.subtype === 'task_notification') {
      const status = message.status || 'update';
      return `[TASK] ${message.task_id || 'subagent'}: ${status}`;
    }
  }

  if (message.type === 'result') {
    return `[RESULT] Cost: $${(message.total_cost_usd ?? 0).toFixed(4)} | Turns: ${message.num_turns ?? 0} | Duration: ${((message.duration_ms ?? 0) / 1000).toFixed(1)}s`;
  }

  return null;
}

// Track sub-agent status from Task tool_use / tool_result messages
function trackSubagentStatus(
  msg: any,
  tracker: CloudCostTracker,
  activeSubagents: Map<string, string>,
): void {
  if (msg.type === 'assistant' && msg.message?.content) {
    for (const block of msg.message.content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        block.type === 'tool_use' &&
        block.name === 'Task' &&
        block.id &&
        block.input
      ) {
        const agent = (
          (block.input.subagent_type as string) ||
          (block.input.agent_name as string) ||
          ''
        ).toLowerCase();
        if (agent) {
          activeSubagents.set(block.id, agent);
          tracker.setAgentStatus(agent, 'working');
        }
      }
    }
  }

  if (msg.type === 'user' && msg.message?.content) {
    for (const block of msg.message.content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        block.type === 'tool_result' &&
        block.tool_use_id
      ) {
        const agent = activeSubagents.get(block.tool_use_id);
        if (agent) {
          activeSubagents.delete(block.tool_use_id);
          tracker.setAgentStatus(agent, 'idle');
        }
      }
    }
  }
}

function createMessageCallback(
  jobId: number,
  tracker: CloudCostTracker,
): (msg: any) => void {
  const activeSubagents = new Map<string, string>(); // per-job, not shared
  return (msg: any) => {
    trackSubagentStatus(msg, tracker, activeSubagents);

    const formatted = formatMessagePlain(msg);
    if (formatted) {
      let role = 'system';
      if (msg.type === 'assistant') {
        role = msg.parent_tool_use_id
          ? activeSubagents.get(msg.parent_tool_use_id) || 'subagent'
          : 'ceo';
      } else if (msg.type === 'result') {
        role = 'system';
      }
      // Fire-and-forget
      tracker.logBackgroundMessage(jobId, msg.type, role, formatted);
    }
  };
}

// ---------------------------------------------------------------------------
// 5e-pre. Deliverable collection + upload
// ---------------------------------------------------------------------------

async function collectAndUploadDeliverables(
  orgId: string,
  businessId: string,
  jobId: number,
  sdkSessionId: string,
): Promise<string[]> {
  try {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { storeDeliverable } = await import('../storage/storage-service');

    // SDK workspace directory convention
    const workDir = join(
      process.env.HOME ?? '/tmp',
      '.claude',
      'sessions',
      sdkSessionId,
    );

    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(workDir, { withFileTypes: true, recursive: true });
    } catch {
      return []; // No workspace directory — nothing to upload
    }

    const uploaded: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const file = entry.name;
      // parentPath (Node 21.2+), path (Node 20+), fallback to workDir
      const parentDir = (entry as any).parentPath ?? (entry as any).path ?? workDir;
      const filePath = join(parentDir, file);
      const content = await readFile(filePath);
      // Simple MIME type guessing
      const ext = file.split('.').pop()?.toLowerCase() ?? '';
      const mimeTypes: Record<string, string> = {
        json: 'application/json',
        txt: 'text/plain',
        md: 'text/markdown',
        csv: 'text/csv',
        html: 'text/html',
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        svg: 'image/svg+xml',
      };
      const contentType = mimeTypes[ext] ?? 'application/octet-stream';

      try {
        await storeDeliverable(orgId, businessId, jobId, file, content, contentType);
        uploaded.push(file);
      } catch (err) {
        console.error(`Failed to upload deliverable ${file}:`, (err as Error).message);
      }
    }
    return uploaded;
  } catch {
    return []; // S3 not configured or other error — skip silently
  }
}

// ---------------------------------------------------------------------------
// 5e. BullMQ Queue + Worker setup
// ---------------------------------------------------------------------------

export const BRIEF_QUEUE_NAME = 'aicib:briefs';

// Module-level worker reference for status checks
let briefWorkerRef: Worker<BriefJobData> | null = null;
let activeJobCount = 0;

export function getWorkerStatus(): { running: boolean; activeCount: number } {
  if (!briefWorkerRef) {
    return { running: false, activeCount: 0 };
  }
  return {
    running: briefWorkerRef.isRunning(),
    activeCount: activeJobCount,
  };
}

let briefQueue: Queue<BriefJobData> | null = null;

export function getBriefQueue(): Queue<BriefJobData> {
  if (!briefQueue) {
    briefQueue = new Queue<BriefJobData>(BRIEF_QUEUE_NAME, {
      connection: { url: env.REDIS_URL },
    });
  }
  return briefQueue;
}

let sweepInterval: ReturnType<typeof setInterval> | null = null;

export async function closeBriefQueue(): Promise<void> {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
  if (briefQueue) {
    await briefQueue.close();
    briefQueue = null;
  }
}

/** Sweep stale running jobs older than 15 minutes → failed */
async function sweepStaleJobs(): Promise<void> {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  try {
    // Sweep stale 'running' cloud jobs
    await db
      .update(backgroundJobs)
      .set({
        status: 'failed',
        errorMessage: 'Swept as stale on server restart',
        completedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.status, 'running'),
          lt(backgroundJobs.startedAt, fifteenMinAgo),
        ),
      );

    // Sweep stale 'claimed' daemon jobs (daemon crashed after claiming)
    await db
      .update(backgroundJobs)
      .set({
        status: 'queued',
      })
      .where(
        and(
          eq(backgroundJobs.status, 'claimed'),
          lt(backgroundJobs.startedAt, tenMinAgo),
        ),
      );
  } catch (err) {
    console.error('Stale job sweep error:', (err as Error).message);
  }
}

export async function startBriefWorker(): Promise<Worker<BriefJobData>> {
  // Sweep stale jobs on startup + periodically every 5 minutes
  await sweepStaleJobs();
  sweepInterval = setInterval(() => sweepStaleJobs().catch(console.error), 5 * 60 * 1000);

  briefWorkerRef = new Worker<BriefJobData>(
    BRIEF_QUEUE_NAME,
    async (job) => {
      const data = job.data;
      const tracker = new CloudCostTracker(data.orgId, data.businessId, data.jobId);

      activeJobCount++;

      // Mark job as running
      await tracker.updateBackgroundJob(data.jobId, {
        status: 'running',
        startedAt: new Date(),
      });
      await tracker.setAgentStatus('ceo', 'working');

      try {
        const result = await cloudSendBrief(
          data,
          createMessageCallback(data.jobId, tracker),
        );

        // Record final costs
        await tracker.recordCost(
          'ceo',
          result.sessionId,
          result.inputTokens,
          result.outputTokens,
          result.totalCostUsd,
        );

        // Collect and upload deliverables
        const uploadedFiles = await collectAndUploadDeliverables(
          data.orgId,
          data.businessId,
          data.jobId,
          data.sdkSessionId,
        );

        // Mark completed
        await tracker.updateBackgroundJob(data.jobId, {
          status: 'completed',
          completedAt: new Date(),
          totalCostUsd: result.totalCostUsd,
          numTurns: result.numTurns,
          durationMs: result.durationMs,
          resultSummary: uploadedFiles.length
            ? JSON.stringify({ deliverables: uploadedFiles })
            : null,
        });
        await tracker.setAgentStatus('ceo', 'idle');
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown error';
        console.error(`Brief job ${data.jobId} failed:`, errorMessage);

        await tracker.logBackgroundMessage(
          data.jobId,
          'error',
          'system',
          `Job failed: ${errorMessage}`,
        );
        await tracker.updateBackgroundJob(data.jobId, {
          status: 'failed',
          errorMessage,
          completedAt: new Date(),
        });
        await tracker.setAgentStatus('ceo', 'error');
      } finally {
        activeJobCount--;
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 2,
    },
  );

  briefWorkerRef.on('failed', (job, err) => {
    console.error(`BullMQ job ${job?.id} failed:`, err.message);
  });

  console.log('Brief worker started (concurrency: 2)');
  return briefWorkerRef;
}
