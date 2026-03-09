import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../db/connection', () => ({
  db: {
    execute: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));

vi.mock('../realtime/redis', () => ({
  getPubClient: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
  })),
  hasPubClient: vi.fn(() => true),
}));

vi.mock('../workers/brief-worker', () => ({
  getWorkerStatus: vi.fn(() => ({ running: true, activeCount: 0 })),
}));

vi.mock('../env', () => ({
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    PORT: 3001,
    NODE_ENV: 'test',
    CORS_ORIGIN: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
  },
}));

import { Hono } from 'hono';
import { db } from '../db/connection';
import { getPubClient, hasPubClient } from '../realtime/redis';
import { getWorkerStatus } from '../workers/brief-worker';

describe('GET /health', () => {
  let app: Hono;

  beforeEach(async () => {
    // Reset mock implementations to defaults before each test
    vi.mocked(db.execute).mockResolvedValue([{ '?column?': 1 }] as any);
    vi.mocked(hasPubClient).mockReturnValue(true);
    vi.mocked(getPubClient).mockReturnValue({
      ping: vi.fn().mockResolvedValue('PONG'),
    } as any);
    vi.mocked(getWorkerStatus).mockReturnValue({ running: true, activeCount: 0 });

    const { health } = await import('../routes/health');
    app = new Hono();
    app.route('/', health);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns expected shape when all components healthy', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    expect(body.components).toBeDefined();
    expect(body.components.db.status).toBe('ok');
    expect(typeof body.components.db.latencyMs).toBe('number');
    expect(body.components.redis.status).toBe('ok');
    expect(body.components.worker.status).toBe('ok');
    expect(body.components.memory.status).toBeDefined();
    expect(typeof body.components.memory.heapUsedMB).toBe('number');
    expect(typeof body.components.memory.rssMB).toBe('number');
  });

  it('returns degraded when redis is down', async () => {
    vi.mocked(getPubClient).mockReturnValue({
      ping: vi.fn().mockRejectedValue(new Error('Connection refused')),
    } as any);

    const res = await app.request('/health');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.components.redis.status).toBe('unhealthy');
  });

  it('returns 503 when DB is down', async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error('Connection refused'));

    const res = await app.request('/health');
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.components.db.status).toBe('unhealthy');
  });
});
