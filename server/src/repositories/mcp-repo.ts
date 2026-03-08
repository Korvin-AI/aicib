import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { mcpIntegrations } from '../db/schema/index';

export async function getMCPIntegrations(businessId: string) {
  return db
    .select()
    .from(mcpIntegrations)
    .where(eq(mcpIntegrations.businessId, businessId))
    .orderBy(desc(mcpIntegrations.updatedAt));
}
