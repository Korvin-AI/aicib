import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema/index';

const poolSize = env.NODE_ENV === 'production' ? 20 : 5;

export const client = postgres(env.DATABASE_URL, {
  max: poolSize,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
