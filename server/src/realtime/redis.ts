import Redis from 'ioredis';
import { env } from '../env';

let pubClient: Redis | null = null;

/** Shared publisher connection (lazy singleton) */
export function getPubClient(): Redis {
  if (!pubClient) {
    pubClient = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null, // BullMQ requirement
    });
    pubClient.connect().catch((err) => {
      console.error('Redis pub client connection error:', err.message);
    });
  }
  return pubClient;
}

/** Factory: new connection per SSE client (pub/sub mode requires dedicated connections) */
export function createSubscriber(): Redis {
  const sub = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  sub.connect().catch((err) => {
    console.error('Redis subscriber connection error:', err.message);
  });
  return sub;
}

/** Channel for all events for a business */
export function businessChannel(businessId: string): string {
  return `aicib:events:${businessId}`;
}

/** Channel for events specific to a job */
export function jobChannel(businessId: string, jobId: number): string {
  return `aicib:events:${businessId}:job:${jobId}`;
}

/** Check if the pub client exists without creating one */
export function hasPubClient(): boolean {
  return pubClient !== null;
}

/** Graceful shutdown */
export async function closeRedis(): Promise<void> {
  if (pubClient) {
    await pubClient.quit();
    pubClient = null;
  }
}
