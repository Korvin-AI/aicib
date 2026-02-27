import type Database from "better-sqlite3";
import { safeAll, safeGet, tableExists } from "@/lib/api-helpers";

export type DashboardChannelKind = "general" | "role" | "department";

export interface DashboardChannelDefinition {
  id: string;
  name: string;
  kind: DashboardChannelKind;
  roles: string[];
  description: string;
}

export interface ChannelSummary extends DashboardChannelDefinition {
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
}

export interface ChannelThreadEntry {
  id: string;
  createdAt: string;
  authorType: "user" | "agent" | "system";
  authorRole: string | null;
  text: string;
  jobId: number | null;
  messageType: string;
  jobStatus: string | null;
  channelId: string;
}

interface JobRow {
  id: number;
  directive: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

interface LogRow {
  id: number;
  job_id: number | null;
  timestamp: string;
  message_type: string;
  agent_role: string | null;
  content: string;
  job_status: string | null;
  job_directive: string | null;
}

const CHANNEL_PREFIX = /^\s*\[channel:([a-z0-9_-]+)\]\s*/i;
const CHANNEL_THREAD_CACHE_TTL_MS = 1500;

interface ChannelThreadCacheEntry {
  cacheKey: string;
  cachedAtMs: number;
  entries: ChannelThreadEntry[];
}

let channelThreadCache: ChannelThreadCacheEntry | null = null;

export const DASHBOARD_CHANNELS: DashboardChannelDefinition[] = [
  {
    id: "general",
    name: "#general",
    kind: "general",
    roles: [],
    description: "Company-wide communication and general instructions.",
  },
  {
    id: "ceo",
    name: "#ceo",
    kind: "role",
    roles: ["ceo"],
    description: "Direct strategic communication with the CEO.",
  },
  {
    id: "cto",
    name: "#cto",
    kind: "role",
    roles: ["cto"],
    description: "Direct communication with the CTO.",
  },
  {
    id: "cfo",
    name: "#cfo",
    kind: "role",
    roles: ["cfo"],
    description: "Direct communication with the CFO.",
  },
  {
    id: "cmo",
    name: "#cmo",
    kind: "role",
    roles: ["cmo"],
    description: "Direct communication with the CMO.",
  },
  {
    id: "engineering",
    name: "#engineering",
    kind: "department",
    roles: ["cto", "backend-engineer", "frontend-engineer"],
    description: "Engineering execution and technical delivery.",
  },
  {
    id: "marketing",
    name: "#marketing",
    kind: "department",
    roles: ["cmo", "content-writer"],
    description: "Marketing and content execution.",
  },
  {
    id: "finance",
    name: "#finance",
    kind: "department",
    roles: ["cfo", "financial-analyst"],
    description: "Finance and spending operations.",
  },
];

const ROLE_CHANNEL_MAP: Record<string, string> = {
  ceo: "ceo",
  cto: "cto",
  cfo: "cfo",
  cmo: "cmo",
  "backend-engineer": "engineering",
  "frontend-engineer": "engineering",
  "financial-analyst": "finance",
  "content-writer": "marketing",
};

const CHANNEL_IDS = new Set(DASHBOARD_CHANNELS.map((channel) => channel.id));

export function getChannelDefinition(channelId: string): DashboardChannelDefinition | null {
  return DASHBOARD_CHANNELS.find((channel) => channel.id === channelId) ?? null;
}

export function extractChannelPrefix(directive: string | null | undefined): {
  channelId: string | null;
  text: string;
} {
  const raw = (directive || "").trim();
  if (!raw) return { channelId: null, text: "" };

  const match = raw.match(CHANNEL_PREFIX);
  if (!match) return { channelId: null, text: raw };

  const candidate = match[1].toLowerCase();
  const channelId = CHANNEL_IDS.has(candidate) ? candidate : null;
  const text = raw.replace(CHANNEL_PREFIX, "").trim();

  return { channelId, text };
}

export function resolveFallbackChannelByRole(agentRole: string | null | undefined): string {
  if (!agentRole) return "general";
  return ROLE_CHANNEL_MAP[agentRole] || "general";
}

function getMaxId(db: Database.Database, tableName: string): number {
  return (
    safeGet<{ max_id: number }>(
      db,
      tableName,
      `SELECT COALESCE(MAX(id), 0) as max_id FROM ${tableName}`
    )?.max_id ?? 0
  );
}

function getChannelThreadCacheKey(
  db: Database.Database,
  hasJobs: boolean,
  hasLogs: boolean
): string {
  const jobsMaxId = hasJobs ? getMaxId(db, "background_jobs") : 0;
  const logsMaxId = hasLogs ? getMaxId(db, "background_logs") : 0;
  return `jobs:${hasJobs ? 1 : 0}:${jobsMaxId}|logs:${hasLogs ? 1 : 0}:${logsMaxId}`;
}

export function buildChannelThreadEntries(db: Database.Database): ChannelThreadEntry[] {
  const hasJobs = tableExists(db, "background_jobs");
  const hasLogs = tableExists(db, "background_logs");

  if (!hasJobs && !hasLogs) return [];

  const now = Date.now();
  const cacheKey = getChannelThreadCacheKey(db, hasJobs, hasLogs);
  if (
    channelThreadCache &&
    channelThreadCache.cacheKey === cacheKey &&
    now - channelThreadCache.cachedAtMs <= CHANNEL_THREAD_CACHE_TTL_MS
  ) {
    return channelThreadCache.entries;
  }

  const jobs = hasJobs
    ? safeAll<JobRow>(
        db,
        "background_jobs",
        `SELECT id, directive, status, started_at, completed_at
         FROM background_jobs
         ORDER BY id DESC
         LIMIT 300`
      )
    : [];

  const logs = hasLogs
    ? safeAll<LogRow>(
        db,
        "background_logs",
        `SELECT
          l.id,
          l.job_id,
          l.timestamp,
          l.message_type,
          l.agent_role,
          l.content,
          j.status as job_status,
          j.directive as job_directive
        FROM background_logs l
        LEFT JOIN background_jobs j ON j.id = l.job_id
        ORDER BY l.id DESC
        LIMIT 1000`
      )
    : [];

  const entries: ChannelThreadEntry[] = [];

  for (const job of jobs) {
    const parsed = extractChannelPrefix(job.directive);
    entries.push({
      id: `job-${job.id}-directive`,
      createdAt: job.started_at || job.completed_at || "",
      authorType: "user",
      authorRole: null,
      text: parsed.text || job.directive || "",
      jobId: job.id,
      messageType: "directive",
      jobStatus: job.status || null,
      channelId: parsed.channelId || "general",
    });
  }

  for (const log of logs) {
    const parsed = extractChannelPrefix(log.job_directive || "");
    entries.push({
      id: `log-${log.id}`,
      createdAt: log.timestamp || "",
      authorType: log.agent_role ? "agent" : "system",
      authorRole: log.agent_role || null,
      text: log.content || "",
      jobId: log.job_id ?? null,
      messageType: log.message_type || "status",
      jobStatus: log.job_status || null,
      channelId: parsed.channelId || resolveFallbackChannelByRole(log.agent_role),
    });
  }

  entries.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.id.localeCompare(b.id);
  });

  channelThreadCache = {
    cacheKey,
    cachedAtMs: now,
    entries,
  };

  return entries;
}

export function buildChannelSummaries(entries: ChannelThreadEntry[]): ChannelSummary[] {
  return DASHBOARD_CHANNELS.map((channel) => {
    const channelEntries = entries.filter((entry) => entry.channelId === channel.id);
    const last = channelEntries[channelEntries.length - 1];

    return {
      ...channel,
      lastMessageAt: last?.createdAt || null,
      lastMessagePreview: last?.text?.slice(0, 140) || null,
      messageCount: channelEntries.length,
    };
  });
}
