import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection';
import { orgSecrets } from '../db/schema/index';
import { encrypt, decrypt } from '../utils/crypto';

export async function setOrgSecret(
  orgId: string,
  key: string,
  plaintext: string,
) {
  const encryptedValue = encrypt(plaintext);
  await db
    .insert(orgSecrets)
    .values({ orgId, key, encryptedValue })
    .onConflictDoUpdate({
      target: [orgSecrets.orgId, orgSecrets.key],
      set: { encryptedValue, updatedAt: new Date() },
    });
}

export async function getOrgSecret(
  orgId: string,
  key: string,
): Promise<string | null> {
  const [row] = await db
    .select({ encryptedValue: orgSecrets.encryptedValue })
    .from(orgSecrets)
    .where(and(eq(orgSecrets.orgId, orgId), eq(orgSecrets.key, key)))
    .limit(1);

  if (!row) return null;
  return decrypt(row.encryptedValue);
}

export async function deleteOrgSecret(orgId: string, key: string) {
  await db
    .delete(orgSecrets)
    .where(and(eq(orgSecrets.orgId, orgId), eq(orgSecrets.key, key)));
}

export async function listOrgSecretKeys(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ key: orgSecrets.key })
    .from(orgSecrets)
    .where(eq(orgSecrets.orgId, orgId));
  return rows.map((r) => r.key);
}
