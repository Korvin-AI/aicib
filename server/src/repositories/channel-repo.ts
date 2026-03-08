import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { backgroundJobs, backgroundLogs } from '../db/schema/index';

// --- Channel definitions (ported from ui/lib/channels.ts) ---

export interface DashboardChannelDefinition {
  id: string;
  name: string;
  kind: 'general' | 'role' | 'department';
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
  authorType: 'user' | 'agent' | 'system';
  authorRole: string | null;
  text: string;
  jobId: number | null;
  messageType: string;
  jobStatus: string | null;
  channelId: string;
}

const DASHBOARD_CHANNELS: DashboardChannelDefinition[] = [
  { id: 'general', name: '#general', kind: 'general', roles: [], description: 'Company-wide communication and general instructions.' },
  { id: 'ceo', name: '#ceo', kind: 'role', roles: ['ceo'], description: 'Direct strategic communication with the CEO.' },
  { id: 'cto', name: '#cto', kind: 'role', roles: ['cto'], description: 'Direct communication with the CTO.' },
  { id: 'cfo', name: '#cfo', kind: 'role', roles: ['cfo'], description: 'Direct communication with the CFO.' },
  { id: 'cmo', name: '#cmo', kind: 'role', roles: ['cmo'], description: 'Direct communication with the CMO.' },
  { id: 'engineering', name: '#engineering', kind: 'department', roles: ['cto', 'backend-engineer', 'frontend-engineer'], description: 'Engineering execution and technical delivery.' },
  { id: 'marketing', name: '#marketing', kind: 'department', roles: ['cmo', 'content-writer'], description: 'Marketing and content execution.' },
  { id: 'finance', name: '#finance', kind: 'department', roles: ['cfo', 'financial-analyst'], description: 'Finance and spending operations.' },
];

const ROLE_CHANNEL_MAP: Record<string, string> = {
  ceo: 'ceo',
  cto: 'cto',
  cfo: 'cfo',
  cmo: 'cmo',
  'backend-engineer': 'engineering',
  'frontend-engineer': 'engineering',
  'financial-analyst': 'finance',
  'content-writer': 'marketing',
};

const CHANNEL_IDS = new Set(DASHBOARD_CHANNELS.map((ch) => ch.id));
const CHANNEL_PREFIX = /^\s*\[channel:([a-z0-9_-]+)\]\s*/i;

function extractChannelPrefix(directive: string | null | undefined): { channelId: string | null; text: string } {
  const raw = (directive || '').trim();
  if (!raw) return { channelId: null, text: '' };
  const match = raw.match(CHANNEL_PREFIX);
  if (!match) return { channelId: null, text: raw };
  const candidate = match[1].toLowerCase();
  return {
    channelId: CHANNEL_IDS.has(candidate) ? candidate : null,
    text: raw.replace(CHANNEL_PREFIX, '').trim(),
  };
}

function resolveFallbackChannelByRole(agentRole: string | null | undefined): string {
  if (!agentRole) return 'general';
  return ROLE_CHANNEL_MAP[agentRole] || 'general';
}

export async function getChannelEntries(businessId: string): Promise<ChannelThreadEntry[]> {
  const [jobs, logs] = await Promise.all([
    db
      .select({
        id: backgroundJobs.id,
        directive: backgroundJobs.directive,
        status: backgroundJobs.status,
        startedAt: backgroundJobs.startedAt,
        completedAt: backgroundJobs.completedAt,
      })
      .from(backgroundJobs)
      .where(eq(backgroundJobs.businessId, businessId))
      .orderBy(desc(backgroundJobs.id))
      .limit(300),
    db
      .select({
        id: backgroundLogs.id,
        jobId: backgroundLogs.jobId,
        timestamp: backgroundLogs.timestamp,
        messageType: backgroundLogs.messageType,
        agentRole: backgroundLogs.agentRole,
        content: backgroundLogs.content,
        jobStatus: backgroundJobs.status,
        jobDirective: backgroundJobs.directive,
      })
      .from(backgroundLogs)
      .leftJoin(backgroundJobs, eq(backgroundLogs.jobId, backgroundJobs.id))
      .where(eq(backgroundLogs.businessId, businessId))
      .orderBy(desc(backgroundLogs.id))
      .limit(1000),
  ]);

  const entries: ChannelThreadEntry[] = [];

  for (const job of jobs) {
    const parsed = extractChannelPrefix(job.directive);
    entries.push({
      id: `job-${job.id}-directive`,
      createdAt: (job.startedAt || job.completedAt || new Date()).toISOString(),
      authorType: 'user',
      authorRole: null,
      text: parsed.text || job.directive || '',
      jobId: job.id,
      messageType: 'directive',
      jobStatus: job.status || null,
      channelId: parsed.channelId || 'general',
    });
  }

  for (const log of logs) {
    const parsed = extractChannelPrefix(log.jobDirective || '');
    entries.push({
      id: `log-${log.id}`,
      createdAt: log.timestamp.toISOString(),
      authorType: log.agentRole ? 'agent' : 'system',
      authorRole: log.agentRole || null,
      text: log.content || '',
      jobId: log.jobId ?? null,
      messageType: log.messageType || 'status',
      jobStatus: log.jobStatus || null,
      channelId: parsed.channelId || resolveFallbackChannelByRole(log.agentRole),
    });
  }

  entries.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.id.localeCompare(b.id);
  });

  return entries;
}

export async function getChannelSummaries(businessId: string): Promise<ChannelSummary[]> {
  const entries = await getChannelEntries(businessId);
  return DASHBOARD_CHANNELS.map((channel) => {
    const channelEntries = entries.filter((e) => e.channelId === channel.id);
    const last = channelEntries[channelEntries.length - 1];
    return {
      ...channel,
      lastMessageAt: last?.createdAt || null,
      lastMessagePreview: last?.text?.slice(0, 140) || null,
      messageCount: channelEntries.length,
    };
  });
}

export function getChannelDefinition(channelId: string): DashboardChannelDefinition | null {
  return DASHBOARD_CHANNELS.find((ch) => ch.id === channelId) ?? null;
}
