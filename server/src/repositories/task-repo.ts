import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { tasks, taskBlockers, taskComments } from '../db/schema/index';

export async function getTask(businessId: string, taskId: number) {
  const [[taskRow], blockerRows, commentRows, subtaskRows] = await Promise.all([
    db
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
        blocker_count: sql<number>`(SELECT COUNT(*)::int FROM ${taskBlockers} WHERE ${taskBlockers.taskId} = ${taskId} AND ${taskBlockers.businessId} = ${businessId})`,
        comment_count: sql<number>`(SELECT COUNT(*)::int FROM ${taskComments} WHERE ${taskComments.taskId} = ${taskId} AND ${taskComments.businessId} = ${businessId})`,
      })
      .from(tasks)
      .where(and(eq(tasks.businessId, businessId), eq(tasks.id, taskId)))
      .limit(1),
    db
      .select({
        blocker_id: taskBlockers.blockerId,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
      })
      .from(taskBlockers)
      .innerJoin(tasks, eq(taskBlockers.blockerId, tasks.id))
      .where(and(eq(taskBlockers.businessId, businessId), eq(taskBlockers.taskId, taskId))),
    db
      .select({
        id: taskComments.id,
        author: taskComments.author,
        content: taskComments.content,
        comment_type: taskComments.commentType,
        created_at: taskComments.createdAt,
      })
      .from(taskComments)
      .where(and(eq(taskComments.businessId, businessId), eq(taskComments.taskId, taskId)))
      .orderBy(taskComments.createdAt),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        assignee: tasks.assignee,
        updated_at: tasks.updatedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.businessId, businessId), eq(tasks.parentId, taskId)))
      .orderBy(desc(tasks.updatedAt)),
  ]);

  if (!taskRow) return null;
  return { task: taskRow, blockers: blockerRows, comments: commentRows, subtasks: subtaskRows };
}

export async function updateTask(
  businessId: string,
  taskId: number,
  updates: Partial<{
    title: string;
    description: string;
    status: string;
    priority: string;
    assignee: string | null;
    reviewer: string | null;
    department: string | null;
    project: string | null;
    deadline: string | null;
    outputSummary: string | null;
  }>,
) {
  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.title !== undefined) setValues.title = updates.title;
  if (updates.description !== undefined) setValues.description = updates.description;
  if (updates.status !== undefined) {
    setValues.status = updates.status;
    if (updates.status === 'done') setValues.completedAt = new Date();
  }
  if (updates.priority !== undefined) setValues.priority = updates.priority;
  if (updates.assignee !== undefined) setValues.assignee = updates.assignee;
  if (updates.reviewer !== undefined) setValues.reviewer = updates.reviewer;
  if (updates.department !== undefined) setValues.department = updates.department;
  if (updates.project !== undefined) setValues.project = updates.project;
  if (updates.deadline !== undefined) setValues.deadline = updates.deadline ? new Date(updates.deadline) : null;
  if (updates.outputSummary !== undefined) setValues.outputSummary = updates.outputSummary;

  const [updated] = await db
    .update(tasks)
    .set(setValues)
    .where(and(eq(tasks.businessId, businessId), eq(tasks.id, taskId)))
    .returning();

  return updated ?? null;
}

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
