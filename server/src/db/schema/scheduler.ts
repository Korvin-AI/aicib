import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  bigserial,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenantCols } from './helpers';

// --- schedules ---
export const schedules = pgTable('schedules', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  name: varchar('name', { length: 255 }).notNull(),
  cronExpression: varchar('cron_expression', { length: 100 }),
  agentTarget: varchar('agent_target', { length: 100 }),
  directive: text('directive'),
  enabled: boolean('enabled').default(true),
  status: varchar('status', { length: 50 }).default('idle'),
  triggerType: varchar('trigger_type', { length: 50 }),
  runCount: integer('run_count').default(0),
  totalCostUsd: doublePrecision('total_cost_usd').default(0),
  maxRetries: integer('max_retries').default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- schedule_executions ---
export const scheduleExecutions = pgTable('schedule_executions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  scheduleId: integer('schedule_id').notNull(),
  jobId: integer('job_id'),
  triggerSource: varchar('trigger_source', { length: 100 }),
  status: varchar('status', { length: 50 }),
  costUsd: doublePrecision('cost_usd'),
  numTurns: integer('num_turns'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- scheduler_state ---
export const schedulerState = pgTable('scheduler_state', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  key: varchar('key', { length: 255 }).notNull(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('scheduler_state_business_key_idx').on(t.businessId, t.key),
]);
