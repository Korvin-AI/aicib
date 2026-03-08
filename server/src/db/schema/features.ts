import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  bigserial,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenantCols } from './helpers';

// --- company_events ---
export const companyEvents = pgTable('company_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  name: varchar('name', { length: 255 }).notNull(),
  eventType: varchar('event_type', { length: 100 }),
  scheduleId: integer('schedule_id'),
  cronExpression: varchar('cron_expression', { length: 100 }),
  discussionFormat: varchar('discussion_format', { length: 100 }),
  participantsConfig: jsonb('participants_config'),
  enabled: boolean('enabled').default(true),
  runCount: integer('run_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- event_instances ---
export const eventInstances = pgTable('event_instances', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  eventId: integer('event_id').notNull(),
  status: varchar('status', { length: 50 }),
  participants: jsonb('participants'),
  agenda: text('agenda'),
  minutes: text('minutes'),
  actionItems: jsonb('action_items'),
  summary: text('summary'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- notifications ---
export const notifications = pgTable('notifications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  title: varchar('title', { length: 500 }),
  body: text('body'),
  urgency: varchar('urgency', { length: 50 }),
  category: varchar('category', { length: 100 }),
  sourceAgent: varchar('source_agent', { length: 100 }),
  targetAgent: varchar('target_agent', { length: 100 }),
  status: varchar('status', { length: 50 }).default('unread'),
  deliveryChannel: varchar('delivery_channel', { length: 50 }),
  metadata: jsonb('metadata'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- notification_preferences ---
export const notificationPreferences = pgTable('notification_preferences', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  scope: varchar('scope', { length: 50 }).notNull(),
  scopeValue: varchar('scope_value', { length: 255 }),
  minPushUrgency: varchar('min_push_urgency', { length: 50 }),
  digestFrequency: varchar('digest_frequency', { length: 50 }),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('notif_prefs_business_scope_idx').on(t.businessId, t.scope, t.scopeValue),
]);

// --- projects ---
export const projects = pgTable('projects', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  sessionId: varchar('session_id', { length: 255 }),
  title: varchar('title', { length: 500 }).notNull(),
  originalBrief: text('original_brief'),
  status: varchar('status', { length: 50 }).default('planning'),
  totalPhases: integer('total_phases'),
  completedPhases: integer('completed_phases').default(0),
  totalCostUsd: doublePrecision('total_cost_usd').default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- project_phases ---
export const projectPhases = pgTable('project_phases', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  projectId: integer('project_id').notNull(),
  phaseNumber: integer('phase_number').notNull(),
  title: varchar('title', { length: 500 }),
  objective: text('objective'),
  acceptanceCriteria: text('acceptance_criteria'),
  status: varchar('status', { length: 50 }).default('pending'),
  sdkSessionId: varchar('sdk_session_id', { length: 255 }),
  attempt: integer('attempt').default(0),
  maxAttempts: integer('max_attempts').default(3),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('project_phases_project_phase_idx').on(t.projectId, t.phaseNumber),
]);

// --- safeguard_pending ---
export const safeguardPending = pgTable('safeguard_pending', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  agentRole: varchar('agent_role', { length: 100 }),
  category: varchar('category', { length: 100 }),
  description: text('description'),
  approvalChain: jsonb('approval_chain'),
  currentStep: integer('current_step').default(0),
  status: varchar('status', { length: 50 }).default('pending'),
  approvals: jsonb('approvals'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- external_actions ---
export const externalActions = pgTable('external_actions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  agentRole: varchar('agent_role', { length: 100 }),
  category: varchar('category', { length: 100 }),
  description: text('description'),
  outcome: text('outcome'),
  approvedBy: varchar('approved_by', { length: 100 }),
  rejectedBy: varchar('rejected_by', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- reports ---
export const reports = pgTable('reports', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  reportType: varchar('report_type', { length: 100 }),
  title: varchar('title', { length: 500 }),
  authorAgent: varchar('author_agent', { length: 100 }),
  content: text('content'),
  metricsSnapshot: jsonb('metrics_snapshot'),
  status: varchar('status', { length: 50 }).default('draft'),
  deliveryMethod: varchar('delivery_method', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- auto_review_queue ---
export const autoReviewQueue = pgTable('auto_review_queue', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  agentRole: varchar('agent_role', { length: 100 }),
  triggerEvent: varchar('trigger_event', { length: 100 }),
  triggerData: jsonb('trigger_data'),
  status: varchar('status', { length: 50 }).default('pending'),
  reviewId: integer('review_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- escalation_events ---
export const escalationEvents = pgTable('escalation_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  sessionId: varchar('session_id', { length: 255 }),
  fromAgent: varchar('from_agent', { length: 100 }),
  toAgent: varchar('to_agent', { length: 100 }),
  step: integer('step'),
  priority: varchar('priority', { length: 50 }),
  category: varchar('category', { length: 100 }),
  reason: text('reason'),
  resolved: boolean('resolved').default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- mcp_integrations ---
export const mcpIntegrations = pgTable('mcp_integrations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  serverName: varchar('server_name', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).default('inactive'),
  lastUsed: timestamp('last_used', { withTimezone: true }),
  useCount: integer('use_count').default(0),
  errorCount: integer('error_count').default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('mcp_integrations_business_server_idx').on(t.businessId, t.serverName),
]);

// --- hr_events ---
export const hrEvents = pgTable('hr_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  agentRole: varchar('agent_role', { length: 100 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  details: jsonb('details'),
  performedBy: varchar('performed_by', { length: 100 }),
  sessionId: varchar('session_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- hr_improvement_plans ---
export const hrImprovementPlans = pgTable('hr_improvement_plans', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  agentRole: varchar('agent_role', { length: 100 }).notNull(),
  createdBy: varchar('created_by', { length: 100 }),
  goals: jsonb('goals'),
  deadline: timestamp('deadline', { withTimezone: true }),
  status: varchar('status', { length: 50 }).default('active'),
  outcome: text('outcome'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
