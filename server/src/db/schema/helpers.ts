import { uuid } from 'drizzle-orm/pg-core';
import { organizations } from './auth';
import { businesses } from './business';

/** Common org_id + business_id FK columns for multi-tenant tables */
export function tenantCols() {
  return {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
  } as const;
}
