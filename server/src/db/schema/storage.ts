import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations } from './auth';
import { businesses } from './business';

// --- org_secrets ---
export const orgSecrets = pgTable('org_secrets', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 100 }).notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('org_secrets_org_key_idx').on(t.orgId, t.key),
]);

// --- storage_objects ---
export const storageObjects = pgTable('storage_objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  filename: varchar('filename', { length: 500 }).notNull(),
  contentType: varchar('content_type', { length: 255 }),
  sizeBytes: integer('size_bytes'),
  jobId: integer('job_id'),
  checksum: varchar('checksum', { length: 64 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('storage_objects_key_idx').on(t.objectKey),
]);
