import { eq, and, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../db/connection';
import { storageObjects } from '../db/schema/index';
import { uploadObject, getPresignedDownloadUrl, deleteObject } from './s3-client';
import { getOrgPlan } from '../repositories/org-repo';

// Plan-based size limits
const PLAN_LIMITS: Record<string, { maxFileMB: number; maxTotalMB: number }> = {
  free: { maxFileMB: 10, maxTotalMB: 100 },
  pro: { maxFileMB: 50, maxTotalMB: 1024 },
  team: { maxFileMB: 100, maxTotalMB: 5120 },
  enterprise: { maxFileMB: 500, maxTotalMB: 51200 },
};

function buildKey(
  orgId: string,
  businessId: string,
  category: string,
  subPath: string,
): string {
  return `orgs/${orgId}/businesses/${businessId}/${category}/${subPath}`;
}

export async function storeDeliverable(
  orgId: string,
  businessId: string,
  jobId: number,
  filename: string,
  content: Buffer,
  contentType: string,
) {
  const plan = await getOrgPlan(orgId);
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const sizeMB = content.length / (1024 * 1024);

  if (sizeMB > limits.maxFileMB) {
    throw new Error(
      `File ${filename} (${sizeMB.toFixed(1)}MB) exceeds ${limits.maxFileMB}MB limit for ${plan} plan`,
    );
  }

  // Enforce org-wide total storage limit
  const [{ total }] = await db
    .select({ total: sql<number>`COALESCE(SUM(${storageObjects.sizeBytes}), 0)` })
    .from(storageObjects)
    .where(eq(storageObjects.orgId, orgId));
  if ((total + content.length) > limits.maxTotalMB * 1024 * 1024) {
    throw new Error(
      `Org storage limit exceeded (${limits.maxTotalMB}MB for ${plan} plan)`,
    );
  }

  const objectKey = buildKey(orgId, businessId, 'deliverables', `${jobId}/${filename}`);
  const checksum = createHash('sha256').update(content).digest('hex');

  await uploadObject(objectKey, content, contentType);

  const [row] = await db
    .insert(storageObjects)
    .values({
      orgId,
      businessId,
      objectKey,
      category: 'deliverable',
      filename,
      contentType,
      sizeBytes: content.length,
      jobId,
      checksum,
    })
    .returning();

  return row;
}

export async function getDeliverableUrl(
  objectId: string,
  orgId: string,
  businessId: string,
): Promise<string | null> {
  const [obj] = await db
    .select({ objectKey: storageObjects.objectKey })
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.id, objectId),
        eq(storageObjects.orgId, orgId),
        eq(storageObjects.businessId, businessId),
      ),
    )
    .limit(1);

  if (!obj) return null;
  return getPresignedDownloadUrl(obj.objectKey, 3600);
}

export async function listDeliverables(
  orgId: string,
  businessId: string,
  jobId?: number,
) {
  const conditions = [
    eq(storageObjects.orgId, orgId),
    eq(storageObjects.businessId, businessId),
  ];
  if (jobId !== undefined) {
    conditions.push(eq(storageObjects.jobId, jobId));
  }
  return db
    .select()
    .from(storageObjects)
    .where(and(...conditions));
}

export async function deleteDeliverables(objectIds: string[]) {
  for (const id of objectIds) {
    const [obj] = await db
      .select({ objectKey: storageObjects.objectKey })
      .from(storageObjects)
      .where(eq(storageObjects.id, id))
      .limit(1);

    if (obj) {
      await deleteObject(obj.objectKey);
      await db.delete(storageObjects).where(eq(storageObjects.id, id));
    }
  }
}

export async function listStorageObjects(
  orgId: string,
  businessId: string,
  category?: string,
  jobId?: number,
) {
  const conditions = [
    eq(storageObjects.orgId, orgId),
    eq(storageObjects.businessId, businessId),
  ];
  if (category) {
    conditions.push(eq(storageObjects.category, category));
  }
  if (jobId !== undefined) {
    conditions.push(eq(storageObjects.jobId, jobId));
  }
  return db
    .select()
    .from(storageObjects)
    .where(and(...conditions));
}
