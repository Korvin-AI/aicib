import { eq, and, SQL } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';

/** Simple eq(col, businessId) wrapper */
export function tenantWhere(col: PgColumn, businessId: string) {
  return eq(col, businessId);
}

/** Combines tenant filter with additional conditions */
export function tenantAnd(col: PgColumn, businessId: string, conditions: SQL[]) {
  return and(eq(col, businessId), ...conditions)!;
}

/** Returns org_id + business_id values for insert spreads */
export function tenantValues(orgId: string, businessId: string) {
  return { orgId, businessId };
}
