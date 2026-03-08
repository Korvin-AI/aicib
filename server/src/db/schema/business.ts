import { pgTable, uuid, varchar, jsonb, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { organizations } from './auth';

export const executionModeEnum = pgEnum('execution_mode', ['cloud', 'local']);

export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  template: varchar('template', { length: 100 }),
  config: jsonb('config').$type<Record<string, unknown>>(),
  agentDefinitions: jsonb('agent_definitions').$type<
    Array<{
      role: string;
      model?: string;
      department?: string;
      enabled?: boolean;
      displayName?: string | null;
    }>
  >(),
  executionMode: executionModeEnum('execution_mode')
    .notNull()
    .default('cloud'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
