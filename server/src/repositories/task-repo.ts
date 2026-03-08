import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { tasks, taskBlockers, taskComments } from '../db/schema/index';

interface TaskFilters {
  status?: string;
  priority?: string;
  assignee?: string;
  department?: string;
  project?: string;
}

export async function getTasks(
  businessId: string,
  filters: TaskFilters,
  pagination: { page: number; pageSize: number; offset: number },
) {
  // Build WHERE conditions
  const conditions = [eq(tasks.businessId, businessId)];

  if (filters.status && filters.status !== 'all') {
    conditions.push(eq(tasks.status, filters.status));
  }
  if (filters.priority && filters.priority !== 'all') {
    conditions.push(eq(tasks.priority, filters.priority));
  }
  if (filters.assignee && filters.assignee !== 'all') {
    if (filters.assignee === 'unassigned') {
      conditions.push(sql`COALESCE(${tasks.assignee}, '') = ''`);
    } else {
      conditions.push(eq(tasks.assignee, filters.assignee));
    }
  }
  if (filters.department && filters.department !== 'all') {
    if (filters.department === 'none') {
      conditions.push(sql`COALESCE(${tasks.department}, '') = ''`);
    } else {
      conditions.push(eq(tasks.department, filters.department));
    }
  }
  if (filters.project && filters.project !== 'all') {
    if (filters.project === 'none') {
      conditions.push(
        sql`LOWER(TRIM(COALESCE(${tasks.project}, ''))) = ''`,
      );
    } else {
      conditions.push(
        sql`LOWER(TRIM(COALESCE(${tasks.project}, ''))) = LOWER(TRIM(${filters.project}))`,
      );
    }
  }

  const whereClause = and(...conditions)!;

  // Count for pagination
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(tasks)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  // Main query with subquery counts for blockers and comments
  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      assignee: tasks.assignee,
      reviewer: tasks.reviewer,
      department: tasks.department,
      project: tasks.project,
      parentId: tasks.parentId,
      deadline: tasks.deadline,
      createdBy: tasks.createdBy,
      sessionId: tasks.sessionId,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      completedAt: tasks.completedAt,
      outputSummary: tasks.outputSummary,
      blockerCount: sql<number>`(SELECT COUNT(*)::int FROM ${taskBlockers} WHERE ${taskBlockers.taskId} = ${tasks.id})`,
      commentCount: sql<number>`(SELECT COUNT(*)::int FROM ${taskComments} WHERE ${taskComments.taskId} = ${tasks.id})`,
    })
    .from(tasks)
    .where(whereClause)
    .orderBy(
      sql`CASE ${tasks.priority}
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END`,
      desc(tasks.updatedAt),
      desc(tasks.id),
    )
    .limit(pagination.pageSize)
    .offset(pagination.offset);

  // Status counts (always unfiltered for the business)
  const statusCounts = await db
    .select({
      status: tasks.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(tasks)
    .where(eq(tasks.businessId, businessId))
    .groupBy(tasks.status);

  const statusMap: Record<string, number> = {};
  for (const sc of statusCounts) {
    statusMap[sc.status] = sc.count;
  }

  // Filter options
  const assignees = await db
    .selectDistinct({ assignee: tasks.assignee })
    .from(tasks)
    .where(eq(tasks.businessId, businessId))
    .orderBy(tasks.assignee);

  const departments = await db
    .selectDistinct({ department: tasks.department })
    .from(tasks)
    .where(eq(tasks.businessId, businessId))
    .orderBy(tasks.department);

  const projects = await db
    .selectDistinct({ project: tasks.project })
    .from(tasks)
    .where(eq(tasks.businessId, businessId))
    .orderBy(tasks.project);

  return {
    tasks: taskRows.map((t) => ({
      ...t,
      blocker_count: t.blockerCount,
      comment_count: t.commentCount,
    })),
    statusCounts: {
      backlog: statusMap['backlog'] ?? 0,
      todo: statusMap['todo'] ?? 0,
      in_progress: statusMap['in_progress'] ?? 0,
      in_review: statusMap['in_review'] ?? 0,
      done: statusMap['done'] ?? 0,
      cancelled: statusMap['cancelled'] ?? 0,
    },
    filters: {
      assignees: assignees
        .map((a) => a.assignee)
        .filter((a): a is string => !!a),
      departments: departments
        .map((d) => d.department)
        .filter((d): d is string => !!d),
      projects: projects
        .map((p) => p.project)
        .filter((p): p is string => !!p),
    },
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    },
  };
}
