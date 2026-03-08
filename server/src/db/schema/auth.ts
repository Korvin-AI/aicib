import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';

// --- Enums ---

export const orgPlanEnum = pgEnum('org_plan', [
  'free',
  'pro',
  'team',
  'enterprise',
]);

export const orgRoleEnum = pgEnum('org_role', [
  'owner',
  'admin',
  'member',
  'viewer',
]);

// --- Tables ---

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: varchar('display_name', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('users_email_idx').on(t.email),
]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  plan: orgPlanEnum('plan').notNull().default('free'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('organizations_slug_idx').on(t.slug),
]);

export const orgMemberships = pgTable('org_memberships', {
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  role: orgRoleEnum('role').notNull().default('member'),
}, (t) => [
  uniqueIndex('org_memberships_user_org_idx').on(t.userId, t.orgId),
]);

export const authSessions = pgTable('auth_sessions', {
  token: varchar('token', { length: 128 }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
