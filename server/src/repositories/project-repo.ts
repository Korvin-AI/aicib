import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { projects, projectPhases } from '../db/schema/index';

export async function getProjects(
  businessId: string,
  pagination: { page: number; pageSize: number; offset: number },
) {
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(projects)
    .where(eq(projects.businessId, businessId));
  const total = countResult?.count ?? 0;

  const rows = await db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      businessId: projects.businessId,
      sessionId: projects.sessionId,
      title: projects.title,
      originalBrief: projects.originalBrief,
      status: projects.status,
      totalPhases: projects.totalPhases,
      completedPhases: projects.completedPhases,
      totalCostUsd: projects.totalCostUsd,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      phases_done: projects.completedPhases,
      task_total: sql<number>`(SELECT COUNT(*)::int FROM tasks WHERE business_id = ${businessId} AND LOWER(TRIM(COALESCE(project, ''))) = LOWER(TRIM(${projects.title})))`,
      task_open: sql<number>`(SELECT COUNT(*)::int FROM tasks WHERE business_id = ${businessId} AND LOWER(TRIM(COALESCE(project, ''))) = LOWER(TRIM(${projects.title})) AND status IN ('backlog', 'todo'))`,
      task_in_progress: sql<number>`(SELECT COUNT(*)::int FROM tasks WHERE business_id = ${businessId} AND LOWER(TRIM(COALESCE(project, ''))) = LOWER(TRIM(${projects.title})) AND status = 'in_progress')`,
      task_done: sql<number>`(SELECT COUNT(*)::int FROM tasks WHERE business_id = ${businessId} AND LOWER(TRIM(COALESCE(project, ''))) = LOWER(TRIM(${projects.title})) AND status = 'done')`,
    })
    .from(projects)
    .where(eq(projects.businessId, businessId))
    .orderBy(
      sql`CASE ${projects.status}
        WHEN 'executing' THEN 1
        WHEN 'planning' THEN 2
        WHEN 'paused' THEN 3
        ELSE 4
      END`,
      desc(projects.updatedAt),
    )
    .limit(pagination.pageSize)
    .offset(pagination.offset);

  return {
    entries: rows,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    },
  };
}

export async function getProject(businessId: string, id: number) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.businessId, businessId), eq(projects.id, id)))
    .limit(1);
  return project ?? null;
}

export async function getProjectPhases(businessId: string, projectId: number) {
  return db
    .select()
    .from(projectPhases)
    .where(
      and(
        eq(projectPhases.businessId, businessId),
        eq(projectPhases.projectId, projectId),
      ),
    )
    .orderBy(projectPhases.phaseNumber);
}

export async function updateProject(
  businessId: string,
  id: number,
  updates: Partial<{ title: string; status: string; originalBrief: string }>,
) {
  const [updated] = await db
    .update(projects)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(projects.businessId, businessId), eq(projects.id, id)))
    .returning();
  return updated ?? null;
}
