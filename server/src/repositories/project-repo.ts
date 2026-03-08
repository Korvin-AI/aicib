import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { projects, projectPhases } from '../db/schema/index';

export async function getProjects(businessId: string) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.businessId, businessId))
    .orderBy(desc(projects.updatedAt));
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
