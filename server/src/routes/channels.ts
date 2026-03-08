import { Hono } from 'hono';
import {
  getChannelSummaries,
  getChannelEntries,
  getChannelDefinition,
} from '../repositories/channel-repo';
import { notFoundError } from '../utils/errors';
import type { TenantContext } from '../types';

const channels = new Hono<{ Variables: { tenant: TenantContext } }>();

channels.get('/', async (c) => {
  const { businessId } = c.get('tenant');
  const summaries = await getChannelSummaries(businessId);
  return c.json({ channels: summaries });
});

channels.get('/:channelId/thread', async (c) => {
  const { businessId } = c.get('tenant');
  const channelId = c.req.param('channelId');

  const definition = getChannelDefinition(channelId);
  if (!definition) throw notFoundError('Channel not found');

  const allEntries = await getChannelEntries(businessId);
  const entries = allEntries
    .filter((e) => e.channelId === channelId)
    .slice(-300); // last 300 entries

  return c.json({ channel: definition, entries });
});

export { channels };
