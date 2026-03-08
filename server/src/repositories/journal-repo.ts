import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { ceoJournal, agentJournals, decisionLog } from '../db/schema/index';

interface JournalFilters {
  tab: string;
  limit: number;
  agent?: string;
  type?: string;
  status?: string;
  department?: string;
}

export async function getJournal(businessId: string, filters: JournalFilters) {
  const { tab, limit } = filters;

  if (tab === 'ceo') {
    const entries = await db
      .select()
      .from(ceoJournal)
      .where(eq(ceoJournal.businessId, businessId))
      .orderBy(desc(ceoJournal.createdAt), desc(ceoJournal.id))
      .limit(limit);

    return { tab: 'ceo', entries };
  }

  if (tab === 'agents') {
    const conditions = [eq(agentJournals.businessId, businessId)];
    if (filters.agent && filters.agent !== 'all') {
      conditions.push(eq(agentJournals.agentRole, filters.agent));
    }
    if (filters.type && filters.type !== 'all') {
      conditions.push(eq(agentJournals.entryType, filters.type));
    }

    const entries = await db
      .select()
      .from(agentJournals)
      .where(and(...conditions))
      .orderBy(desc(agentJournals.createdAt), desc(agentJournals.id))
      .limit(limit);

    // Filter options
    const agents = await db
      .selectDistinct({ agentRole: agentJournals.agentRole })
      .from(agentJournals)
      .where(eq(agentJournals.businessId, businessId))
      .orderBy(agentJournals.agentRole);

    const types = await db
      .selectDistinct({ entryType: agentJournals.entryType })
      .from(agentJournals)
      .where(eq(agentJournals.businessId, businessId))
      .orderBy(agentJournals.entryType);

    return {
      tab: 'agents',
      entries,
      filters: {
        agents: agents.map((a) => a.agentRole),
        types: types
          .map((t) => t.entryType)
          .filter((t): t is string => !!t),
      },
    };
  }

  // tab === 'decisions' (default)
  const conditions = [eq(decisionLog.businessId, businessId)];
  if (filters.status && filters.status !== 'all') {
    conditions.push(eq(decisionLog.status, filters.status));
  }
  if (filters.department && filters.department !== 'all') {
    if (filters.department === 'none') {
      conditions.push(sql`COALESCE(${decisionLog.department}, '') = ''`);
    } else {
      conditions.push(eq(decisionLog.department, filters.department));
    }
  }

  const entries = await db
    .select()
    .from(decisionLog)
    .where(and(...conditions))
    .orderBy(desc(decisionLog.createdAt), desc(decisionLog.id))
    .limit(limit);

  // Filter options
  const statuses = await db
    .selectDistinct({ status: decisionLog.status })
    .from(decisionLog)
    .where(eq(decisionLog.businessId, businessId))
    .orderBy(decisionLog.status);

  const departments = await db
    .selectDistinct({ department: decisionLog.department })
    .from(decisionLog)
    .where(eq(decisionLog.businessId, businessId))
    .orderBy(decisionLog.department);

  return {
    tab: 'decisions',
    entries,
    filters: {
      statuses: statuses
        .map((s) => s.status)
        .filter((s): s is string => !!s),
      departments: departments
        .map((d) => d.department)
        .filter((d): d is string => !!d),
    },
  };
}
