import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection';
import { businesses, sessions } from '../db/schema/index';

export async function findBusinessesByOrg(orgId: string) {
  return db
    .select({
      id: businesses.id,
      name: businesses.name,
      template: businesses.template,
      executionMode: businesses.executionMode,
      createdAt: businesses.createdAt,
    })
    .from(businesses)
    .where(eq(businesses.orgId, orgId));
}

export async function findBusinessById(businessId: string) {
  const [biz] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return biz ?? null;
}

export async function createBusiness(
  orgId: string,
  data: { name: string; template?: string; config?: Record<string, unknown> },
) {
  const [biz] = await db
    .insert(businesses)
    .values({
      orgId,
      name: data.name,
      template: data.template ?? 'default',
      config: data.config ?? {},
      executionMode: 'cloud',
    })
    .returning();
  return biz;
}

export async function deleteBusiness(orgId: string, businessId: string) {
  const [deleted] = await db
    .delete(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.orgId, orgId)))
    .returning({ id: businesses.id });
  return deleted ?? null;
}

export async function createSession(
  businessId: string,
  orgId: string,
  sessionId?: string,
) {
  const id = sessionId || `cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [session] = await db
    .insert(sessions)
    .values({
      id,
      orgId,
      businessId,
      status: 'active',
    })
    .returning();
  return session;
}

export async function stopSession(businessId: string, sessionId?: string) {
  if (sessionId) {
    const [updated] = await db
      .update(sessions)
      .set({ status: 'stopped', endedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.businessId, businessId)))
      .returning();
    return updated ?? null;
  }
  // Stop all active sessions for the business
  await db
    .update(sessions)
    .set({ status: 'stopped', endedAt: new Date() })
    .where(and(eq(sessions.businessId, businessId), eq(sessions.status, 'active')));
  return { stopped: true };
}

export async function getActiveSession(businessId: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.businessId, businessId), eq(sessions.status, 'active')))
    .limit(1);
  return session ?? null;
}

export async function updateBusinessConfig(
  businessId: string,
  config: Record<string, unknown>,
) {
  const [updated] = await db
    .update(businesses)
    .set({ config })
    .where(eq(businesses.id, businessId))
    .returning();
  return updated ?? null;
}
