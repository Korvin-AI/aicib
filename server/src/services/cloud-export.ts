import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  costEntries,
  sessions,
  agentStatus,
  sessionData,
  backgroundJobs,
  backgroundLogs,
  ceoJournal,
  tasks,
  taskBlockers,
  taskComments,
  agentJournals,
  decisionLog,
  hrOnboarding,
  hrReviews,
  companyEvents,
  eventInstances,
  notifications,
  notificationPreferences,
  projects,
  projectPhases,
  safeguardPending,
  externalActions,
  reports,
  autoReviewQueue,
  escalationEvents,
  mcpIntegrations,
  hrEvents,
  hrImprovementPlans,
  wikiArticles,
  wikiArticleVersions,
  projectArchives,
} from '../db/schema/index';

const CATEGORY_TABLES: Record<string, { name: string; table: any }[]> = {
  costs: [{ name: 'cost_entries', table: costEntries }],
  sessions: [
    { name: 'sessions', table: sessions },
    { name: 'session_data', table: sessionData },
  ],
  agents: [
    { name: 'agent_status', table: agentStatus },
    { name: 'agent_journals', table: agentJournals },
  ],
  tasks: [
    { name: 'tasks', table: tasks },
    { name: 'task_blockers', table: taskBlockers },
    { name: 'task_comments', table: taskComments },
  ],
  jobs: [
    { name: 'background_jobs', table: backgroundJobs },
    { name: 'background_logs', table: backgroundLogs },
  ],
  journal: [
    { name: 'ceo_journal', table: ceoJournal },
    { name: 'decision_log', table: decisionLog },
  ],
  hr: [
    { name: 'hr_onboarding', table: hrOnboarding },
    { name: 'hr_reviews', table: hrReviews },
    { name: 'hr_events', table: hrEvents },
    { name: 'hr_improvement_plans', table: hrImprovementPlans },
  ],
  events: [
    { name: 'company_events', table: companyEvents },
    { name: 'event_instances', table: eventInstances },
  ],
  notifications: [
    { name: 'notifications', table: notifications },
    { name: 'notification_preferences', table: notificationPreferences },
  ],
  projects: [
    { name: 'projects', table: projects },
    { name: 'project_phases', table: projectPhases },
  ],
  safeguards: [
    { name: 'safeguard_pending', table: safeguardPending },
    { name: 'external_actions', table: externalActions },
  ],
  reports: [{ name: 'reports', table: reports }],
  reviews: [{ name: 'auto_review_queue', table: autoReviewQueue }],
  escalations: [{ name: 'escalation_events', table: escalationEvents }],
  integrations: [{ name: 'mcp_integrations', table: mcpIntegrations }],
  knowledge: [
    { name: 'wiki_articles', table: wikiArticles },
    { name: 'wiki_article_versions', table: wikiArticleVersions },
    { name: 'project_archives', table: projectArchives },
  ],
};

export interface ExportOptions {
  businessId: string;
  mode: 'full' | 'selective' | 'anonymized';
  categories?: string[];
}

export interface ExportData {
  manifest: {
    version: string;
    exportedAt: string;
    businessId: string;
    mode: string;
    categories: string[];
    tableCounts: Record<string, number>;
    truncatedTables?: string[];
  };
  data: Record<string, unknown[]>;
}

const EXPORT_ROW_LIMIT = 100_000;

export async function buildExportData(opts: ExportOptions): Promise<ExportData> {
  const selectedCategories =
    opts.mode === 'full' || !opts.categories?.length
      ? Object.keys(CATEGORY_TABLES)
      : opts.categories.filter((c) => c in CATEGORY_TABLES);

  const data: Record<string, unknown[]> = {};
  const tableCounts: Record<string, number> = {};
  const truncatedTables: string[] = [];

  for (const cat of selectedCategories) {
    const entries = CATEGORY_TABLES[cat];
    if (!entries) continue;

    for (const { name, table } of entries) {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.businessId, opts.businessId))
        .limit(EXPORT_ROW_LIMIT);

      if (rows.length === EXPORT_ROW_LIMIT) {
        truncatedTables.push(name);
      }

      let processed = rows;
      if (opts.mode === 'anonymized') {
        processed = rows.map((row: Record<string, unknown>) => {
          const copy = { ...row };
          for (const key of Object.keys(copy)) {
            if (['email', 'ipAddress', 'userAgent'].includes(key)) {
              copy[key] = '[REDACTED]';
            }
          }
          return copy;
        });
      }

      data[name] = processed;
      tableCounts[name] = processed.length;
    }
  }

  return {
    manifest: {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      businessId: opts.businessId,
      mode: opts.mode,
      categories: selectedCategories,
      tableCounts,
      ...(truncatedTables.length > 0 ? { truncatedTables } : {}),
    },
    data,
  };
}

export async function buildExportArchive(opts: ExportOptions): Promise<Buffer> {
  const { default: archiver } = await import('archiver');
  const exportData = await buildExportData(opts);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('tar', { gzip: true });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Add manifest
    archive.append(JSON.stringify(exportData.manifest, null, 2), {
      name: 'manifest.json',
    });

    // Add data files
    for (const [tableName, rows] of Object.entries(exportData.data)) {
      archive.append(JSON.stringify(rows, null, 2), {
        name: `data/${tableName}.json`,
      });
    }

    archive.finalize();
  });
}
