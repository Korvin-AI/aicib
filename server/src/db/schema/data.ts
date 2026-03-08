import {
  pgTable,
  varchar,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  bigserial,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { tenantCols } from './helpers';

// --- cost_entries ---
export const costEntries = pgTable('cost_entries', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  agentRole: varchar('agent_role', { length: 100 }),
  sessionId: varchar('session_id', { length: 255 }),
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  estimatedCostUsd: doublePrecision('estimated_cost_usd').default(0),
  timestamp: timestamp('timestamp', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- sessions ---
export const sessions = pgTable('sessions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  ...tenantCols(),
  startedAt: timestamp('started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  status: varchar('status', { length: 50 }).default('active'),
});

// --- agent_status ---
export const agentStatus = pgTable('agent_status', {
  agentRole: varchar('agent_role', { length: 100 }).notNull(),
  ...tenantCols(),
  status: varchar('status', { length: 50 }).default('stopped'),
  lastActivity: timestamp('last_activity', { withTimezone: true }),
  currentTask: text('current_task'),
}, (t) => [primaryKey({ columns: [t.businessId, t.agentRole] })]);

// --- session_data ---
export const sessionData = pgTable('session_data', {
  sessionId: varchar('session_id', { length: 255 }).primaryKey(),
  ...tenantCols(),
  sdkSessionId: varchar('sdk_session_id', { length: 255 }),
  projectDir: text('project_dir'),
  companyName: varchar('company_name', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- background_jobs ---
export const backgroundJobs = pgTable('background_jobs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  sessionId: varchar('session_id', { length: 255 }),
  directive: text('directive'),
  status: varchar('status', { length: 50 }),
  pid: integer('pid'),
  startedAt: timestamp('started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  resultSummary: text('result_summary'),
  errorMessage: text('error_message'),
  totalCostUsd: doublePrecision('total_cost_usd'),
  numTurns: integer('num_turns'),
  durationMs: integer('duration_ms'),
});

// --- background_logs ---
export const backgroundLogs = pgTable('background_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  jobId: integer('job_id'),
  timestamp: timestamp('timestamp', { withTimezone: true })
    .notNull()
    .defaultNow(),
  messageType: varchar('message_type', { length: 100 }),
  agentRole: varchar('agent_role', { length: 100 }),
  content: text('content'),
});

// --- ceo_journal ---
export const ceoJournal = pgTable('ceo_journal', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  sessionId: varchar('session_id', { length: 255 }),
  directive: text('directive'),
  summary: text('summary'),
  deliverables: jsonb('deliverables'),
  totalCostUsd: doublePrecision('total_cost_usd'),
  numTurns: integer('num_turns'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- tasks ---
export const tasks = pgTable('tasks', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  title: text('title').notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).notNull().default('backlog'),
  priority: varchar('priority', { length: 50 }).notNull().default('medium'),
  assignee: varchar('assignee', { length: 100 }),
  reviewer: varchar('reviewer', { length: 100 }),
  department: varchar('department', { length: 100 }),
  project: varchar('project', { length: 255 }),
  parentId: integer('parent_id'),
  deadline: timestamp('deadline', { withTimezone: true }),
  createdBy: varchar('created_by', { length: 100 }),
  sessionId: varchar('session_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  outputSummary: text('output_summary'),
});

// --- task_blockers ---
export const taskBlockers = pgTable(
  'task_blockers',
  {
    ...tenantCols(),
    taskId: integer('task_id').notNull(),
    blockerId: integer('blocker_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.blockerId] })],
);

// --- task_comments ---
export const taskComments = pgTable('task_comments', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  taskId: integer('task_id').notNull(),
  author: varchar('author', { length: 100 }),
  content: text('content'),
  commentType: varchar('comment_type', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- agent_journals ---
export const agentJournals = pgTable('agent_journals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  agentRole: varchar('agent_role', { length: 100 }).notNull(),
  sessionId: varchar('session_id', { length: 255 }),
  entryType: varchar('entry_type', { length: 50 }),
  title: text('title'),
  content: text('content'),
  tags: jsonb('tags'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- decision_log ---
export const decisionLog = pgTable('decision_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  title: text('title'),
  decidedBy: varchar('decided_by', { length: 100 }),
  department: varchar('department', { length: 100 }),
  optionsConsidered: jsonb('options_considered'),
  reasoning: text('reasoning'),
  outcome: text('outcome'),
  status: varchar('status', { length: 50 }).default('active'),
  sessionId: varchar('session_id', { length: 255 }),
  relatedTaskId: integer('related_task_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- hr_onboarding ---
export const hrOnboarding = pgTable('hr_onboarding', {
  agentRole: varchar('agent_role', { length: 100 }).notNull(),
  ...tenantCols(),
  currentPhase: integer('current_phase').default(1),
  phaseStartedAt: timestamp('phase_started_at', { withTimezone: true }),
  mentor: varchar('mentor', { length: 100 }),
  rampSpeed: varchar('ramp_speed', { length: 50 }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [primaryKey({ columns: [t.businessId, t.agentRole] })]);

// --- hr_reviews ---
export const hrReviews = pgTable('hr_reviews', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  agentRole: varchar('agent_role', { length: 100 }).notNull(),
  reviewer: varchar('reviewer', { length: 100 }),
  reviewType: varchar('review_type', { length: 50 }),
  taskScore: integer('task_score'),
  qualityScore: integer('quality_score'),
  efficiencyScore: integer('efficiency_score'),
  collaborationScore: integer('collaboration_score'),
  overallScore: integer('overall_score'),
  summary: text('summary'),
  recommendation: varchar('recommendation', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
