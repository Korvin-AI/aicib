import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { users } from '../db/schema/index';
import { hashPassword, verifyPassword } from '../utils/password';

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return user ?? null;
}

export async function findUserById(id: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user ?? null;
}

export async function createUser(
  email: string,
  password: string,
  displayName?: string,
) {
  const hash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      passwordHash: hash,
      displayName: displayName ?? null,
    })
    .returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      createdAt: users.createdAt,
    });
  return user;
}

export async function verifyUserPassword(
  email: string,
  password: string,
): Promise<{ id: string; email: string; displayName: string | null } | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return null;
  return { id: user.id, email: user.email, displayName: user.displayName };
}
